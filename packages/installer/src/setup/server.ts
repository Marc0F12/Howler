import { execFile, spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAssettoCorsa, findAssettoCorsa } from '../new-server';
import { detectInstall } from '../plan';
import { detectServers } from '../../../server/src/admin/detect-server';
import { describeServer, install, uninstall, type Mode, type Progress, type SetupOptions, type SetupReport, type Sys } from './flow';

/** Archivos de la interfaz (los trae el empaquetado: texto o bytes). */
export type UiAssets = Record<string, { type: string; data: string | Uint8Array }>;

export interface SetupServerDeps {
  kind: 'install' | 'uninstall';
  ui: UiAssets;
  sys: Sys;
  version: string;
  lang: 'es' | 'en';
  /** Carpeta donde se instala por defecto (o donde está la instalación existente). */
  defaultDir: string;
  /** Paquete de Howler (solo al instalar). */
  payload?: string;
  license?: string;
  /** Se llama al terminar (cerrar la ventana, «Cerrar»). */
  onExit: () => void;
  /** Abre Howler instalado (se puede cambiar en pruebas). */
  launch?: (exe: string) => void;
  /** Para pruebas: servidores y diálogo de carpeta falsos. */
  servers?: () => { dir: string; info: ReturnType<typeof describeServer> }[];
  browse?: (initial: string) => Promise<string | null>;
  /** Para pruebas: AssettoServer ya descomprimido. */
  assettoDir?: string;
  /** AssettoServer incluido en el instalador (ruta del tar.gz, se extrae solo si hace falta). */
  assettoArchive?: () => Promise<string | undefined> | string | undefined;
  /** Para pruebas: instalaciones de Assetto Corsa. */
  acDirs?: () => string[];
  /** Segundos sin latido tras los que se cierra solo (0 = nunca). */
  idleExitSeconds?: number;
}

type Job = { state: 'idle' | 'running' | 'done' | 'error'; step: string; percent: number; error: string | null; report: SetupReport | null };

