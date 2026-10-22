/**
 * Recorre TODOS los circuitos de una carpeta `content/tracks` de AC (solo lectura) y mide si el map.ini encaja con su map.png
 * y la línea ai/fast_lane.ai, y qué corrige el autocalibrado.
 *   npm run check-maps -w @howler/server -- "E:\...\assettocorsa\content\tracks"
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fitMap, pngMask } from '../core/map-fit';
import { readSpline } from '../core/track-geometry';
import { effectiveMargin, iniAffine, parseMapIni, pngSize } from '../core/track-map';

const root = process.argv[2];
if (!root || !existsSync(root)) { console.error('Uso: check-maps <carpeta content/tracks>'); process.exit(1); }

const dirs = (d: string) => readdirSync(d).filter((n) => { try { return statSync(join(d, n)).isDirectory(); } catch { return false; } });
const rows: { name: string; status: string; detail: string }[] = [];
for (const track of dirs(root)) {
  const base = join(root, track);
  const targets: [string, string][] = [];
  if (existsSync(join(base, 'map.png'))) targets.push([track, base]);
  for (const l of dirs(base)) if (existsSync(join(base, l, 'map.png'))) targets.push([`${track}/${l}`, join(base, l)]);
  for (const [name, dir] of targets) {
    try {
      const ini = join(dir, 'data', 'map.ini');
      const f = [dir, base].map((d) => join(d, 'ai', 'fast_lane.ai')).find(existsSync);
      if (!f) { rows.push({ name, status: 'SIN-LINEA', detail: 'no hay ai/fast_lane.ai' }); continue; }
      const mask = pngMask(join(dir, 'map.png'));
      if (!mask) { rows.push({ name, status: 'SIN-IMAGEN', detail: 'map.png ilegible' }); continue; }
      const spline = readSpline(f);
      if (!spline) { rows.push({ name, status: 'SIN-LINEA', detail: 'fast_lane.ai ilegible' }); continue; }
      const parsed = existsSync(ini) ? parseMapIni(readFileSync(ini, 'utf8')) : null;
      const info = parsed ? { ...parsed, margin: effectiveMargin(parsed, pngSize(join(dir, 'map.png'))) } : null;
      const r = fitMap(mask, spline, info ? iniAffine(info) : null);
      if (!r) { rows.push({ name, status: 'SIN-AJUSTE', detail: 'no se pudo ajustar' }); continue; }
      const q = (x: { coverage: number; depth: number } | null) => x ? `cobertura ${(x.coverage * 100).toFixed(0)}% prof ${x.depth.toFixed(1)}px` : 'sin map.ini';
      rows.push({ name, status: r.source === 'ini' ? 'OK' : r.source === 'fitted' ? 'CORREGIDO' : 'NO-ENCAJA', detail: `ini: ${q(r.ini)} | ajuste: ${q(r.fitted)}` });
    } catch (e) { rows.push({ name, status: 'ERROR', detail: String(e) }); }
  }
}
const count = (s: string) => rows.filter((r) => r.status === s).length;
for (const r of rows.filter((x) => x.status !== 'OK')) console.log(`${r.status.padEnd(10)} ${r.name.padEnd(40)} ${r.detail}`);
console.log(`\n${rows.length} mapas: ${count('OK')} bien · ${count('CORREGIDO')} corregidos por el autocalibrado · ${rows.length - count('OK') - count('CORREGIDO')} sin poder medir`);
