import { darken, lighten } from './color';
import { pathBBox, type Box } from './path-geometry';

export const BADGE_SHAPES = ['circle', 'shield', 'hex', 'squircle'] as const;
export const BADGE_RIMS = ['solid', 'checker', 'double', 'pearls', 'rope'] as const;
export const BADGE_BGS = ['solid', 'split', 'sunburst', 'stripes', 'checker', 'sunset', 'carbon'] as const;
export const BADGE_FINISHES = ['flat', 'gloss', 'metal', 'enamel', 'carbon'] as const;
export const BADGE_TEXT_MODES = ['band', 'rim', 'rim2', 'ribbon', 'none'] as const;
export const BADGE_ORNAMENTS = ['rays', 'laurel', 'stars', 'dots', 'rivets', 'wings', 'flags', 'flames', 'crown'] as const;
export const BADGE_COLOR_KEYS = ['rim1', 'rim2', 'bg1', 'bg2', 'accent', 'emblem', 'outline', 'text'] as const;

export type BadgeShape = (typeof BADGE_SHAPES)[number];
export type BadgeRim = (typeof BADGE_RIMS)[number];
export type BadgeBg = (typeof BADGE_BGS)[number];
export type BadgeFinish = (typeof BADGE_FINISHES)[number];
export type BadgeTextMode = (typeof BADGE_TEXT_MODES)[number];
export type BadgeOrnament = (typeof BADGE_ORNAMENTS)[number];
export type BadgeColorKey = (typeof BADGE_COLOR_KEYS)[number];

/** Contorno de cada forma en un lienzo de 200×200. */
export const SHAPE_PATHS: Record<BadgeShape, string> = {
  circle: 'M100 8A92 92 0 1 1 99.99 8Z',
  shield: 'M100 8L180 28V96C180 146 148 176 100 194C52 176 20 146 20 96V28Z',
  hex: 'M100 6L180 52V148L100 194L20 148V52Z',
  squircle: 'M60 10H140C176 10 190 24 190 60V140C190 176 176 190 140 190H60C24 190 10 176 10 140V60C10 24 24 10 60 10Z',
};

/** El texto en el borde solo funciona donde el borde es una curva suave. */
export const RIM_TEXT_SHAPES: readonly BadgeShape[] = ['circle', 'squircle'];

export interface TextPaths { band: string; bandLen: number; rimB?: string; rimT?: string; rimLen?: number }
export const TEXT_PATHS: Record<BadgeShape, TextPaths> = {
  circle: { band: 'M44.6 132A64 64 0 0 0 155.4 132', bandLen: 134, rimB: 'M14 100A86 86 0 0 0 186 100', rimT: 'M14 100A86 86 0 0 1 186 100', rimLen: 250 },
  shield: { band: 'M36 122C42 152 72 170 100 180C128 170 158 152 164 122', bandLen: 150 },
  hex: { band: 'M42 142Q100 164 158 142', bandLen: 125 },
  squircle: { band: 'M42 152Q100 166 158 152', bandLen: 120, rimB: 'M34 183Q100 190 166 183', rimT: 'M34 17Q100 10 166 17', rimLen: 132 },
};

/** Adornos que sobresalen del marco (amplían el lienzo). */
export const OUTSIDE_ORNAMENTS: ReadonlySet<BadgeOrnament> = new Set(['wings', 'flags', 'flames', 'crown']);

export type Colors = Record<BadgeColorKey, string>;

export function flameMarkup(a: string, b: string): string {
  return `<path d="M50 4C58 28 80 38 78 64C76 84 62 96 50 96C38 96 24 84 22 64C20 48 32 40 36 26C42 38 46 36 50 4Z" fill="${a}"/><path d="M50 52C56 64 64 68 62 78C60 86 55 90 50 90C45 90 40 86 38 78C36 68 46 64 50 52Z" fill="${b}"/>`;
}

const star10 = (cx: number, cy: number, ro: number, ri: number) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? ri : ro; return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }).join(' ');

export interface OwnEmblem { name: string; box: Box; markup: (c: Colors) => string }
/** Emblemas dibujados aquí (sin licencia ajena); cada uno trae su caja real para centrarlo. Sus ids se usan como `own:<id>`. */
export const OWN_EMBLEMS: Record<string, OwnEmblem> = {
  bolt: { name: 'Rayo', box: { x: 24, y: 4, w: 54, h: 92 }, markup: (c) => `<polygon points="56,4 24,56 46,56 38,96 78,38 54,38" fill="${c.emblem}"/>` },
  star: { name: 'Estrella', box: { x: 6.2, y: 8, w: 87.6, h: 83.2 }, markup: (c) => `<polygon points="${star10(50, 54, 46, 20)}" fill="${c.emblem}"/>` },
  crown: { name: 'Corona', box: { x: 8, y: 11, w: 84, h: 79 }, markup: (c) => `<path d="M8 76L14 26L34 52L50 18L66 52L86 26L92 76Z" fill="${c.emblem}"/><rect x="8" y="78" width="84" height="12" rx="3" fill="${c.emblem}"/><circle cx="14" cy="24" r="5" fill="${c.emblem}"/><circle cx="50" cy="16" r="5" fill="${c.emblem}"/><circle cx="86" cy="24" r="5" fill="${c.emblem}"/>` },
  trophy: { name: 'Copa', box: { x: 10, y: 10, w: 80, h: 82 }, markup: (c) => `<path d="M26 10H74V40C74 60 62 68 50 68C38 68 26 60 26 40Z" fill="${c.emblem}"/><path d="M26 18H10C10 40 18 48 30 50M74 18H90C90 40 82 48 70 50" fill="none" stroke="${c.emblem}" stroke-width="7"/><path d="M44 68H56V82H70V92H30V82H44Z" fill="${c.emblem}"/>` },
  flag: { name: 'Bandera', box: { x: 12, y: 6, w: 76, h: 88 }, markup: (c) => `<rect x="12" y="6" width="7" height="88" rx="3" fill="${c.emblem}"/>${[0, 1, 2, 3].map((x) => [0, 1, 2].map((y) => `<rect x="${24 + x * 16}" y="${10 + y * 16}" width="16" height="16" fill="${(x + y) % 2 ? c.emblem : c.outline}"/>`).join('')).join('')}` },
  wheel: { name: 'Volante', box: { x: 12, y: 12, w: 76, h: 78 }, markup: (c) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${c.emblem}" stroke-width="10"/><path d="M12 54H88M50 54V90M50 50L22 30M50 50L78 30" stroke="${c.emblem}" stroke-width="9" stroke-linecap="round"/><circle cx="50" cy="50" r="10" fill="${c.emblem}"/>` },
  flame: { name: 'Llama', box: pathBBox('M50 4C58 28 80 38 78 64C76 84 62 96 50 96C38 96 24 84 22 64C20 48 32 40 36 26C42 38 46 36 50 4Z'), markup: (c) => flameMarkup(c.emblem, lighten(c.emblem, 0.55)) },
  tire: { name: 'Neumático', box: { x: 10, y: 10, w: 80, h: 80 }, markup: (c) => `<circle cx="50" cy="50" r="40" fill="${c.emblem}"/><circle cx="50" cy="50" r="26" fill="${c.outline}"/><circle cx="50" cy="50" r="18" fill="${c.emblem}"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="47" y="22" width="6" height="14" fill="${c.outline}" transform="rotate(${i * 72} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="5" fill="${c.outline}"/>` },
};
export const OWN_EMBLEM_IDS = Object.keys(OWN_EMBLEMS);

export { darken, lighten };
