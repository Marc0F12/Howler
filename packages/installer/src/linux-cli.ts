import { dirname, join, resolve } from 'node:path';
import { writeHowlerConfig } from './plan';
import { setupLinuxServer } from './linux-setup';

/**
 *   node app/setup-linux.mjs --server <carpeta del servidor> [--preset SERVER_00] [--home <carpeta de Howler>]
 * Es lo que ejecuta `install.sh` del paquete de Linux. `--home` por defecto es la carpeta del paquete.
 */
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : undefined;
};

const serverDir = opt('server');
const home0 = resolve(opt('home') ?? join(dirname(process.argv[1] ?? '.'), '..'));
// Sin servidor todavía: solo deja creado howler.config.json (el servidor se añade luego desde el panel o editando el archivo).
if (!serverDir && args.includes('--init')) {
  console.log(writeHowlerConfig(home0, '') === 'created' ? `howler.config.json creado en ${home0}. Pon en serverDir la carpeta de tu servidor.` : `howler.config.json ya existía en ${home0}: no se ha tocado.`);
  process.exit(0);
}
if (!serverDir) {
  console.error('Falta --server <carpeta del servidor de AssettoServer>');
  process.exit(1);
}
const home = home0;
try {
  const r = setupLinuxServer({ serverDir: resolve(serverDir), pluginDir: join(home, 'plugin', 'HowlerPlugin'), installDir: home, ...(opt('preset') ? { preset: opt('preset')! } : {}) });
  console.log(`Servidor preparado (${r.exe}, preset ${r.preset ?? '—'}).`);
  for (const c of r.changes) console.log(' •', c);
  if (r.warnings.length) { console.log('\nAvisos:'); for (const w of r.warnings) console.log(' !', w); }
  console.log(r.config === 'created' ? `\nhowler.config.json creado en ${home}.` : `\nhowler.config.json ya existía en ${home}: no se ha tocado.`);
  if (r.backupDir) console.log(`Plugin anterior guardado en ${r.backupDir}.`);
} catch (e) {
  console.error('Error:', (e as Error).message);
  process.exit(1);
}
