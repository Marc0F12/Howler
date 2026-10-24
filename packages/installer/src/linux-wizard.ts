import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { checkServerDir } from '../../server/src/admin/detect-server';
import { checkAssettoCorsa, createNewServer } from './new-server';
import { writeHowlerConfig } from './plan';
import { setupLinuxServer, type LinuxSetupReport } from './linux-setup';

/**
 * Asistente de Howler para Linux: lo que hace `Instalar Howler` al hacer doble clic. Pregunta lo mínimo (con respuesta
 * por defecto: basta pulsar Intro) y se encarga de buscar o crear el servidor, descargar AssettoServer, preparar el
 * plugin y dejar Howler arrancando solo. Todo lo que toca el sistema entra por `WizardIo` para poder probarlo.
 */

/** AssettoServer v0.0.55-pre35 para Linux (sumas de comprobación publicadas en la release de GitHub). */
export const ASSETTO_LINUX = {
  version: 'v0.0.55-pre35',
  x64: { url: 'https://github.com/compujuckel/AssettoServer/releases/download/v0.0.55-pre35/assetto-server-linux-x64.tar.gz', sha256: 'ffb789ad60919281ab45ff3953661cabf2997c7a8b72c3f2b529945626c90435' },
  arm64: { url: 'https://github.com/compujuckel/AssettoServer/releases/download/v0.0.55-pre35/assetto-server-linux-arm64.tar.gz', sha256: 'ade2098454b4a9b3036f9e2477d3161cfc51a157fb7a3b0991c8f805f5ee8a97' },
} as const;

export interface WizardIo {
  say(text: string): void;
  ask(question: string, def?: string): Promise<string>;
  /** Descarga `url` a `dest` y devuelve su SHA-256. */
  download(url: string, dest: string): Promise<string>;
  /** Descomprime un .tar.gz en `dest`. */
  untar(file: string, dest: string): void;
  /** ¿Hay systemd y se puede usar? */
  hasSystemd(): boolean;
  /** Instala y arranca el servicio de Howler; devuelve cómo se llama. */
  installService(home: string, node: string): string;
  arch(): 'x64' | 'arm64' | null;
  lang(): 'es' | 'en';
}

export interface WizardEnv {
  /** Carpeta de Howler (la del paquete). */
  home: string;
  /** Node que ejecuta Howler (el de `runtime/` si lo descargó el instalador). */
  node: string;
  /** Sitios donde mirar si ya hay un servidor de AssettoServer. */
  serverCandidates: string[];
  acInstalls: string[];
}

export interface WizardResult {
  serverDir: string | null;
  report: LinuxSetupReport | null;
  service: string | null;
  startNow: boolean;
}

export function defaultCandidates(home: string): string[] {
  const h = homedir();
  const names = ['server', 'ac/server', 'ac-server', 'assettoserver', 'AssettoServer', 'assetto', 'acserver'];
  return [...new Set([join(home, 'server'), ...names.map((n) => join(h, n)), '/opt/assettoserver', '/opt/AssettoServer', '/srv/assettoserver', '/srv/ac'])];
}

/** Servidores de AssettoServer (no el acServer antiguo) que ya existen en alguno de los sitios. */
export function findServers(candidates: string[]): string[] {
  return candidates.filter((d) => {
    const c = checkServerDir(d);
    return c.ok && c.exe && !/^acServer/i.test(c.exe);
  });
}

const yes = (s: string, def: boolean) => (s.trim() === '' ? def : /^(s|si|sí|y|yes)/i.test(s.trim()));

/** Carpeta que contiene el binario `AssettoServer`, dentro de lo recién descomprimido (puede venir envuelto en otra carpeta). */
export function findAssettoRoot(dir: string, depth = 2): string | null {
  if (existsSync(join(dir, 'AssettoServer'))) return dir;
  if (depth === 0) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { const r = findAssettoRoot(join(dir, e.name), depth - 1); if (r) return r; }
  }
  return null;
}