function browseFolder(initial: string): Promise<string | null> {
  const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowNewFolderButton = $true; ${initial ? `$d.SelectedPath = '${initial.replace(/'/g, "''")}';` : ''} if ($d.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }`;
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', timeout: 5 * 60_000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}

/** Servidor local (solo 127.0.0.1, con clave en la URL) que sirve la ventana del asistente y hace el trabajo. */
export async function startSetupServer(d: SetupServerDeps): Promise<{ port: number; token: string; url: string; close: () => void }> {
  const token = randomBytes(16).toString('hex');
  let job: Job = { state: 'idle', step: 'check', percent: 0, error: null, report: null };
  let installDir = d.defaultDir;
  let webPort = 8420;
  let lastBeat = Date.now();
  let beating = false;

  const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((ok, bad) => {
    let s = '';
    req.on('data', (c: Buffer) => { s += c; if (s.length > 100_000) { req.destroy(); bad(new Error('too big')); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(new Error('bad json')); } });
  });
  const authed = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers['x-setup-token'] ?? ''));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };
  const str = (v: unknown, max = 600) => (typeof v === 'string' && v.length <= max ? v : '');
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

  const existing = () => {
    const i = detectInstall(installDir);
    let serverDir = '';
    try { serverDir = JSON.parse(readFileSync(join(installDir, 'howler.config.json'), 'utf8')).serverDir ?? ''; } catch { /* sin configuración legible */ }
    try { webPort = JSON.parse(readFileSync(join(installDir, 'howler.config.json'), 'utf8')).http?.port ?? 8420; } catch { /* puerto por defecto */ }
    return { ...i, serverDir };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Defensa contra DNS rebinding: solo se atiende con el host local.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host ?? ''))) return json(res, 403, { error: 'host' });
      if (!url.pathname.startsWith('/api/')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const a = d.ui[name];
        if (!a) { res.writeHead(404); return void res.end(); }
        res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'no-store' });
        return void res.end(a.data);
      }
      if (!authed(req)) return json(res, 401, { error: 'token' });
      const api = url.pathname.slice(5);
      if (req.method === 'GET' && api === 'init') {
        const servers = d.kind === 'install' ? (d.servers ?? (() => detectServers().map((s) => ({ dir: s.dir, info: describeServer(s.dir) }))))() : [];
        const acDirs = d.kind === 'install' ? (d.acDirs ?? findAssettoCorsa)() : [];
        return json(res, 200, { mode: d.kind, version: d.version, lang: d.lang, defaultDir: installDir, existing: existing(), servers, acDirs, bundled: !!d.assettoArchive, license: d.license ?? '' });
      }
      if (req.method === 'GET' && api === 'progress') return json(res, 200, job);
      if (req.method !== 'POST') return json(res, 405, { error: 'method' });
      const body = await readBody(req);
      if (api === 'ping') { lastBeat = Date.now(); beating = true; return json(res, 200, {}); }
      if (api === 'check') return json(res, 200, describeServer(str(body.dir)));
      if (api === 'checkac') return json(res, 200, checkAssettoCorsa(str(body.dir)));
      if (api === 'browse') return json(res, 200, { dir: await (d.browse ?? browseFolder)(str(body.initial)) });
      if (api === 'exit') { json(res, 200, {}); setTimeout(d.onExit, 50); return; }
      if (api === 'launch') { (d.launch ?? ((exe) => spawn(exe, [], { detached: true, stdio: 'ignore', cwd: installDir }).unref()))(join(installDir, 'Howler.exe')); return json(res, 200, {}); }
      if (api === 'install' && d.kind === 'install') {
        if (job.state === 'running') return json(res, 409, { error: 'running' });
        const mode = (['current', 'copy', 'new', 'manual'] as const).includes(body.mode as Mode) ? (body.mode as Mode) : 'manual';
        installDir = str(body.installDir) || installDir;
        const opts: SetupOptions = {
          installDir, mode, serverDir: str(body.serverDir) || undefined, copyTo: str(body.copyTo) || undefined, acDir: str(body.acDir) || undefined,
          firewall: bool(body.firewall, true), shortcuts: bool(body.shortcuts, true), autostart: bool(body.autostart, false),
          webPort: existing().hasConfig ? webPort : 8420, payload: d.payload!, version: d.version, assettoDir: d.assettoDir, assettoArchive: d.assettoArchive,
        };
        job = { state: 'running', step: 'check', percent: 0, error: null, report: null };
        const emit = (p: Progress) => { job.step = p.step; job.percent = Math.round(p.percent); };
        install(opts, d.sys, emit).then((report) => { job = { state: 'done', step: 'done', percent: 100, error: null, report }; })
          .catch((e) => { job = { ...job, state: 'error', error: e instanceof Error ? e.message : String(e) }; });
        return json(res, 200, {});
      }
      if (api === 'uninstall' && d.kind === 'uninstall') {
        existing();
        try { await uninstall({ installDir, deleteData: bool(body.deleteData, false), webPort }, d.sys, () => undefined); return json(res, 200, {}); }
        catch (e) { return json(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  // Sin latido de la ventana (se cerró) y sin instalación en curso: se acaba solo.
  const idle = d.idleExitSeconds ?? 20;
  const watchdog = idle > 0 ? setInterval(() => { if (beating && job.state !== 'running' && Date.now() - lastBeat > idle * 1000) d.onExit(); }, 2000) : null;
  return { port, token, url: `http://127.0.0.1:${port}/?t=${token}`, close: () => { if (watchdog) clearInterval(watchdog); server.close(); server.closeAllConnections(); } };
}

/** Abre la ventana del asistente (Edge en modo aplicación; si no, el navegador por defecto). */
export function openWindow(url: string): void {
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((p) => join(p!, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => existsSync(p));
  // Perfil propio: así la ventana tiene su botón en la barra de tareas con el logo de Howler y no el de Edge.
  if (edge) spawn(edge, [`--app=${url}`, '--window-size=1000,720', '--window-position=140,60', `--user-data-dir=${join(tmpdir(), 'howler-setup-window')}`, '--no-first-run'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
}
