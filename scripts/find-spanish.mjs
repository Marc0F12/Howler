// Busca textos que parecen españoles y no pasan por t() (para repasar la traducción). Uso: node scripts/find-spanish.mjs [carpeta...]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['packages/web/src'];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
const SPANISH = /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|con|para|por|una?|que|se|no|sin|tu|tus|su|sus|hay|ya|más|vueltas?|piloto|sesión|servidor|guardar|borrar|nuevo|elige|pulsa)\b/i;
for (const dir of dirs) for (const file of (statSync(dir).isFile() ? [dir] : walk(dir))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\bt\(\s*['"]/.test(line) && !/>[^<{]*[a-záéíóúñ]{3}[^<{]*</i.test(line.replace(/\bt\(\s*(['"])(?:\\.|(?!\1).)*\1[^)]*\)/g, ''))) return;
    const stripped = line.replace(/\bt\(\s*(['"`])(?:\\.|(?!\1).)*\1(?:,\s*\{[^}]*\})?\)/g, '').replace(/\/\/.*$/, '');
    const strings = [...stripped.matchAll(/(['"`])((?:\\.|(?!\1).)+)\1/g)].map((m) => m[2]).filter((s) => SPANISH.test(s) && /\s|[áéíóúñ]/.test(s));
    const jsx = [...stripped.matchAll(/>([^<>{}]*[A-Za-záéíóúñ]{3}[^<>{}]*)</g)].map((m) => m[1].trim()).filter((s) => s && SPANISH.test(s));
    for (const s of [...strings, ...jsx]) console.log(`${file}:${i + 1}: ${s.slice(0, 90)}`);
  });
}
