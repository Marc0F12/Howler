import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { extractTarGz } from '../../../server/src/core/tar';
import { checkServerDir } from '../../../server/src/admin/detect-server';
import { migrate } from '../migrate';
import { createNewServer } from '../new-server';
import { enableClientTelemetryCfg, ensureClientMessages } from '../transform';
import { autostartLink, copyServer, detectInstall, shortcutScript, writeHowlerConfig } from '../plan';

const execFileP = promisify(execFile);
/** Orden de Windows sin consola visible (si no, parpadea una ventana negra en cada una). */
const run = (file: string, args: string[]) => execFileP(file, args, { windowsHide: true });

/** AssettoServer que Howler valida (la misma que usa el plugin). La suma sale de la página de la release de GitHub. */
export const ASSETTO = {
  version: 'v0.0.55-pre35',
  url: 'https://github.com/compujuckel/AssettoServer/releases/download/v0.0.55-pre35/assetto-server-win-x64.zip',
  sha256: '59fe87d2a03cf5c03413a78b6ebf4448890b2577ddcb40e202acb6aeb7cf9821',
  size: 48570183,
};

export type Mode = 'current' | 'copy' | 'new' | 'manual';
export interface SetupOptions {
  installDir: string;
  mode: Mode;
  /** Carpeta del servidor de AC (modos «current» y «copy»). */
  serverDir?: string;
  /** Modos «copy» y «new»: carpeta donde se monta el servidor nuevo. */
  copyTo?: string;
  /** Modo «new»: instalación de Assetto Corsa de la que se toma el contenido. */
  acDir?: string;
  firewall: boolean;
  shortcuts: boolean;
  autostart: boolean;
  webPort: number;
  /** Paquete con los archivos de Howler (tar.gz). */
  payload: string;
  version: string;
  /** Carpeta con AssettoServer ya descomprimido (pruebas). */
  assettoDir?: string;
  /** AssettoServer que viaja dentro del instalador (tar.gz). Si no hay, se descarga de GitHub como respaldo. */
  assettoArchive?: () => Promise<string | undefined> | string | undefined;
}
export interface Progress { step: string; percent: number }
export type Emit = (p: Progress) => void;

/** Todo lo que toca Windows o internet, para poder probar el flujo sin tocar nada. */
export interface Sys {
  isRunning(image: string): Promise<boolean>;
  powershell(script: string, elevated?: boolean): Promise<void>;
  regAdd(key: string, values: Record<string, string | number>): Promise<void>;
  regDelete(key: string): Promise<void>;
  download(url: string, dest: string, onBytes: (got: number) => void): Promise<void>;
  unzip(zip: string, dest: string): Promise<void>;
  startupDir(): string;
  desktopDir(): string;
  startMenuDir(): string;
}

export const realSys: Sys = {
  async isRunning(image) {
    const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`]);
    return stdout.toLowerCase().includes(`"${image.toLowerCase()}"`);
  },
  async powershell(script, elevated = false) {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    if (!elevated) { await run('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc]); return; }
    // Un solo aviso de Windows (UAC) para las órdenes que necesitan permisos de administrador.
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${enc}'`]);
  },
  async regAdd(key, values) {
    for (const [k, v] of Object.entries(values)) await run('reg', ['add', key, '/v', k, '/t', typeof v === 'number' ? 'REG_DWORD' : 'REG_SZ', '/d', String(v), '/f']);
  },
  async regDelete(key) { await run('reg', ['delete', key, '/f']).catch(() => undefined); },
  async download(url, dest, onBytes) {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`La descarga falló (${res.status}).`);
    let got = 0;
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => { got += c.length; onBytes(got); });
    await pipeline(body, createWriteStream(dest));
  },
  async unzip(zip, dest) { mkdirSync(dest, { recursive: true }); await run('tar', ['-xf', zip, '-C', dest]); },
  startupDir: () => join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  desktopDir: () => join(process.env.USERPROFILE ?? '', 'Desktop'),
  startMenuDir: () => join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
};

