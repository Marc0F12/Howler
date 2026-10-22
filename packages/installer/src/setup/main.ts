import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { HOWLER_VERSION } from '../../../shared/src/updates';
import { describeServer, dryRunSys, install, realSys, UNINSTALL_KEY, uninstall } from './flow';
import { openWindow, startSetupServer, type UiAssets } from './server';
import { relaunchHowler } from './relaunch';
import indexHtml from './ui/index.html';
import appCss from './ui/app.css';
import appJs from './ui/wizard.client.txt';
import font from './ui/archivo.woff2';
import logo from './ui/logo.png';
import licenseTerms from '../../../../LICENSE';
import licenseNotes from '../../../../LICENSE-NOTES.txt';
// Lo que ve la persona al instalar: primero el resumen y los permisos adicionales, después el texto completo de la AGPL.
const license = `${licenseNotes}
${licenseTerms}`;

/**
 * Entrada del asistente. Dos formas de llegar aquí:
 *  - `Howler-Setup.exe` (el paquete va dentro del propio .exe): instalar o actualizar.
 *  - `Howler.exe --uninstall` (desde «Aplicaciones» de Windows): desinstalar.
 * Opciones: `--update` (actualización sin preguntas, la lanza el panel), `--silent`, `--uninstall`.
 */

const execFileP = promisify(execFile);
const run = (file: string, args: string[]) => execFileP(file, args, { windowsHide: true });
const args = process.argv.filter((a) => a.startsWith('--'));
const flag = (n: string) => args.includes(`--${n}`);

const ui: UiAssets = {
  'index.html': { type: 'text/html; charset=utf-8', data: indexHtml },
  'app.css': { type: 'text/css; charset=utf-8', data: appCss },
  'app.js': { type: 'text/javascript; charset=utf-8', data: appJs },
  'archivo.woff2': { type: 'font/woff2', data: font },
  'logo.png': { type: 'image/png', data: logo },
};

const dry = process.env.HOWLER_SETUP_DRYRUN; // ensayo: todo dentro de esa carpeta
const sys = dry ? dryRunSys(dry) : realSys;
const lang = (Intl.DateTimeFormat().resolvedOptions().locale || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';

/** Dónde está instalado Howler según Windows (para actualizar sobre la misma carpeta). */
async function registeredDir(): Promise<string | null> {
  try {
    const { stdout } = await run('reg', ['query', UNINSTALL_KEY, '/v', 'InstallLocation']);
    const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(stdout);
    return m ? m[1]!.trim() : null;
  } catch { return null; }
}

/** El paquete de Howler que viaja dentro del instalador (o el de la variable de pruebas). */
async function payloadFile(): Promise<string> {
  if (process.env.HOWLER_SETUP_PAYLOAD) return process.env.HOWLER_SETUP_PAYLOAD;
  const sea = await import('node:sea');
  if (!sea.isSea()) throw new Error('Este instalador no lleva el paquete de Howler.');
  const dir = mkdtempSync(join(tmpdir(), 'howler-setup-'));
  const file = join(dir, 'payload.tar.gz');
  writeFileSync(file, Buffer.from(sea.getRawAsset('payload.tar.gz')));
  return file;
}

/** El AssettoServer que viaja dentro del instalador (o el de la variable de pruebas); undefined si esta versión no lo lleva. */
async function assettoArchive(): Promise<string | undefined> {
  if (process.env.HOWLER_SETUP_ASSETTO_ARCHIVE) return process.env.HOWLER_SETUP_ASSETTO_ARCHIVE;
  try {
    const sea = await import('node:sea');
    if (!sea.isSea()) return undefined;
    const dir = mkdtempSync(join(tmpdir(), 'howler-assetto-pack-'));
    const file = join(dir, 'assetto.tar.gz');
    writeFileSync(file, Buffer.from(sea.getRawAsset('assetto.tar.gz')));
    return file;
  } catch { return undefined; }
}

/** Cierra la ventana vieja del panel (Edge con el perfil `panel-window`) si el Howler anterior no la cerró, para que no queden dos abiertas. */
async function closeOldPanelWindow(): Promise<void> {
  if (dry) return;
  try {
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -match 'panel-window' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process -Name HowlerWindow -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"]);
  } catch { /* si no se puede, queda la ventana vieja: no es grave */ }
}

/** Espera (hasta `ms`) a que no quede ningún Edge con el perfil del panel: si el nuevo Howler abre su ventana mientras el viejo sigue ahí, Edge le cede la ventana al proceso moribundo y no se ve nada. */
async function waitPanelWindowGone(ms: number): Promise<boolean> {
  if (dry) return true;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -match 'panel-window' } | Measure-Object).Count"]);
      if (Number(stdout.trim()) === 0) return true;
    } catch { return true; } // sin PowerShell no se puede comprobar: seguir
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Anota cada paso de la actualización en `update.log` (el instalador no tiene consola: sin esto un fallo no deja rastro). */
function updateLog(dir: string) {
  const file = join(dir, 'update.log');
  return (line: string) => { try { appendFileSync(file, `${new Date().toISOString()} ${line}\n`); } catch { /* sin permiso de escritura: no pasa nada */ } };
}

