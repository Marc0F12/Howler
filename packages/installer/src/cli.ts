import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate, rollback } from './migrate';

/**
 *   npm run migrate -- --server <carpeta del servidor> --new <carpeta de AssettoServer nuevo> --plugin <carpeta de HowlerPlugin>
 *   npm run migrate -- --server <carpeta del servidor> --rollback
 */
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : undefined; // `--server --rollback` no toma «--rollback» como carpeta
};
const serverDir = opt('server');
if (!serverDir) {
  console.error('Falta --server <carpeta del servidor de AC>');
  process.exit(1);
}

function serverRunning(): boolean {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return /"(acServer|AssettoServer)\.exe"/i.test(out);
  } catch {
    return false;
  }
}

// Una simulación no escribe nada: no hace falta parar el servidor.
if (!args.includes('--dry-run') && serverRunning()) {
  console.error('El servidor de AC está en marcha. Páralo antes de continuar (los archivos están en uso).');
  process.exit(2);
}

try {
  if (args.includes('--rollback')) {
    const r = rollback(resolve(serverDir));
    console.log(`Marcha atrás completada: ${r.restored} archivos restaurados, ${r.removed} eliminados.`);
  } else {
    const newDir = opt('new');
    const pluginDir = opt('plugin');
    if (!newDir || !pluginDir) throw new Error('Faltan --new y/o --plugin');
    if (!existsSync(newDir) || !existsSync(pluginDir)) throw new Error('Alguna de las carpetas indicadas no existe');
    const dryRun = args.includes('--dry-run');
    const r = migrate({ serverDir: resolve(serverDir), newServerDir: resolve(newDir), pluginDir: resolve(pluginDir), dryRun });
    console.log(dryRun ? 'SIMULACIÓN (no se ha tocado nada). Esto es lo que se haría:\n' : `Migración completada. Copia de seguridad en: ${r.backupDir}\n`);
    for (const c of r.changes) console.log(' •', c);
    if (r.warnings.length) {
      console.log('\nAvisos:');
      for (const w of r.warnings) console.log(' !', w);
    }
    if (!dryRun) console.log('\nPara deshacerlo: npm run migrate -w @howler/installer -- --server "' + serverDir + '" --rollback');
  }
} catch (e) {
  console.error('Error:', (e as Error).message);
  process.exit(1);
}