/** Para ensayos: no toca el registro, el cortafuegos ni internet; solo anota lo que haría en `<base>/ensayo.log`. */
export function dryRunSys(base: string): Sys {
  const log = (l: string) => { mkdirSync(base, { recursive: true }); appendFileSync(join(base, 'ensayo.log'), l + '\n'); };
  return {
    isRunning: async () => false,
    powershell: async (s, e) => log(`powershell${e ? ' (admin)' : ''}: ${s.split('\n')[0]}`),
    regAdd: async (k, v) => log(`reg add ${k} ${JSON.stringify(v)}`),
    regDelete: async (k) => log(`reg delete ${k}`),
    download: async () => { throw new Error('ensayo: sin descarga (usa HOWLER_SETUP_ASSETTO)'); },
    unzip: async () => undefined,
    startupDir: () => join(base, 'accesos', 'inicio'), desktopDir: () => join(base, 'accesos', 'escritorio'), startMenuDir: () => join(base, 'accesos', 'menu'),
  };
}

export const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Howler';

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest('hex');
}

/** Qué se ve de un servidor antes de instalar (para la pantalla de elegir). */
export function describeServer(dir: string) {
  const c = checkServerDir(dir);
  const hasAssetto = existsSync(join(dir, 'AssettoServer.exe'));
  const old = existsSync(join(dir, 'acServer.exe')) && !existsSync(join(dir, 'howler-migration.json')) && !hasAssetto;
  return { dir, ok: c.ok, presets: c.presets, hasPlugin: c.hasPlugin, migrated: c.migrated, needsMigration: old, problems: c.problems.filter((p) => !p.startsWith('El servidor no tiene el plugin')) };
}

/** Actualiza solo el plugin de un servidor que ya usa AssettoServer, guardando antes lo que sustituye. */
export function updatePlugin(serverDir: string, pluginDir: string, now = new Date()): { replaced: number; created: number; backupDir: string | null } {
  const dest = join(serverDir, 'plugins', 'HowlerPlugin');
  const backupDir = join(serverDir, 'howler-backup', `plugin-${now.toISOString().replace(/[:.]/g, '-')}`);
  let replaced = 0, created = 0;
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  for (const f of walk(pluginDir)) {
    const rel = relative(pluginDir, f), to = join(dest, rel);
    if (existsSync(to)) { mkdirSync(dirname(join(backupDir, rel)), { recursive: true }); copyFileSync(to, join(backupDir, rel)); replaced++; } else created++;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(f, to);
  }
  enableClientTelemetry(serverDir);
  return { replaced, created, backupDir: replaced ? backupDir : null };
}

/**
 * La telemetría de los jugadores con CSP va siempre activa: `EnableClientMessages: true` en los extra_cfg.yml del servidor y
 * `ClientTelemetry: true` en los plugin_howler_cfg.yml que la tuvieran apagada. Lo que cambia se guarda como `.howler-prev`.
 */
export function enableClientTelemetry(serverDir: string): void {
  const presets = join(serverDir, 'presets');
  const dirs = [join(serverDir, 'cfg'), ...(existsSync(presets) ? readdirSync(presets).map((p) => join(presets, p)) : [])];
  const patch = (file: string, fix: (t: string) => string | null) => {
    if (!existsSync(file)) return;
    try {
      const before = readFileSync(file, 'utf8');
      const after = fix(before);
      if (after === null || after === before) return;
      if (!existsSync(`${file}.howler-prev`)) copyFileSync(file, `${file}.howler-prev`);
      writeFileSync(file, after);
    } catch { /* un archivo ilegible no debe impedir actualizar el plugin */ }
  };
  for (const d of dirs) {
    if (!existsSync(d) || !statSync(d).isDirectory()) continue;
    patch(join(d, 'extra_cfg.yml'), ensureClientMessages);
    patch(join(d, 'plugin_howler_cfg.yml'), enableClientTelemetryCfg);
  }
}

