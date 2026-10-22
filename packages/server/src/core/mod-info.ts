import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Lee la página de un mod (RaceDepartment/Overtake, AssettoWorld, assettocorsa.club, assettocorsamods.io...) para rellenar
 * su ficha: título, descripción, imagen y, si la página las trae etiquetadas, especificaciones. Es de mejor esfuerzo: cada web
 * es distinta y lo que no se pueda leer se rellena a mano. Lo pide el panel (solo desde el PC del servidor), con límites de
 * tiempo y tamaño y sin tocar direcciones privadas.
 */

export type ModKind = 'car' | 'track' | 'other';
export interface ModInfo {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  kind: ModKind;
  /** Pares etiqueta → valor tal como salen en la página (potencia, peso, tracción, longitud...). */
  specs: Record<string, string>;
}

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

/** Los 16 bytes de una dirección IPv6 válida (admite «::» y la cola en IPv4 punteado). */
function ipv6Bytes(ip: string): number[] | null {
  let x = ip.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (tail) x = x.slice(0, tail.index) + [(+tail[1]! << 8) | +tail[2]!, (+tail[3]! << 8) | +tail[4]!].map((n) => n.toString(16)).join(':');
  const [head = '', rest, extra] = x.split('::');
  if (extra !== undefined) return null;
  const groups = (t: string) => (t ? t.split(':') : []);
  const h = groups(head), r = rest === undefined ? [] : groups(rest);
  const fill = 8 - h.length - r.length;
  if (rest === undefined ? h.length !== 8 : fill < 1) return null;
  const all = [...h, ...Array<string>(rest === undefined ? 0 : fill).fill('0'), ...r];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

/** ¿Es una dirección de red local, privada o especial? Esas no se visitan nunca. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const by = ipv6Bytes(ip);
    if (!by) return true;
    const v4 = (o: number) => `${by[o]}.${by[o + 1]}.${by[o + 2]}.${by[o + 3]}`;
    const zeros = (n: number) => by.slice(0, n).every((x) => x === 0);
    if (zeros(15) && by[15]! <= 1) return true; // :: y ::1
    if (zeros(10) && by[10] === 0xff && by[11] === 0xff) return isPrivateAddress(v4(12)); // IPv4 dentro de IPv6 (::ffff:a.b.c.d, también en hexadecimal)
    if (zeros(12)) return isPrivateAddress(v4(12)); // ::a.b.c.d (en desuso)
    if (by[0] === 0 && by[1] === 0x64 && by[2] === 0xff && by[3] === 0x9b && by.slice(4, 12).every((x) => x === 0)) return isPrivateAddress(v4(12)); // NAT64
    if (by[0] === 0x20 && by[1] === 0x02) return isPrivateAddress(v4(2)); // 6to4
    if (by[0] === 0x20 && by[1] === 0x01 && by[2] === 0 && by[3] === 0) return true; // Teredo
    return (by[0]! & 0xfe) === 0xfc || (by[0] === 0xfe && (by[1]! & 0xc0) === 0x80) || by[0] === 0xff; // únicas locales, enlace local y multidifusión
  }
  return true; // lo que no es una IP válida no se considera seguro
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);
type Fetcher = (url: string, init: { signal: AbortSignal; redirect: 'manual'; headers: Record<string, string> }) => Promise<Response>;

/** Comprueba que la URL es http(s) y que su nombre solo apunta a direcciones públicas. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('El enlace no es válido.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('El enlace debe empezar por http:// o https://.');
  if (u.username || u.password) throw new Error('El enlace no puede llevar usuario ni contraseña.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host)) throw new Error('Esa dirección no es pública.');
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => { throw new Error('No se encontró esa web.'); });
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('Esa dirección no es pública.');
  return u;
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'"; if (l === 'nbsp') return ' ';
    const n = l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
const clean = (s: string | null | undefined, max: number) => {
  const t = decode(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Recorre las etiquetas `<nombre ...>` de una página en una sola pasada (con `indexOf`, sin expresiones regulares que
 * se vuelvan cuadráticas con páginas rotas). Si `withBody`, también da el texto hasta `</nombre>`.
 */
function* tagsOf(html: string, name: string, withBody = false): Generator<{ attrs: string; body: string }> {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  let pos = 0;
  for (;;) {
    const i = lower.indexOf(open, pos);
    if (i < 0) return;
    const next = lower[i + open.length];
    if (next !== undefined && !/[\s>/]/.test(next)) { pos = i + open.length; continue; } // `<scripts` no es `<script`
    const gt = lower.indexOf('>', i);
    if (gt < 0) return;
    let end = gt + 1, body = '';
    if (withBody) {
      const close = lower.indexOf(`</${name}>`, gt);
      if (close < 0) return;
      body = html.slice(gt + 1, close);
      end = close + name.length + 3;
    }
    yield { attrs: html.slice(i + open.length, gt).replace(/\/$/, ''), body };
    pos = end;
  }
}

function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const { attrs } of tagsOf(html, 'meta')) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
    const val = /content\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /content\s*=\s*'([^']*)'/i.exec(attrs)?.[1];
    if (key && val != null && !out.has(key)) out.set(key, val);
  }
  return out;
}

