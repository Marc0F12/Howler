// Instalador: dist-setup/Howler-Setup.exe (un solo archivo que lleva dentro el asistente y el paquete de Howler) + SHA256SUMS.
//   npm run package:setup      (antes: npm run package:beta, que deja dist-beta/Howler)
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSea, bundleSetup, makeDirArchive, makePayload, root } from './setup-lib.mjs';

const work = join(root, 'dist-beta', '_setup');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const out = join(root, 'dist-setup');
mkdirSync(out, { recursive: true });

const main = join(work, 'setup.cjs');
await bundleSetup(main);
const payload = join(work, 'payload.tar.gz');
const n = await makePayload(join(root, 'dist-beta', 'Howler'), payload);
console.log(`Paquete: ${n} archivos, ${(statSync(payload).size / 1e6).toFixed(1)} MB`);

// AssettoServer (la versión validada) viaja dentro del instalador: no depende de internet ni de que GitHub conserve la descarga.
const assettoSrc = join(root, 'vendor', 'assettoserver-release-pre35');
const assetto = join(work, 'assetto.tar.gz');
const na = await makeDirArchive(assettoSrc, assetto);
console.log(`AssettoServer: ${na} archivos, ${(statSync(assetto).size / 1e6).toFixed(1)} MB`);

const exe = join(out, 'Howler-Setup.exe');
buildSea({ main, out: exe, assets: { 'payload.tar.gz': payload, 'assetto.tar.gz': assetto }, name: 'Howler-Setup.exe', description: 'Instalador de Howler' });

const h = createHash('sha256');
for await (const c of createReadStream(exe)) h.update(c);
writeFileSync(join(out, 'SHA256SUMS'), `${h.digest('hex')}  Howler-Setup.exe\n`);
rmSync(work, { recursive: true, force: true });
console.log(`Listo: ${exe} (${(statSync(exe).size / 1e6).toFixed(0)} MB)`);