async function ensureAssetto(o: SetupOptions, sys: Sys, emit: Emit, base: number, span: number): Promise<{ dir: string; cleanup: () => void }> {
  if (o.assettoDir && existsSync(join(o.assettoDir, 'AssettoServer.exe'))) return { dir: o.assettoDir, cleanup: () => undefined };
  const tmp = mkdtempSync(join(tmpdir(), 'howler-assetto-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    const bundled = await o.assettoArchive?.();
    if (bundled && existsSync(bundled)) {
      emit({ step: 'unpack', percent: base + span * 0.3 });
      const dir = join(tmp, 'x');
      await extractTarGz(bundled, dir, () => true);
      if (!existsSync(join(dir, 'AssettoServer.exe'))) throw new Error('El AssettoServer incluido en el instalador no trae AssettoServer.exe.');
      return { dir, cleanup };
    }
    const zip = join(tmp, 'assetto.zip');
    emit({ step: 'download', percent: base });
    await sys.download(ASSETTO.url, zip, (got) => emit({ step: 'download', percent: base + (got / ASSETTO.size) * span * 0.8 }));
    if ((await sha256(zip)) !== ASSETTO.sha256) throw new Error('La descarga de AssettoServer no coincide con su suma de comprobación: se ha descartado.');
    emit({ step: 'unpack', percent: base + span * 0.85 });
    const dir = join(tmp, 'x');
    await sys.unzip(zip, dir);
    if (!existsSync(join(dir, 'AssettoServer.exe'))) throw new Error('El archivo descargado no trae AssettoServer.exe.');
    return { dir, cleanup };
  } catch (e) { cleanup(); throw e; }
}

export interface SetupReport { installDir: string; serverDir: string | null; backupDir: string | null; warnings: string[]; notes: string[] }

/** Instalación completa. Si algo falla se lanza un error; lo hecho en el servidor se deshace solo (ver `migrate`). */
/** Carpetas del programa: se borran y se vuelven a copiar en cada instalación o actualización (los datos y la configuración no). */
const PROGRAM_DIRS = ['app', 'web', 'plugin', 'window'];

export async function install(o: SetupOptions, sys: Sys, emit: Emit): Promise<SetupReport> {
  const report: SetupReport = { installDir: o.installDir, serverDir: null, backupDir: null, warnings: [], notes: [] };
  emit({ step: 'check', percent: 1 });
  if ((await sys.isRunning('Howler.exe')) || (await sys.isRunning('HowlerWindow.exe'))) throw new Error('RUNNING_HOWLER');
  if (o.mode !== 'manual' && ((await sys.isRunning('acServer.exe')) || (await sys.isRunning('AssettoServer.exe')))) throw new Error('RUNNING_SERVER');
  if (o.mode !== 'manual' && o.mode !== 'new' && !o.serverDir) throw new Error('Falta la carpeta del servidor.');
  if (o.mode === 'new' && (!o.acDir || !o.copyTo)) throw new Error('Falta la carpeta de Assetto Corsa o la del servidor nuevo.');
  const previous = detectInstall(o.installDir);

  // 1. Programa. Se borran las carpetas del programa (no los datos ni la configuración) para no mezclar archivos viejos.
  emit({ step: 'files', percent: 5 });
  for (const d of PROGRAM_DIRS) rmSync(join(o.installDir, d), { recursive: true, force: true });
  mkdirSync(o.installDir, { recursive: true });
  const keep = new Set(['data', 'howler.config.json']);
  await extractTarGz(o.payload, o.installDir, (n) => !keep.has(n.split('/')[0]!));
  emit({ step: 'files', percent: 40 });

  // 2. Servidor.
  let serverDir: string | null = null;
  let preset: string | undefined;
  if (o.mode !== 'manual') {
    let target = o.serverDir ?? '';
    if (o.mode === 'new') {
      const a = await ensureAssetto(o, sys, emit, 42, 30);
      try {
        emit({ step: 'new', percent: 76 });
        const r = createNewServer({ acDir: o.acDir!, target: o.copyTo!, assettoDir: a.dir });
        updatePlugin(r.serverDir, join(o.installDir, 'plugin', 'HowlerPlugin'));
        serverDir = r.serverDir; preset = r.preset;
        report.notes.push('new-server');
      } finally { a.cleanup(); }
    } else {
    if (o.mode === 'copy') {
      emit({ step: 'copy', percent: 42 });
      if (!o.copyTo) throw new Error('Falta la carpeta nueva.');
      copyServer(target, o.copyTo);
      target = o.copyTo;
    }
    const info = describeServer(target);
    if (!info.ok) throw new Error(`La carpeta del servidor no es válida: ${info.problems.join(' ')}`);
    const pluginDir = join(o.installDir, 'plugin', 'HowlerPlugin');
    if (info.needsMigration) {
      const a = await ensureAssetto(o, sys, emit, 45, 30);
      try {
        emit({ step: 'server', percent: 78 });
        const r = migrate({ serverDir: target, newServerDir: a.dir, pluginDir });
        report.backupDir = r.backupDir;
        report.warnings.push(...r.warnings);
        enableClientTelemetry(target);
      } finally { a.cleanup(); }
    } else {
      emit({ step: 'plugin', percent: 80 });
      report.backupDir = updatePlugin(target, pluginDir).backupDir;
      report.notes.push('plugin-only');
    }
    serverDir = target;
    preset = info.presets[0];
    }
  }
  report.serverDir = serverDir;

  // 3. Configuración (si ya existe, no se toca).
  emit({ step: 'config', percent: 85 });
  if (previous.hasConfig) report.notes.push('config-kept');
  else writeHowlerConfig(o.installDir, serverDir ?? '', { web: o.webPort }, preset ? { preset } : undefined);

  // 4. Accesos directos, arranque con Windows y cortafuegos.
  const exe = join(o.installDir, 'Howler.exe');
  const links: string[] = [];
  if (o.shortcuts) links.push(join(sys.desktopDir(), 'Howler.lnk'), join(sys.startMenuDir(), 'Howler.lnk'));
  if (o.autostart) links.push(autostartLink(sys.startupDir()));
  if (links.length) {
    emit({ step: 'shortcuts', percent: 90 });
    await sys.powershell(links.map((l) => shortcutScript(exe, l, '', o.installDir)).join('\n'));
  }
  if (o.firewall) {
    emit({ step: 'firewall', percent: 94 });
    try { await sys.powershell(firewallAdd(o.webPort), true); }
    catch { report.warnings.push('firewall-failed'); }
  }

  // 5. Aparece en «Aplicaciones» de Windows para poder desinstalarlo.
  emit({ step: 'register', percent: 97 });
  await sys.regAdd(UNINSTALL_KEY, {
    DisplayName: 'Howler', DisplayVersion: o.version, Publisher: 'Howler', InstallLocation: o.installDir, DisplayIcon: exe,
    UninstallString: `"${exe}" --uninstall`, NoModify: 1, NoRepair: 1,
  });
  emit({ step: 'done', percent: 100 });
  return report;
}

const ruleName = (port: number) => `Howler web ${port}`;
/** Regla de entrada del cortafuegos solo para la web de Howler (TCP). Se borra antes la del mismo nombre: reinstalar no deja reglas repetidas. */
const firewallAdd = (port: number) => `Remove-NetFirewallRule -DisplayName '${ruleName(port)}' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName '${ruleName(port)}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Any | Out-Null`;
const firewallRemove = (port: number) => `Remove-NetFirewallRule -DisplayName '${ruleName(port)}' -ErrorAction SilentlyContinue`;

export interface UninstallOptions { installDir: string; deleteData: boolean; webPort: number }

/** Desinstalar: quita el programa, los accesos y el cortafuegos; los datos y la configuración se conservan salvo que se pida. */
export async function uninstall(o: UninstallOptions, sys: Sys, emit: Emit): Promise<{ kept: string[] }> {
  emit({ step: 'files', percent: 10 });
  for (const d of PROGRAM_DIRS) rmSync(join(o.installDir, d), { recursive: true, force: true });
  rmSync(join(o.installDir, 'LEEME.txt'), { force: true });
  const kept: string[] = [];
  if (o.deleteData) { rmSync(join(o.installDir, 'data'), { recursive: true, force: true }); rmSync(join(o.installDir, 'howler.config.json'), { force: true }); }
  else kept.push(join(o.installDir, 'data'), join(o.installDir, 'howler.config.json'));
  for (const l of [join(sys.desktopDir(), 'Howler.lnk'), join(sys.startMenuDir(), 'Howler.lnk'), autostartLink(sys.startupDir())]) rmSync(l, { force: true });
  emit({ step: 'firewall', percent: 60 });
  await sys.powershell(firewallRemove(o.webPort), true).catch(() => undefined);
  await sys.regDelete(UNINSTALL_KEY);
  emit({ step: 'done', percent: 100 });
  return { kept };
}
