// Idiomas de Howler. Las claves de traducción SON los textos en español de España (el idioma por defecto): `t('Guardar')`.
// El diccionario inglés vive en `en/*.ts`; un test comprueba que cada `t('...')` del código tiene su traducción.

export type Lang = 'es' | 'en';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];
export const isLang = (v: unknown): v is Lang => v === 'es' || v === 'en';

type Params = Record<string, string | number>;
const fill = (text: string, p?: Params) => (p ? text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(p, k) ? String(p[k]) : m)) : text);

let dictionary: Record<string, string> = {};
let patterns: { re: RegExp; names: string[]; en: string }[] | null = null;

/** Registra el diccionario inglés (clave = texto en español). Lo llama `en/index.ts`. */
export function registerEnglish(d: Record<string, string>) {
  dictionary = d;
  patterns = null;
}
export const englishDictionary = () => dictionary;

/** Traductor de un idioma: `t('Hola {nombre}', { nombre })`. Sin traducción devuelve el español. */
/** Traducción de un texto, solo si está en el diccionario (nada de «constructor» o «toString» heredados de Object). */
const lookup = (es: string): string | undefined => (Object.hasOwn(dictionary, es) ? dictionary[es] : undefined);

export function makeT(lang: Lang) {
  return (es: string, p?: Params): string => fill(lang === 'en' ? lookup(es) ?? es : es, p);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Traduce un mensaje que llegó ya hecho (un error del servidor, el motivo de una vuelta anulada): primero busca el texto
 * exacto y, si no, una plantilla con huecos (`Anulada: {n} cortes`) cuyo patrón coincida. Si nada coincide, queda en español.
 */
export function translateMessage(lang: Lang, text: string): string {
  if (lang !== 'en') return text;
  const exact = lookup(text);
  if (exact !== undefined) return exact;
  patterns ??= Object.entries(dictionary).filter(([k]) => k.includes('{')).map(([k, en]) => {
    const names: string[] = [];
    const re = new RegExp('^' + escapeRe(k).replace(/\\\{(\w+)\\\}/g, (_m, n: string) => { names.push(n); return '(.+?)'; }) + '$');
    return { re, names, en };
  });
  for (const { re, names, en } of patterns) {
    const m = re.exec(text);
    // Los valores capturados también se traducen si son frases conocidas («en marcha» → «running»).
    if (m) return fill(en, Object.fromEntries(names.map((n, i) => [n, lookup(m[i + 1]!) ?? m[i + 1]!])));
  }
  return text;
}