function jsonLd(html: string): { name?: string; description?: string; image?: string } {
  for (const { attrs, body } of tagsOf(html, 'script', true)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
    try {
      const data = JSON.parse(body);
      const node = (Array.isArray(data) ? data : (data['@graph'] ?? [data])).find((n: any) => n && (n.name || n.headline));
      if (node) {
        const img = Array.isArray(node.image) ? node.image[0] : node.image;
        return { name: node.name ?? node.headline, description: node.description, image: typeof img === 'string' ? img : img?.url };
      }
    } catch { /* JSON-LD roto: se ignora */ }
  }
  return {};
}

const SPEC_PATTERNS: [string, RegExp][] = [
  ['Potencia', /\b(?:power|potencia|horsepower|bhp)\s*[:\-–]?\s*(\d{2,4}(?:[.,]\d+)?\s*(?:hp|bhp|ps|cv|kw|cp))\b/i],
  ['Par', /\b(?:torque|par motor|par)\s*[:\-–]?\s*(\d{2,4}(?:[.,]\d+)?\s*(?:nm|lb[- ]?ft))\b/i],
  ['Peso', /\b(?:weight|peso)\s*[:\-–]?\s*(\d{1,2}[.,]\d{3}\s*kg|\d{3,5}(?:[.,]\d+)?\s*kg)\b/i],
  ['Tracción', /\b(?:drivetrain|drive ?train|traction|tracci[oó]n|drive)\s*[:\-–]?\s*(rwd|fwd|awd|4wd|rear[- ]wheel(?: drive)?|front[- ]wheel(?: drive)?|all[- ]wheel(?: drive)?|trasera|delantera|total|integral)\b/i],
  ['Marchas', /\b(?:gears?|gearbox|transmission|marchas|cambio)\s*[:\-–]?\s*(\d)[- ]?(?:speed|gears?|marchas|vel)?/i],
  ['Velocidad máxima', /\b(?:top speed|max(?:imum)? speed|velocidad m[aá]xima)\s*[:\-–]?\s*(\d{2,3}(?:[.,]\d+)?\s*(?:km\/h|kph|mph))/i],
  ['Longitud', /\b(?:length|longitud|distance)\s*[:\-–]?\s*(\d{1,3}(?:[.,]\d+)?\s*(?:km|kilometers|kilometres|mi|miles|m))\b/i],
  ['País', /\b(?:country|pa[ií]s)\s*[:\-–]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,28}?)(?=\s{2,}|\s*[|·•,;\n<]|\s+(?:length|city|year|pits|layouts?|author|version|power|weight)\b|$)/i],
  ['Año', /\b(?:year|a[nñ]o)\s*[:\-–]?\s*((?:19|20)\d{2})\b/i],
];