/** Borra Howler.exe cuando este proceso termine (un programa no se puede borrar a sí mismo mientras corre). */
function deleteSelfLater(exe: string, dir: string) {
  const cmd = `ping -n 4 127.0.0.1 >nul & del /f /q "${exe}" & rmdir "${join(dir, 'app')}" 2>nul & rmdir "${dir}" 2>nul`;
  spawn('cmd', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function main() {
  const uninstalling = flag('uninstall');
  const dir = dry ? join(dry, 'Howler') : uninstalling ? dirname(process.execPath) : (await registeredDir()) ?? join(process.env.LOCALAPPDATA ?? tmpdir(), 'Programs', 'Howler');
  let port = 8420;
  try { port = JSON.parse(readFileSync(join(dir, 'howler.config.json'), 'utf8')).http?.port ?? 8420; } catch { /* puerto por defecto */ }

  if (flag('update') || (flag('silent') && !uninstalling)) {
    // Actualización sin preguntas: mismos ajustes que la instalación existente. Espera a que Howler se cierre.
    let serverDir: string | undefined;
    try { serverDir = JSON.parse(readFileSync(join(dir, 'howler.config.json'), 'utf8')).serverDir; } catch { /* manual */ }
    const mode = serverDir && describeServer(serverDir).ok ? 'current' : 'manual';
    const log = updateLog(dir);
    log(`Actualización a ${HOWLER_VERSION} (modo ${mode})`);
    const payload = await payloadFile();
    for (let i = 0; i < 40; i++) {
      try {
        await install({ installDir: dir, mode, serverDir, firewall: false, shortcuts: false, autostart: false, webPort: port, payload, version: HOWLER_VERSION, assettoArchive }, sys, () => undefined);
        break;
      } catch (e) {
        if (!(e instanceof Error) || !/^RUNNING_/.test(e.message) || i === 39) { log(`Error al instalar: ${e instanceof Error ? e.message : String(e)}`); throw e; }
        if (i === 0) log('Esperando a que Howler se cierre…');
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    log('Archivos actualizados');
    await closeOldPanelWindow();
    log(`Ventana vieja del panel ${(await waitPanelWindowGone(10_000)) ? 'cerrada' : 'sigue abierta tras 10 s'}`);
    const up = async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
    const ok = await relaunchHowler({
      start: () => {
        const child = spawn(join(dir, 'Howler.exe'), [], { detached: true, stdio: 'ignore', cwd: dir });
        let gone = false;
        child.on('exit', () => { gone = true; });
        child.on('error', (e) => { log(`Error al lanzar Howler.exe: ${e.message}`); gone = true; });
        child.unref();
        return { exited: () => gone };
      },
      isUp: up,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log,
    });
    log(ok ? 'Terminado' : 'Terminado CON AVISO: Howler no respondió; ábrelo a mano desde su acceso directo');
    return;
  }

  if (uninstalling && flag('silent')) {
    await uninstall({ installDir: dir, deleteData: false, webPort: port }, sys, () => undefined);
    deleteSelfLater(process.execPath, dir);
    return;
  }

  const handle = await startSetupServer({
    kind: uninstalling ? 'uninstall' : 'install', ui, sys, version: HOWLER_VERSION, lang, defaultDir: dir,
    payload: uninstalling ? undefined : await payloadFile(), license, assettoDir: process.env.HOWLER_SETUP_ASSETTO, assettoArchive,
    ...(dry ? { acDirs: () => (process.env.HOWLER_SETUP_AC ?? '').split(';').filter(Boolean), servers: () => (process.env.HOWLER_SETUP_SERVERS ?? '').split(';').filter(Boolean).map((d) => ({ dir: d, info: describeServer(d) })), browse: async () => null, launch: () => undefined, idleExitSeconds: 0 } : {}),
    onExit: () => { handle.close(); if (uninstalling && !existsSync(join(dir, 'web'))) deleteSelfLater(process.execPath, dir); process.exit(0); },
  });
  if (dry) writeFileSync(join(dry, 'url.txt'), handle.url); else openWindow(handle.url);
}

main().catch((e) => {
  try { writeFileSync(join(tmpdir(), 'howler-setup-error.txt'), e instanceof Error ? e.stack ?? e.message : String(e)); } catch { /* sin permisos */ }
  process.exit(1);
});
