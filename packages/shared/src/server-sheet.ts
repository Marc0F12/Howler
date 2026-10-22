// Ficha del servidor: lo que Content Manager (CM) enseña al elegir el servidor (título y descripción).
// La descripción (`ServerDescription` del extra_cfg.yml) es texto con etiquetas BBCode. TODO lo de aquí se
// copió del código fuente de CM (github.com/gro-ove/actools, FirstFloor.ModernUI/Windows/Controls/BbCode/*,
// BbCodeBlock.cs, Helpers/UrlHelper.cs y AcManager/Pages/Drive/OnlineServer.xaml), no de suposiciones:
//
// Etiquetas que entiende CM (distingue mayúsculas; cualquier otra se TRAGA: desaparece y queda su texto):
//   [b] [i] [u] [s] [mono] [sup] [color=#rrggbb|nombre] [size=píxeles] [url=enlace]texto[/url] [img=URL|tamaño]texto[/img]
//   [br] = salto de línea. `\[` = un corchete literal.
// - [size=N]: tamaño de letra en píxeles (el normal es 13).
// - [img=URL|N]texto[/img]: la dirección va en la etiqueta; `|N` = tamaño máximo (ancho y alto) y además hace la imagen
//   «ampliable» (al pulsarla se abre en un visor); hace falta texto dentro (es la ayuda al pasar el ratón) o no se dibuja.
//   Sin tamaño sale a su tamaño natural y no reacciona al pulsarla. Dentro de [url] es un enlace.
// - No existe [center] ni forma de alinear.
// - CM convierte en enlace las URL sueltas del texto (HighlightUrls) y los emojis en imágenes.
// - Las imágenes solo se dibujan si el jugador tiene activada «Load images in server descriptions» (activada de serie).
// - Cada salto de línea del texto es un salto de línea.

export const HOWLER_URL = 'https://github.com/Marc0F12/Howler';
/** Cabecera de Howler para el pie de la ficha (archivo del repositorio público; si GitHub no responde, CM no la enseña y el texto sigue saliendo). */
export const HOWLER_BANNER_URL = 'https://raw.githubusercontent.com/Marc0F12/Howler/main/assets/howler-cabecera-400x100.png';
/** Logo vertical pequeño (73×100 px, sin tamaño en la etiqueta para que CM no lo trate como ampliable) del repositorio público. */
export const HOWLER_LOGO_URL = 'https://raw.githubusercontent.com/Marc0F12/Howler/main/assets/howler-logo-vertical-100.png';
export const MAX_SHEET_TITLE = 100;
/** Tope de la descripción. El límite real de CM no se conoce: se queda muy por debajo de lo razonable. */
export const MAX_SHEET_CHARS = 6000;
export const MAX_IMG_WIDTH = 1200;

/** Solo http(s), sin espacios, corchetes, comillas ni «|» (que separa el tamaño en [img]). */
export const isSheetUrl = (u: string): boolean => /^https?:\/\/[^\s[\]"'<>|]{3,500}$/i.test(u);
/** Color que acepta CM (`ColorConverter` de WPF): #rgb, #rrggbb o un nombre como «red». */
export const isSheetColor = (c: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) || /^[a-z]{3,20}$/i.test(c);
const isPx = (s: string) => /^\d{1,2}$/.test(s) && Number(s) >= 6 && Number(s) <= 72;
const isWidth = (s: string) => /^\d{1,4}$/.test(s) && Number(s) >= 16 && Number(s) <= MAX_IMG_WIDTH;

/** Tamaño de letra normal de CM (píxeles). */
export const CM_FONT_PX = 13;
/** Tamaños de letra del editor (nivel de `<font size>` → píxeles de `[size=N]`). 3 = el normal. */
export const FONT_LEVEL_PX: Record<string, number> = { '1': 9, '2': 11, '3': CM_FONT_PX, '4': 16, '5': 20, '6': 26, '7': 34 };

const KNOWN = new Set(['b', 'i', 'u', 's', 'mono', 'sup', 'color', 'size', 'url', 'img']);

interface El { tag: string; arg: string; kids: Node[]; raw: string; rawClose: string; known: boolean; orphanClose?: boolean }
type Node = string | El;

/** Etiqueta de CM: nombre solo con letras o «*», valor opcional entre comillas o hasta el primer espacio. `\[` no abre etiqueta. */
const TAG_RE = /(?<!\\)\[(\/)?([A-Za-z*]+)(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*))\s*)?\]/g;

