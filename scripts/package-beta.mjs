// Empaqueta una versión portátil: dist-beta/Howler/ con Howler.exe (Node embebido), app/, web/ y plugin/.
import { build } from 'esbuild';
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import * as ResEdit from 'resedit';
import { bundleSetup } from './setup-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist-beta', 'Howler');
// Cuidado: empaquetar borra dist-beta/Howler entero. Si hay datos de uso (base de datos), se guardan antes en una copia aparte.
if (existsSync(join(out, 'data', 'howler.db'))) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = join(root, 'dist-beta', `backup-data-antes-de-reempaquetar-${stamp}`);
  mkdirSync(safe, { recursive: true });
  cpSync(join(out, 'data'), join(safe, 'data'), { recursive: true, filter: (s) => !/panel-window/.test(s) });
  if (existsSync(join(out, 'howler.config.json'))) copyFileSync(join(out, 'howler.config.json'), join(safe, 'howler.config.json'));
  console.log(`Datos guardados antes de reempaquetar en ${safe}`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app'), { recursive: true });

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });

await build({
  entryPoints: [join(root, 'packages/server/src/index.ts')],
  outfile: join(out, 'app/howler.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: false,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

// Asistente de desinstalación (el mismo código del instalador): se lanza con «Howler.exe --uninstall» desde Aplicaciones de Windows.
await bundleSetup(join(out, 'app/setup.cjs'));

// Lanzador: CJS mínimo dentro del .exe que carga app/howler.mjs (el ESM con await de nivel superior no cabe en un SEA).
const tmp = join(root, 'dist-beta', '_tmp');
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'launcher.cjs'), `
const { pathToFileURL } = require('node:url'); const path = require('node:path'); const fs = require('node:fs'); const net = require('node:net'); const cp = require('node:child_process');
const dir = path.dirname(process.execPath);
if (process.argv.includes('--uninstall')) { const f = path.join(dir, 'app', 'setup.cjs'); require('node:module').createRequire(f)(f); } else {
process.env.HOWLER_HOME = dir;
if (process.env.HOWLER_OPEN_PANEL === undefined) process.env.HOWLER_OPEN_PANEL = '1';
process.title = 'Howler';
// Sin consola: todo lo que Howler escribe va a data/howler.log.
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
const logFile = path.join(dir, 'data', 'howler.log');
try { if (fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.old'); } catch {}
const w = (...a) => { try { fs.appendFileSync(logFile, new Date().toISOString().slice(11, 19) + ' ' + a.map((x) => typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x)).join(' ') + String.fromCharCode(10)); } catch {} };
for (const k of ['log', 'info', 'warn', 'error']) console[k] = w;
process.on('uncaughtException', (e) => w('ERROR', e));
process.on('unhandledRejection', (e) => w('ERROR', e));
let adminPort = 8421;
try { adminPort = JSON.parse(fs.readFileSync(path.join(dir, 'howler.config.json'), 'utf8')).admin?.port ?? 8421; } catch {}
// Una sola instancia: si ya hay un Howler en marcha, solo se abre otra ventana del panel y se sale.
const probe = net.connect({ host: '127.0.0.1', port: adminPort });
probe.on('connect', () => {
  probe.destroy();
  const own = path.join(dir, 'window', 'HowlerWindow.exe');
  const url = 'http://127.0.0.1:' + adminPort + '/?app=1#/panel';
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((d) => path.join(d, 'Microsoft/Edge/Application/msedge.exe')).find((p) => fs.existsSync(p));
  if (fs.existsSync(own)) cp.spawn(own, ['--url', url, '--data', path.join(dir, 'data', 'panel-window'), '--title', 'Howler'], { detached: true, stdio: 'ignore' }).unref();
  else if (edge) cp.spawn(edge, ['--app=' + url, '--window-size=1320,900'], { detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
});
probe.on('error', () => {
  import(pathToFileURL(path.join(dir, 'app', 'howler.mjs')).href).catch((e) => { w('Howler no pudo arrancar:', e); process.exit(1); });
});
}
`);
writeFileSync(join(tmp, 'sea.json'), JSON.stringify({ main: join(tmp, 'launcher.cjs'), output: join(tmp, 'launcher.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', join(tmp, 'sea.json')], { stdio: 'inherit' });
// Icono: ICO con el PNG de 256 px (assets/icon.png) y metadatos, grabados en una copia de node.exe antes de inyectar el programa.
{
  const ico = readFileSync(join(root, 'assets/icon.ico')); // ICO multitamaño (16–256 px)
  const exe = ResEdit.NtExecutable.from(readFileSync(process.execPath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(ico);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconFile.icons.map((i) => i.data));
  for (const vi of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Howler', FileDescription: 'Howler', OriginalFilename: 'Howler.exe', InternalName: 'Howler', CompanyName: 'Howler', LegalCopyright: '' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  writeFileSync(join(out, 'Howler.exe'), Buffer.from(exe.generate()));
}
execFileSync('npx', ['--no-install', 'postject', join(out, 'Howler.exe'), 'NODE_SEA_BLOB', join(tmp, 'launcher.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit', shell: true });
// Subsistema «Windows» (2) en vez de «consola» (3): el .exe se abre sin ventana negra.
{
  const exe = join(out, 'Howler.exe');
  const buf = readFileSync(exe);
  const pe = buf.readUInt32LE(0x3c);
  buf.writeUInt16LE(2, pe + 24 + 68);
  writeFileSync(exe, buf);
}
rmSync(tmp, { recursive: true, force: true });

cpSync(join(root, 'packages/web/dist'), join(out, 'web'), { recursive: true });
// Ventana propia del panel (WinForms + WebView2, ~1 MB). Si no hay SDK de .NET se sigue sin ella y Howler usa la ventana de Edge.
try {
  execFileSync('dotnet', ['build', join(root, 'window/HowlerWindow'), '-c', 'Release', '-o', join(root, 'window/dist'), '--nologo', '-v', 'q'], { cwd: root, stdio: 'inherit' });
  cpSync(join(root, 'window/dist'), join(out, 'window'), { recursive: true, filter: (s) => !/Wpf\.dll$|\.pdb$/i.test(s) });
} catch (e) {
  console.warn('AVISO: no se pudo compilar la ventana propia (¿falta el SDK de .NET?); este paquete usará la ventana de Edge.', e.message);
}
if (!existsSync(join(root, 'plugin/dist/HowlerPlugin'))) throw new Error('Falta plugin/dist/HowlerPlugin: compila el plugin antes (dotnet build -c Release en plugin/HowlerPlugin).');
cpSync(join(root, 'plugin/dist/HowlerPlugin'), join(out, 'plugin/HowlerPlugin'), { recursive: true });
// Se usa tu configuración (para no tener que rehacerla), pero SIN los enlaces de Discord: el paquete se puede pasar a otras personas.
let cfg = readFileSync(join(root, 'howler.config.example.json'), 'utf8');
if (existsSync(join(root, 'howler.config.json'))) {
  try {
    const own = JSON.parse(readFileSync(join(root, 'howler.config.json'), 'utf8'));
    if (own.discord) { own.discord.webhookUrl = ''; own.discord.webhooks = []; }
    cfg = JSON.stringify(own, null, 2) + '\n';
  } catch { /* config ilegible: se queda la de ejemplo */ }
}
writeFileSync(join(out, 'howler.config.json'), cfg);
writeFileSync(join(out, 'LEEME.txt'), `Howler (beta portátil)\r\n\r\n- Doble clic en Howler.exe: arranca Howler y abre el panel en una ventana.\r\n- Web pública: http://localhost:8420   Panel: http://127.0.0.1:8421/#/panel\r\n- Configuración: howler.config.json (junto al .exe). Datos: carpeta data\\ (para usar tu base de datos, copia aquí tu data\\howler.db).\r\n- Cierra la ventana del panel para parar Howler (y el servidor de AC que haya arrancado desde él). Errores: data\\howler.log.\r\n`);
console.log('Listo:', out);
