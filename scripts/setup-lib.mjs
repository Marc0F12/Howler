// Piezas comunes del empaquetado del instalador: el asistente en un solo archivo y el paquete de Howler (tar.gz).
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as ResEdit from 'resedit';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');

/** Asistente (servidor local + interfaz + lógica) en un único archivo CommonJS. */
export async function bundleSetup(outfile) {
  await build({
    entryPoints: [join(root, 'packages/installer/src/setup/main.ts')],
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node24', minify: false, legalComments: 'none',
    loader: { '.html': 'text', '.css': 'text', '.txt': 'text', '.woff2': 'binary', '.png': 'binary', '': 'text' },
    logLevel: 'warning',
  });
}

/** Paquete con lo que se instala (sin datos ni configuración propios): Howler.exe, app/, web/, plugin/, window/ (ventana propia del panel) y LEEME. */
export async function makePayload(srcDir, outFile) {
  const tmp = join(root, 'dist-beta', '_tar.mjs');
  mkdirSync(join(root, 'dist-beta'), { recursive: true });
  await build({ entryPoints: [join(root, 'packages/server/src/core/tar.ts')], outfile: tmp, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning' });
  const { writeTarGz } = await import(`file://${tmp.replace(/\\/g, '/')}`);
  const entries = [];
  const walk = (dir, rel) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r);
      else entries.push({ name: r, file: p });
    }
  };
  for (const top of ['Howler.exe', 'app', 'web', 'plugin', 'window', 'LEEME.txt']) {
    const p = join(srcDir, top);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) walk(p, top); else entries.push({ name: top, file: p });
  }
  if (!entries.some((e) => e.name === 'Howler.exe')) throw new Error(`Falta Howler.exe en ${srcDir}: ejecuta antes npm run package:beta.`);
  await writeTarGz(outFile, entries);
  rmSync(tmp, { force: true });
  return entries.length;
}

/** Comprime una carpeta entera (por ejemplo AssettoServer, que viaja dentro del instalador). */
export async function makeDirArchive(srcDir, outFile) {
  if (!existsSync(join(srcDir, 'AssettoServer.exe'))) throw new Error(`Falta AssettoServer.exe en ${srcDir}.`);
  const tmp = join(root, 'dist-beta', '_tar2.mjs');
  mkdirSync(join(root, 'dist-beta'), { recursive: true });
  await build({ entryPoints: [join(root, 'packages/server/src/core/tar.ts')], outfile: tmp, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning' });
  const { writeTarGz } = await import(`file://${tmp.replace(/\\/g, '/')}`);
  const entries = [];
  const walk = (dir, rel) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r); else entries.push({ name: r, file: p });
    }
  };
  walk(srcDir, '');
  await writeTarGz(outFile, entries);
  rmSync(tmp, { force: true });
  return entries.length;
}

/** Convierte un script CommonJS en un .exe autónomo (Node embebido): icono, metadatos, archivos incrustados y sin ventana de consola. */
export function buildSea({ main, out, assets = {}, name, description }) {
  const tmp = join(root, 'dist-beta', '_sea');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const blob = join(tmp, 'app.blob');
  writeFileSync(join(tmp, 'sea.json'), JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, assets }));
  execFileSync(process.execPath, ['--experimental-sea-config', join(tmp, 'sea.json')], { stdio: 'inherit' });
  const ico = readFileSync(join(root, 'assets/icon.ico')); // ICO multitamaño (16–256 px)
  const exe = ResEdit.NtExecutable.from(readFileSync(process.execPath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ResEdit.Data.IconFile.from(ico).icons.map((i) => i.data));
  for (const vi of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Howler', FileDescription: description ?? name, OriginalFilename: name, InternalName: name, CompanyName: 'Howler', LegalCopyright: '' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, Buffer.from(exe.generate()));
  execFileSync('npx', ['--no-install', 'postject', out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit', shell: true });
  const buf = readFileSync(out);
  buf.writeUInt16LE(2, buf.readUInt32LE(0x3c) + 24 + 68); // subsistema «Windows»: sin ventana negra
  writeFileSync(out, buf);
  rmSync(tmp, { recursive: true, force: true });
}