/** Quita `<script>`, `<style>` y `<noscript>` en una sola pasada (sin expresiones regulares que se disparen con páginas raras). */
function stripBlocks(html: string): string {
  const lower = html.toLowerCase();
  const open = /<(script|style|noscript)\b/g;
  let out = '', pos = 0, m: RegExpExecArray | null;
  while ((m = open.exec(lower)) && m.index >= pos) {
    out += html.slice(pos, m.index) + ' ';
    const close = lower.indexOf(`</${m[1]}>`, m.index);
    if (close < 0) return out; // sin cierre: el resto es de ese bloque
    pos = close + m[1]!.length + 3;
    open.lastIndex = pos;
  }
  return out + html.slice(pos);
}

function plainText(html: string): string {
  return decode(stripBlocks(html).replace(/<\/(?:p|div|li|tr|h\d|dt|dd|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ');
}

export function guessKind(url: string, title: string | null): ModKind {
  const hay = `${new URL(url).pathname} ${title ?? ''}`.toLowerCase();
  if (/(^|[\/_\- ])(tracks?|circuits?|circuitos?|layouts?)([\/_\-. ]|$)/.test(hay)) return 'track';
  if (/(^|[\/_\- ])(cars?|autos?|coches?|vehicles?)([\/_\-. ]|$)/.test(hay)) return 'car';
  return 'other';
}

/**
 * Quita de un título de página lo que sobra: «Ferrari 488 GT3 | Download Free Car Mod - Assetto Hub» → «Ferrari 488 GT3».
 * Solo corta tras un separador (| – — -) cuando lo que sigue parece publicidad de la web, no parte del nombre del mod.
 */
export function cleanModTitle(title: string | null): string | null {
  if (!title) return title;
  const tail = /\s*[|–—]\s*[^|–—]*$|\s+-\s+[^|–—]*$/;
  const noise = /(download|free|mod\b|mods\b|assetto\s*hub|assettohub|assetto\s*corsa|assettoworld|overtake|racedepartment|club|sim\s*racing)/i;
  let t = title.trim();
  for (let i = 0; i < 4; i++) {
    const m = tail.exec(t);
    if (!m || !noise.test(m[0]) || m.index === 0) break;
    t = t.slice(0, m.index).trim();
  }
  return t || title.trim();
}

/** Saca de una página HTML lo que sirve para la ficha. No ejecuta nada ni sigue enlaces. */
export function parseModHtml(html: string, pageUrl: string): ModInfo {
  const meta = metaTags(html);
  const ld = jsonLd(html);
  const titleTag = tagsOf(html, 'title', true).next().value?.body;
  const title = cleanModTitle(clean(meta.get('og:title') ?? meta.get('twitter:title') ?? ld.name ?? titleTag, 150));
  const description = clean(meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description') ?? ld.description, 500);
  let imageUrl: string | null = null;
  const rawImg = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? ld.image;
  if (rawImg) {
    try {
      const u = new URL(decode(rawImg).trim(), pageUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') imageUrl = u.toString().slice(0, 500);
    } catch { /* imagen no válida */ }
  }
  const text = plainText(html);
  const specs: Record<string, string> = {};
  for (const [label, re] of SPEC_PATTERNS) {
    const m = re.exec(text);
    const v = m ? clean(m[1], 40) : null;
    if (v) specs[label] = v;
  }
  return { url: pageUrl, title, description, imageUrl, siteName: clean(meta.get('og:site_name'), 60), kind: guessKind(pageUrl, title), specs };
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

export async function fetchModInfo(raw: string, opts: { fetcher?: Fetcher; resolve?: Resolver } = {}): Promise<ModInfo> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  let url = (await assertPublicUrl(raw, opts.resolve)).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Howler/1.0; +mod-info)', accept: 'text/html,application/xhtml+xml' } })
      .catch(() => { throw new Error('No se pudo abrir esa web (tiempo agotado o sin conexión).'); });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = (await assertPublicUrl(new URL(res.headers.get('location')!, url).toString(), opts.resolve)).toString();
      continue;
    }
    if (!res.ok) throw new Error(`La web respondió con error ${res.status}. Puede que bloquee la lectura automática: rellena la ficha a mano.`);
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) throw new Error('Ese enlace no es una página web (¿es una descarga directa?). Rellena la ficha a mano.');
    return parseModHtml(await readLimited(res, MAX_BYTES), url);
  }
  throw new Error('Demasiadas redirecciones.');
}
