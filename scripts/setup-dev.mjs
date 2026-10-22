// Ensayo del asistente SIN tocar el sistema: todo dentro de una carpeta temporal (sin registro, cortafuegos ni internet).
//   node scripts/setup-dev.mjs [--uninstall] [--servers "C:\ruta\servidor;C:\otra"] [--assetto "C:\ruta\AssettoServer descomprimido"]
// Escribe la dirección de la ventana en <carpeta>\url.txt y la imprime.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleSetup, makePayload, root } from './setup-lib.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const work = mkdtempSync(join(tmpdir(), 'howler-setup-dev-'));
const cjs = join(work, 'setup.cjs');
await bundleSetup(cjs);
const payload = join(work, 'payload.tar.gz');
const n = await makePayload(join(root, 'dist-beta', 'Howler'), payload);
console.log(`Paquete de ensayo: ${n} archivos`);
mkdirSync(join(work, 'Howler'), { recursive: true });
if (args.includes('--uninstall')) { // un Howler "instalado" de mentira para desinstalar
  for (const d of ['app', 'web', 'plugin', 'data']) mkdirSync(join(work, 'Howler', d), { recursive: true });
  writeFileSync(join(work, 'Howler', 'data', 'howler.db'), 'datos');
}
const env = { ...process.env, HOWLER_SETUP_DRYRUN: work, HOWLER_SETUP_PAYLOAD: payload, HOWLER_SETUP_SERVERS: opt('servers') ?? '', HOWLER_SETUP_ASSETTO: opt('assetto') ?? '' };
const child = spawn(process.execPath, [cjs, ...(args.includes('--uninstall') ? ['--uninstall'] : [])], { env, stdio: 'inherit' });
for (let i = 0; i < 50 && !existsSync(join(work, 'url.txt')); i++) await new Promise((r) => setTimeout(r, 200));
console.log('Ventana:', readFileSync(join(work, 'url.txt'), 'utf8'));
console.log('Carpeta de ensayo:', work);
child.on('exit', (c) => console.log('El asistente terminó', c));
