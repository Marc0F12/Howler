import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { englishDictionary } from './i18n';
import './en';
import { BUILTIN_PROFILES } from './lap-rules';
import { DISCORD_EVENTS } from './discord-events';
import { SCORING_PRESETS } from './championship';
import { CSP_WEATHER_TYPES } from './weather';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

/** Todos los textos pasados a `t('...')` / `t("...")` en el código. */
function usedKeys(): { file: string; key: string }[] {
  const out: { file: string; key: string }[] = [];
  const re = /(?<![\w.])t\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g;
  for (const pkg of ['web/src', 'shared/src', 'server/src']) {
    for (const file of walk(join(root, pkg))) {
      if (file.replaceAll('\\', '/').endsWith('shared/src/i18n.ts')) continue; // sus comentarios traen ejemplos
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(re)) out.push({ file: file.replace(root, ''), key: (m[1] ?? m[2]!).replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n') });
    }
  }
  return out;
}

describe('traducciones', () => {
  const en = englishDictionary();
  it('cada texto pasado a t() tiene su traducción al inglés', () => {
    const missing = usedKeys().filter((u) => !(u.key in en));
    expect(missing.map((u) => `${u.file}: ${u.key}`)).toEqual([]);
  });
  it('los huecos {x} del español están igual en el inglés', () => {
    // Los textos de Discord llevan el hueco en español en la clave y su alias inglés en el valor.
    const alias = new Map(DISCORD_EVENTS.flatMap((e) => e.placeholders.map((p) => [p.alias, p.name] as const)));
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => alias.get(m[1]!) ?? m[1]).sort().join(',');
    const bad = Object.entries(en).filter(([es, e]) => holes(es) !== holes(e));
    expect(bad.map(([es]) => es)).toEqual([]);
  });
  it('los textos en español de shared que se muestran sin t() también están traducidos', () => {
    const texts: string[] = [];
    for (const e of DISCORD_EVENTS) texts.push(e.group, e.label, e.hint, e.defaultTitle, e.defaultMessage, ...e.placeholders.map((p) => p.hint));
    for (const p of Object.values(BUILTIN_PROFILES)) texts.push(p.name, p.description ?? '');
    for (const p of Object.values(SCORING_PRESETS)) texts.push(p.label);
    for (const w of CSP_WEATHER_TYPES) texts.push(w.name, w.group);
    expect(texts.filter((x) => x && !(x in en))).toEqual([]);
  });
});

describe('nombres heredados de Object', () => {
  it('«constructor» o «toString» no se confunden con traducciones ni con huecos', async () => {
    const { translateMessage, makeT } = await import('./i18n');
    const { fillTemplate } = await import('./discord-events');
    expect(translateMessage('en', 'constructor')).toBe('constructor');
    expect(makeT('en')('toString')).toBe('toString');
    expect(fillTemplate('Hola {constructor} y {piloto}', { piloto: 'Ana' })).toBe('Hola {constructor} y Ana');
  });
});
