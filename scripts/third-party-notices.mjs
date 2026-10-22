// Genera THIRD-PARTY-NOTICES.md con las dependencias de producción (nombre, versión, licencia y su texto).
// Uso: node scripts/third-party-notices.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }));
const found = new Map();
(function walk(deps) {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (d.path && !name.startsWith('@howler/') && !found.has(`${name}@${d.version}`)) found.set(`${name}@${d.version}`, d);
    walk(d.dependencies);
  }
})(tree.dependencies);

const licenseText = (dir) => {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\..*)?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : '';
};
let out = '# Componentes de terceros / Third-party components\n\nHowler incluye los siguientes componentes, cada uno con su propia licencia.\nHowler includes the following components, each under its own license.\n\n';
for (const [id, d] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const lic = typeof d.license === 'string' ? d.license : d.license?.type ?? 'desconocida';
  out += `## ${id} — ${lic}\n\n`;
  const text = d.path && existsSync(d.path) ? licenseText(d.path) : '';
  if (text) out += '```\n' + text + '\n```\n\n';
}

// AssettoServer viaja dentro del instalador (AGPL-3.0): hay que dar el aviso y el enlace al código fuente de esa versión.
out += '## AssettoServer v0.0.55-pre35 — AGPL-3.0\n\n';
out += 'El instalador de Howler incluye, sin modificar, AssettoServer v0.0.55-pre35 (https://github.com/compujuckel/AssettoServer), licenciado bajo la GNU Affero General Public License v3. Su código fuente está en https://github.com/compujuckel/AssettoServer/tree/v0.0.55-pre35 y el texto de la licencia en https://www.gnu.org/licenses/agpl-3.0.txt.\n\n';
out += "The Howler installer includes, unmodified, AssettoServer v0.0.55-pre35 (https://github.com/compujuckel/AssettoServer), licensed under the GNU Affero General Public License v3. Its source code is at https://github.com/compujuckel/AssettoServer/tree/v0.0.55-pre35 and the license text at https://www.gnu.org/licenses/agpl-3.0.txt.\n\n";

writeFileSync('THIRD-PARTY-NOTICES.md', out);
console.log(`${found.size} componentes`);
