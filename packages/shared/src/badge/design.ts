import {
  BADGE_BGS, BADGE_COLOR_KEYS, BADGE_FINISHES, BADGE_ORNAMENTS, BADGE_RIMS, BADGE_SHAPES, BADGE_TEXT_MODES, OWN_EMBLEMS,
  type BadgeBg, type BadgeFinish, type BadgeOrnament, type BadgeRim, type BadgeShape, type BadgeTextMode, type Colors,
} from './catalog';

/**
 * Diseño de insignia: son DATOS (nada de código ni SVG libre). Se valida de forma estricta: un campo desconocido,
 * un valor fuera de lista o un color mal escrito rechazan el diseño entero.
 */
export const BADGE_FORMAT = 'howler-badge';
export const BADGE_VERSION = 1;
export const MAX_BADGE_TEXT = 20;

export interface EmblemFit { size: number; dx: number; dy: number; rot: number }
export const DEFAULT_EMBLEM_FIT: EmblemFit = { size: 100, dx: 0, dy: 0, rot: 0 };
/** Límites de los deslizadores del emblema. */
export const EMBLEM_FIT_LIMITS = { size: [40, 150], dx: [-40, 40], dy: [-40, 40], rot: [-45, 45] } as const;

export interface BadgeDesign {
  format: typeof BADGE_FORMAT;
  version: number;
  shape: BadgeShape;
  rim: BadgeRim;
  bg: BadgeBg;
  /** `own:<id>` (dibujado en código) o `em:<id>` (biblioteca de emblemas propios de Howler; `gi:<id>` es el nombre antiguo y se trata igual). */
  emblem: string;
  /** Adornos combinables, sin repetir y en el orden del catálogo. */
  ornaments: BadgeOrnament[];
  finish: BadgeFinish;
  textMode: BadgeTextMode;
  text: string;
  text2: string;
  shadow: boolean;
  emblemFit: EmblemFit;
  colors: Colors;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMBLEM_KEY = /^(own|em|gi):[a-z0-9][a-z0-9-]{0,63}$/;

const KEYS = ['format', 'version', 'shape', 'rim', 'bg', 'emblem', 'ornaments', 'finish', 'textMode', 'text', 'text2', 'shadow', 'emblemFit', 'colors'];

export type BadgeParse = { ok: true; badge: BadgeDesign } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
/** Quita caracteres de control e invisibles y recorta; el texto va a un SVG, así que `<` y `&` se escapan al dibujar. */
export const cleanBadgeText = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, MAX_BADGE_TEXT);

export function validateBadge(input: unknown): BadgeParse {
  const fail = (error: string): BadgeParse => ({ ok: false, error });
  if (!isObj(input)) return fail('El diseño no es un objeto.');
  for (const k of Object.keys(input)) if (!KEYS.includes(k)) return fail(`Campo desconocido: ${k}`);
  if (input.format !== BADGE_FORMAT) return fail('No es un diseño howler-badge.');
  if (input.version !== BADGE_VERSION) return fail('Versión de diseño no admitida.');
  if (!oneOf(BADGE_SHAPES, input.shape)) return fail('Forma no válida.');
  if (!oneOf(BADGE_RIMS, input.rim)) return fail('Marco no válido.');
  if (!oneOf(BADGE_BGS, input.bg)) return fail('Fondo no válido.');
  if (!oneOf(BADGE_FINISHES, input.finish)) return fail('Acabado no válido.');
  if (!oneOf(BADGE_TEXT_MODES, input.textMode)) return fail('Modo de texto no válido.');
  if (typeof input.emblem !== 'string' || !EMBLEM_KEY.test(input.emblem)) return fail('Emblema no válido.');
  if (input.emblem.startsWith('own:') && !OWN_EMBLEMS[input.emblem.slice(4)]) return fail('Emblema propio desconocido.');
  if (!Array.isArray(input.ornaments)) return fail('Adornos no válidos.');
  const ornaments: BadgeOrnament[] = [];
  for (const o of input.ornaments) {
    if (!oneOf(BADGE_ORNAMENTS, o)) return fail('Adorno no válido.');
    if (ornaments.includes(o)) return fail('Adorno repetido.');
    ornaments.push(o);
  }
  if (typeof input.text !== 'string' || typeof input.text2 !== 'string') return fail('Texto no válido.');
  if (input.text.length > MAX_BADGE_TEXT || input.text2.length > MAX_BADGE_TEXT) return fail('Texto demasiado largo.');
  if (typeof input.shadow !== 'boolean') return fail('Sombra no válida.');
  const fit = input.emblemFit;
  if (!isObj(fit)) return fail('Ajuste del emblema no válido.');
  for (const k of Object.keys(fit)) if (!(k in EMBLEM_FIT_LIMITS)) return fail(`Campo desconocido en el ajuste: ${k}`);
  const emblemFit = { ...DEFAULT_EMBLEM_FIT };
  for (const k of Object.keys(EMBLEM_FIT_LIMITS) as (keyof EmblemFit)[]) {
    const v = fit[k], [lo, hi] = EMBLEM_FIT_LIMITS[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return fail(`Ajuste del emblema fuera de rango: ${k}`);
    emblemFit[k] = v;
  }
  const col = input.colors;
  if (!isObj(col)) return fail('Colores no válidos.');
  for (const k of Object.keys(col)) if (!(BADGE_COLOR_KEYS as readonly string[]).includes(k)) return fail(`Color desconocido: ${k}`);
  const colors = {} as Colors;
  for (const k of BADGE_COLOR_KEYS) {
    const v = col[k];
    if (typeof v !== 'string' || !HEX.test(v)) return fail(`Color no válido: ${k}`);
    colors[k] = v.toLowerCase();
  }
  return {
    ok: true,
    badge: {
      format: BADGE_FORMAT, version: BADGE_VERSION, shape: input.shape, rim: input.rim, bg: input.bg, emblem: input.emblem,
      ornaments: BADGE_ORNAMENTS.filter((o) => ornaments.includes(o)), finish: input.finish, textMode: input.textMode,
      text: cleanBadgeText(input.text), text2: cleanBadgeText(input.text2), shadow: input.shadow, emblemFit, colors,
    },
  };
}

/** Los ids de icono de la biblioteca que usa el diseño (para regenerar los créditos). */
export const badgeIconIds = (b: Pick<BadgeDesign, 'emblem'>): string[] => (/^(em|gi):/.test(b.emblem) ? [b.emblem.slice(3)] : []);