async function downloadAssetto(io: WizardIo, tr: (es: string, en: string) => string): Promise<{ dir: string; cleanup: () => void }> {
  const arch = io.arch();
  if (!arch) throw new Error(tr('Este procesador no está soportado por AssettoServer (hace falta x64 o arm64).', 'This processor is not supported by AssettoServer (x64 or arm64 needed).'));
  const src = ASSETTO_LINUX[arch];
  const tmp = mkdtempSync(join(tmpdir(), 'howler-assetto-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    io.say(tr('Descargando AssettoServer (unos 48 MB)…', 'Downloading AssettoServer (about 48 MB)…'));
    const file = join(tmp, 'assetto.tar.gz');
    const sum = await io.download(src.url, file);
    if (sum !== src.sha256) throw new Error(tr('La descarga de AssettoServer no coincide con su suma de comprobación: se ha descartado.', 'The AssettoServer download does not match its checksum: discarded.'));
    const out = join(tmp, 'x');
    mkdirSync(out);
    io.untar(file, out);
    const root = findAssettoRoot(out);
    if (!root) throw new Error(tr('El archivo descargado no trae el programa AssettoServer.', 'The downloaded archive has no AssettoServer program.'));
    return { dir: root, cleanup };
  } catch (e) { cleanup(); throw e; }
}

export async function runWizard(io: WizardIo, env: WizardEnv): Promise<WizardResult> {
  const tr = (es: string, en: string) => (io.lang() === 'es' ? es : en);
  const pluginDir = join(env.home, 'plugin', 'HowlerPlugin');
  io.say(tr('\n=== Instalación de Howler ===\nPulsa Intro para aceptar lo que se propone entre corchetes.\n', '\n=== Howler setup ===\nPress Enter to accept what is suggested in brackets.\n'));

  const found = findServers(env.serverCandidates);
  const ac = env.acInstalls;
  type Choice = { key: string; label: string };
  const choices: Choice[] = [];
  for (const s of found) choices.push({ key: `use:${s}`, label: tr(`Usar el servidor que ya tienes en ${s}`, `Use the server you already have at ${s}`) });
  if (ac.length) choices.push({ key: `new:${ac[0]}`, label: tr(`Crear un servidor nuevo para mí (usa tu Assetto Corsa de ${ac[0]})`, `Create a new server for me (uses your Assetto Corsa at ${ac[0]})`) });
  else choices.push({ key: 'new:', label: tr('Crear un servidor nuevo para mí (te pediré la carpeta de Assetto Corsa)', 'Create a new server for me (I will ask for the Assetto Corsa folder)') });
  choices.push({ key: 'path:', label: tr('Usar un servidor que está en otra carpeta', 'Use a server in another folder') });
  choices.push({ key: 'none:', label: tr('Solo instalar Howler (el servidor lo pongo después)', 'Only install Howler (I will add the server later)') });

  io.say(tr('¿Qué servidor de Assetto Corsa quieres usar?', 'Which Assetto Corsa server do you want to use?'));
  choices.forEach((c, i) => io.say(`  ${i + 1}) ${c.label}`));
  const ans = Number((await io.ask(tr('Elige un número', 'Pick a number'), '1')).trim());
  const pick = choices[Number.isInteger(ans) && ans >= 1 && ans <= choices.length ? ans - 1 : 0]!;
  const [kind, arg] = [pick.key.slice(0, pick.key.indexOf(':')), pick.key.slice(pick.key.indexOf(':') + 1)];

  let serverDir: string | null = null;
  let report: LinuxSetupReport | null = null;

  if (kind === 'use') serverDir = arg;
  if (kind === 'path') {
    for (;;) {
      const p = (await io.ask(tr('Carpeta del servidor (donde está el programa AssettoServer)', 'Server folder (where the AssettoServer program is)'))).trim();
      if (!p) break;
      const c = checkServerDir(resolve(p));
      if (c.ok && c.exe && !/^acServer/i.test(c.exe)) { serverDir = resolve(p); break; }
      io.say(tr(`Esa carpeta no sirve: ${c.problems.join(' ') || 'Howler necesita AssettoServer v0.0.55-pre35, no el acServer antiguo.'}`, `That folder does not work: ${c.problems.join(' ') || 'Howler needs AssettoServer v0.0.55-pre35, not the old acServer.'}`));
    }
  }
  if (kind === 'new') {
    let acDir = arg;
    while (!acDir || !checkAssettoCorsa(acDir).ok) {
      if (acDir) io.say(checkAssettoCorsa(acDir).problem ?? '');
      acDir = resolve((await io.ask(tr('Carpeta de Assetto Corsa (la que tiene content/cars; vacío para no crear servidor)', 'Assetto Corsa folder (the one with content/cars; empty to skip)'))).trim() || '.');
      if (acDir === resolve('.')) { acDir = ''; break; }
    }
    if (acDir) {
      const target = resolve((await io.ask(tr('¿Dónde creo el servidor?', 'Where do I create the server?'), join(env.home, 'server'))).trim() || join(env.home, 'server'));
      const dl = await downloadAssetto(io, tr);
      try {
        io.say(tr('Montando el servidor…', 'Building the server…'));
        const made = createNewServer({ acDir, target, assettoDir: dl.dir });
        serverDir = made.serverDir;
        io.say(tr(`Servidor creado en ${made.serverDir} (${made.choice.track}, ${made.choice.car}).`, `Server created at ${made.serverDir} (${made.choice.track}, ${made.choice.car}).`));
      } finally { dl.cleanup(); }
    }
  }

  if (serverDir) {
    io.say(tr('Preparando el servidor para Howler…', 'Preparing the server for Howler…'));
    report = setupLinuxServer({ serverDir, pluginDir, installDir: env.home });
    for (const c of report.changes) io.say(` • ${c}`);
    for (const w of report.warnings) io.say(` ! ${w}`);
  } else {
    io.say(tr('Howler se instalará sin servidor; podrás indicarlo luego en el panel (Ajustes → General).', 'Howler will be set up without a server; you can set it later in the panel (Settings → General).'));
    const done = writeHowlerConfig(env.home, '');
    if (done === 'created') io.say(tr('Configuración creada.', 'Configuration created.'));
  }

  let service: string | null = null;
  if (io.hasSystemd() && yes(await io.ask(tr('¿Quieres que Howler arranque solo con el equipo? (s/n)', 'Should Howler start automatically with the computer? (y/n)'), tr('s', 'y')), true)) {
    try { service = io.installService(env.home, env.node); io.say(tr(`Howler queda instalado como servicio (${service}) y ya está en marcha.`, `Howler is installed as a service (${service}) and already running.`)); }
    catch (e) { io.say(tr(`No pude crear el servicio: ${(e as Error).message}`, `Could not create the service: ${(e as Error).message}`)); }
  }
  let startNow = false;
  if (!service) startNow = yes(await io.ask(tr('¿Arranco Howler ahora? (s/n)', 'Start Howler now? (y/n)'), tr('s', 'y')), true);

  io.say(tr('\n¡Listo!\n  • Web para los pilotos:  http://<IP de este equipo>:8420\n  • Panel de control:      http://127.0.0.1:8421 (solo desde este equipo; desde otro, con un túnel SSH — mira LINUX.md)', '\nDone!\n  • Web for drivers:   http://<this computer\'s IP>:8420\n  • Control panel:     http://127.0.0.1:8421 (only from this computer; from another one use an SSH tunnel — see LINUX.md)'));
  return { serverDir, report, service, startNow };
}

/** Entrada y salida reales del terminal. */
export function terminalIo(): WizardIo {
  // Un solo lector para toda la sesión: con varias preguntas seguidas (o con la entrada redirigida) no se pierden líneas.
  const lines: string[] = [];
  const waiting: ((l: string | null) => void)[] = [];
  let ended = false;
  let rl: import('node:readline').Interface | null = null;
  const start = async () => {
    if (rl) return;
    const { createInterface } = await import('node:readline');
    rl = createInterface({ input: process.stdin });
    rl.on('line', (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
    rl.on('close', () => { ended = true; for (const w of waiting.splice(0)) w(null); });
  };
  return {
    say: (t) => console.log(t),
    ask: async (q, def) => {
      await start();
      process.stdout.write(def !== undefined ? `${q} [${def}]: ` : `${q}: `);
      const l = lines.length ? lines.shift()! : ended ? null : await new Promise<string | null>((r) => waiting.push(r));
      if (l === null) { console.log(''); return def ?? ''; }
      return l.trim() || def || '';
    },
    download: async (url, dest) => {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`No se pudo descargar (${res.status}).`);
      const hash = createHash('sha256');
      const out = createWriteStream(dest);
      const src = Readable.fromWeb(res.body as never);
      src.on('data', (c: Buffer) => hash.update(c));
      await pipeline(src, out);
      return hash.digest('hex');
    },
    untar: (file, dest) => { execFileSync('tar', ['-xzf', file, '-C', dest], { stdio: 'inherit' }); },
    hasSystemd: () => existsSync('/run/systemd/system'),
    installService: (home, node) => installSystemdService(home, node),
    arch: () => (process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null),
    lang: () => (/^es/i.test(process.env.LC_ALL || process.env.LANG || '') ? 'es' : 'en'),
  };
}

export function systemdUnit(home: string, node: string, target: string): string {
  return `[Unit]\nDescription=Howler\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${home}\nEnvironment=HOWLER_HOME=${home}\nExecStart=${node} ${home}/app/howler.mjs\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=60\n\n[Install]\nWantedBy=${target}\n`;
}

/** Servicio de sistema si eres root; si no, de tu usuario. Devuelve el nombre para mostrar. */
export function installSystemdService(home: string, node: string): string {
  if (process.getuid?.() === 0) {
    writeFileSync('/etc/systemd/system/howler.service', systemdUnit(home, node, 'multi-user.target'));
    execFileSync('systemctl', ['daemon-reload']);
    execFileSync('systemctl', ['enable', '--now', 'howler']);
    return 'howler (journalctl -u howler -f)';
  }
  const dir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'howler.service'), systemdUnit(home, node, 'default.target'));
  execFileSync('systemctl', ['--user', 'daemon-reload']);
  execFileSync('systemctl', ['--user', 'enable', '--now', 'howler']);
  try { execFileSync('loginctl', ['enable-linger', process.env.USER ?? '']); } catch { /* sin permiso: arrancará al iniciar sesión */ }
  return 'howler, de tu usuario (journalctl --user -u howler -f)';
}