function parse(raw: string): Node[] {
  const src = raw.replace(/\r\n?/g, '\n');
  const root: Node[] = [];
  const stack: El[] = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.kids : root);
  let last = 0;
  for (const m of src.matchAll(TAG_RE)) {
    const text = src.slice(last, m.index);
    if (text) top().push(text);
    last = m.index + m[0].length;
    const name = m[2]!;
    if (!m[1] && name.toLowerCase() === 'br') { top().push('\n'); continue; } // [br] vale en cualquier mayúscula
    if (m[1]) {
      const at = stack.map((s) => s.tag).lastIndexOf(name);
      if (at >= 0) { stack[at]!.rawClose = m[0]; stack.length = at; }
      else top().push({ tag: name, arg: '', kids: [], raw: m[0], rawClose: '', known: false, orphanClose: true });
    } else {
      const el: El = { tag: name, arg: (m[3] ?? m[4] ?? m[5] ?? '').trim(), kids: [], raw: m[0], rawClose: '', known: KNOWN.has(name) };
      top().push(el);
      stack.push(el);
    }
  }
  const rest = src.slice(last);
  if (rest) top().push(rest);
  return root;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (kids: Node[]): string => kids.map((k) => (typeof k === 'string' ? k : plain(k.kids))).join('');

/** Texto de ayuda de una imagen: el nombre del archivo sin extensión (CM exige algún texto dentro de [img]). */
export function imageAlt(url: string): string {
  const base = (url.split(/[?#]/)[0] ?? '').split('/').pop() ?? '';
  return base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w .-]/g, '') || 'imagen';
}

/** Lee `[img=URL|N]alt[/img]` (y los formatos antiguos `[img]URL[/img]` y `[img=N]URL[/img]`). Null si la dirección no vale. */
function readImage(arg: string, kids: Node[]): { url: string; width: string; alt: string } | null {
  const inner = plain(kids).trim();
  let url = '';
  let width = '';
  if (/^\d{1,4}$/.test(arg)) { width = arg; url = inner; }
  else if (arg) { const m = /^(.*?)(?:\|(\d{1,4}))?$/.exec(arg)!; url = m[1]!.trim(); width = m[2] ?? ''; }
  else url = inner;
  if (!isSheetUrl(url)) return null;
  return { url, width: isWidth(width) ? width : '', alt: (url === inner ? '' : inner) || imageAlt(url) };
}

/** Reconstruye el BBCode: etiquetas conocidas con valores válidos limpias; lo que CM ignoraría se conserva tal cual (es del autor). */
function emit(kids: Node[]): string {
  return kids.map((k) => {
    if (typeof k === 'string') return k;
    const inner = emit(k.kids);
    if (k.orphanClose) return k.raw;
    if (!k.known) return k.tag === 'center' ? inner : `${k.raw}${inner}${k.rawClose}`; // [center] no existe en CM: se quita
    switch (k.tag) {
      case 'b': case 'i': case 'u': case 's': case 'mono': case 'sup': return `[${k.tag}]${inner}[/${k.tag}]`;
      case 'color': return isSheetColor(k.arg) ? `[color=${k.arg}]${inner}[/color]` : inner;
      case 'size': return isPx(k.arg) ? `[size=${k.arg}]${inner}[/size]` : inner;
      case 'url': return isSheetUrl(k.arg) ? `[url=${k.arg}]${inner}[/url]` : inner;
      case 'img': { const i = readImage(k.arg, k.kids); return i ? `[img=${i.url}${i.width ? `|${i.width}` : ''}]${i.alt}[/img]` : ''; }
      default: return inner;
    }
  }).join('');
}

/** Deja el BBCode limpio y en formato de CM. Se aplica siempre antes de guardar. */
export function cleanBbcode(src: string): string {
  return emit(parse(src)).replace(/\r/g, '').replace(/^\n+|\s+$/g, '');
}

// ---- URL sueltas → enlaces, como HighlightUrls de CM (UrlHelper.IsWebUrl, modo bbCode) ----
const TLD = 'com|net|org|gg|io|es|co|me|tv|eu|uk|de|fr|it|us|app|dev|xyz|info|club|ly|gl|be|ru|br|ar|mx|cl|pt|nl|pl|se|no|fi|dk|ch|at|ca|au|jp|cn|in|gov|edu|online|site|live|gaming|racing';
/** CM no enlaza una URL que venga justo después de una letra, «=», «.», «/», comillas… (así no rompe `[img=https://…]`). */
const URL_PREFIX = '(?<![\\w.%&?=@#"\'`/\\\\-])';
const URL_RE = new RegExp(`${URL_PREFIX}((?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)+(?:${TLD})(?![a-z0-9-])(?::\\d+)?(?:\\/[^\\s[\\]]*)?)`, 'gi');

/** Texto con sus URL sueltas convertidas en enlaces. La URL no puede ser corta (más de 3 caracteres) ni acabar en puntuación. */
function linkifyText(text: string, wrap: (url: string, label: string) => string, plainOut: (s: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[1]!.replace(/[.,:;!”»]+$/, '');
    if (url.length <= 3) continue;
    out += plainOut(text.slice(last, m.index)) + wrap(/^https?:\/\//i.test(url) ? url : `http://${url}`, url);
    last = m.index + url.length;
  }
  return out + plainOut(text.slice(last));
}

/** HTML (escapado) de un BBCode tal como lo dibuja CM. `linkify` = convertir las URL sueltas en enlaces como hace CM (la vista previa sí; el editor no, para no cambiar lo que se escribe). */
export function bbcodeToHtml(src: string, linkify = true): string {
  const text = (s: string) => esc(s.replace(/\\\[/g, '[')).replace(/\n/g, '<br>');
  const link = (url: string, label: string) => (isSheetUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noreferrer noopener">${esc(label)}</a>` : esc(label));
  const html = (kids: Node[], inUrl: boolean): string => kids.map((k) => {
    if (typeof k === 'string') return inUrl || !linkify ? text(k) : linkifyText(k, link, text);
    if (k.orphanClose || !k.known) return html(k.kids, inUrl); // CM se traga las etiquetas que no conoce
    const inner = html(k.kids, inUrl || k.tag === 'url');
    switch (k.tag) {
      case 'b': return `<b>${inner}</b>`;
      case 'i': return `<i>${inner}</i>`;
      case 'u': return `<u>${inner}</u>`;
      case 's': return `<s>${inner}</s>`;
      case 'sup': return `<sup>${inner}</sup>`;
      case 'mono': return `<span style="font-family:Consolas,monospace">${inner}</span>`;
      case 'color': return isSheetColor(k.arg) ? `<font color="${esc(k.arg)}">${inner}</font>` : inner;
      case 'size': return isPx(k.arg) ? `<span style="font-size:${k.arg}px">${inner}</span>` : inner;
      case 'url': return isSheetUrl(k.arg) ? `<a href="${esc(k.arg)}" target="_blank" rel="noreferrer noopener">${inner}</a>` : inner;
      case 'img': { const i = readImage(k.arg, k.kids); return i ? `<img src="${esc(i.url)}" alt="${esc(i.alt)}" title="${esc(i.alt)}" referrerpolicy="no-referrer"${i.width ? ` style="max-width:${i.width}px;max-height:${i.width}px"` : ''}>` : ''; }
      default: return inner;
    }
  }).join('');
  return html(parse(src), false);
}

/** Errores que impedirían guardar (en español; la web los pasa por `tm`). Lista vacía = bien. */
export function sheetProblems(title: string, description: string): string[] {
  const out: string[] = [];
  if (title.trim() === '') out.push('El título del servidor no puede estar vacío.');
  if (title.length > MAX_SHEET_TITLE) out.push(`El título es demasiado largo (máximo ${MAX_SHEET_TITLE} letras).`);
  if (/[\r\n]/.test(title)) out.push('El título tiene que ir en una sola línea.');
  if (description.length > MAX_SHEET_CHARS) out.push(`La descripción es demasiado larga (máximo ${MAX_SHEET_CHARS} caracteres).`);
  return out;
}

/** Enlace directo a una imagen a partir de lo que suele pegar la gente: una página de GitHub (/blob/) pasa al archivo sin más (raw). */
export function normalizeImageUrl(u: string): string {
  const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([^\s]+)$/i.exec(u.trim());
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : u.trim();
}

/** Aviso (no bloquea) sobre un enlace de imagen: 'discord' = caduca; 'page' = no parece un archivo de imagen. */
export function imageUrlWarning(u: string): 'discord' | 'page' | null {
  if (!isSheetUrl(u)) return null;
  if (/^https?:\/\/(cdn|media)\.discord(app)?\.(com|net)\//i.test(u)) return 'discord';
  const path = (u.split(/[?#]/)[0] ?? '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(path)) return null;
  if (/^https?:\/\/(i\.imgur\.com|raw\.githubusercontent\.com)\//i.test(u)) return null;
  return 'page';
}

// ---- DTO del panel ----
export interface ServerSheetDto {
  title: string;
  /** Descripción (BBCode) que hay ahora en el archivo del servidor. */
  description: string;
  /** `EnableServerDetails` del extra_cfg.yml: sin él, CM no enseña la descripción. */
  detailsEnabled: boolean;
  /** Archivo que falta: la ficha no se puede guardar. */
  missing: string | null;
  /** Sesiones del preset, para la vista previa (minutos y, en carrera, vueltas). */
  sessions: { kind: 'practice' | 'qualify' | 'race'; minutes: number; laps: number }[];
  /** El servidor tiene contraseña (CM enseña «Password»). */
  hasPassword: boolean;
}

/** Presets de descripción guardados por la persona (los de serie viven en la web). */
export interface SheetPresetsDto {
  presets: { id: string; name: string; description: string }[];
  /** Preset que se carga con la descripción vacía: de serie (`howler`, `empty`, `banner`, `rules`) o uno propio; null = el de Howler. */
  defaultId: string | null;
}
