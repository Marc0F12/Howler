/**
 * Interruptores de `IgnoreConfigurationErrors` del `extra_cfg.yml` de AssettoServer. Cada uno hace que el servidor
 * arranque aunque falte algo (en vez de abortar con «Fatal exception occurred»).
 */
export type IgnoreFlag = 'MissingCarChecksums' | 'MissingTrackParams';

/** ¿Está el interruptor activo (`true`) en el texto de un `extra_cfg.yml`? */
export function readIgnoreFlagText(extraCfg: string, key: IgnoreFlag): boolean {
  return new RegExp(String.raw`^\s+${key}:\s*true\b`, 'm').test(extraCfg) || new RegExp(String.raw`^IgnoreConfigurationErrors:\s*\{[^}]*\b${key}\s*:\s*true\b`, 'm').test(extraCfg);
}

/** Pone el interruptor en `on`, conservando saltos de línea y los demás valores del bloque (incluida la forma en línea `{ A: true }`). */
export function setIgnoreFlagText(extraCfg: string, key: IgnoreFlag, on: boolean): string {
  const eol = extraCfg.includes('\r\n') ? '\r\n' : '\n';
  const value = on ? 'true' : 'false';
  const lines = extraCfg.split(/\r?\n/);
  const head = lines.findIndex((l) => /^IgnoreConfigurationErrors:/.test(l));
  if (head < 0) return `${extraCfg}${extraCfg === '' || extraCfg.endsWith('\n') ? '' : eol}IgnoreConfigurationErrors:${eol}  ${key}: ${value}${eol}`;
  // Forma en línea (`IgnoreConfigurationErrors: { MissingTrackParams: true }`): se pasa a bloque conservando lo que traía.
  const inline = /^IgnoreConfigurationErrors:\s*(.*?)\s*(?:#.*)?$/.exec(lines[head]!)?.[1] ?? '';
  if (inline !== '') {
    const flow = /^\{(.*)\}$/.exec(inline)?.[1];
    if (flow === undefined) throw new Error('El extra_cfg.yml tiene un valor inesperado en IgnoreConfigurationErrors; ábrelo y revísalo.');
    const own = new RegExp(String.raw`^${key}\s*:`);
    const pairs = flow.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !own.test(x));
    lines.splice(head, 1, 'IgnoreConfigurationErrors:', `  ${key}: ${value}`, ...pairs.map((x) => `  ${x.replace(/\s*:\s*/, ': ')}`));
    return lines.join(eol);
  }
  let end = head + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]!) || lines[end]!.trim() === '')) end++;
  const ownLine = new RegExp(String.raw`^\s+${key}:`);
  const at = lines.slice(head + 1, end).findIndex((l) => ownLine.test(l));
  if (at >= 0) lines[head + 1 + at] = lines[head + 1 + at]!.replace(new RegExp(String.raw`(${key}:\s*)\S+`), `$1${value}`);
  else lines.splice(head + 1, 0, `  ${key}: ${value}`);
  return lines.join(eol);
}
