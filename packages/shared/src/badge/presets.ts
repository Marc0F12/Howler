import {
  BADGE_BGS, BADGE_FINISHES, BADGE_ORNAMENTS, BADGE_RIMS, BADGE_SHAPES, BADGE_TEXT_MODES, OWN_EMBLEM_IDS, RIM_TEXT_SHAPES, darken, lighten,
  type BadgeOrnament, type BadgeShape, type Colors,
} from './catalog';
import { BADGE_FORMAT, BADGE_VERSION, DEFAULT_EMBLEM_FIT, type BadgeDesign } from './design';

export const BADGE_PALETTES: { name: string; colors: Colors }[] = [
  { name: 'Circuito', colors: { rim1: '#e8542a', rim2: '#ffffff', bg1: '#ffffff', bg2: '#16264d', accent: '#e7b93a', emblem: '#f7d21f', outline: '#2a2220', text: '#ffffff' } },
  { name: 'Oro y marino', colors: { rim1: '#d9a421', rim2: '#f5dd8c', bg1: '#1c2a5a', bg2: '#0e1633', accent: '#e8c25a', emblem: '#f2d36b', outline: '#3a2a08', text: '#f5e6b0' } },
  { name: 'Plata cielo', colors: { rim1: '#c9d1dd', rim2: '#ffffff', bg1: '#4aa3df', bg2: '#f2994a', accent: '#dfe6ee', emblem: '#ffd23f', outline: '#25313f', text: '#ffffff' } },
  { name: 'Rojo carrera', colors: { rim1: '#c4161c', rim2: '#ffd84a', bg1: '#6a1218', bg2: '#3c0a0e', accent: '#ffcf33', emblem: '#ffcf33', outline: '#2a0608', text: '#ffe9a8' } },
  { name: 'Verde bosque', colors: { rim1: '#2f7d4a', rim2: '#f4f1e4', bg1: '#e9f2e0', bg2: '#1e4d33', accent: '#d9b64c', emblem: '#2f7d4a', outline: '#10281a', text: '#ffffff' } },
  { name: 'Neón', colors: { rim1: '#1d1d2a', rim2: '#ff2fa0', bg1: '#14102e', bg2: '#2a1580', accent: '#2ff3e0', emblem: '#2ff3e0', outline: '#06041a', text: '#ff7ad0' } },
  { name: 'Bronce', colors: { rim1: '#b86b2d', rim2: '#f0b07a', bg1: '#2b1b12', bg2: '#150c07', accent: '#e0a060', emblem: '#e8a566', outline: '#1a0e07', text: '#f4d3b0' } },
  { name: 'Monocromo', colors: { rim1: '#eceae3', rim2: '#2b2b2b', bg1: '#2b2b2b', bg2: '#141414', accent: '#eceae3', emblem: '#eceae3', outline: '#000000', text: '#eceae3' } },
];
export const BADGE_COLOR_LABELS: Record<keyof Colors, string> = { rim1: 'Marco', rim2: 'Marco 2', bg1: 'Fondo', bg2: 'Fondo 2 / banda', accent: 'Adorno', emblem: 'Emblema', outline: 'Contorno', text: 'Texto' };

/** Un diseño completo con valores razonables; `over` sustituye lo que se quiera. */
export function newBadge(over: Partial<BadgeDesign> = {}): BadgeDesign {
  return {
    format: BADGE_FORMAT, version: BADGE_VERSION, shape: 'circle', rim: 'checker', bg: 'split', emblem: 'own:trophy', ornaments: ['laurel'], finish: 'gloss',
    textMode: 'band', text: '', text2: '', shadow: true, emblemFit: { ...DEFAULT_EMBLEM_FIT }, colors: { ...BADGE_PALETTES[0]!.colors }, ...over,
  };
}

/** Plantillas de partida del editor (usan emblemas de la biblioteca: se enseñan cuando ya está cargada). */
export const BADGE_PRESETS: { name: string; palette: number; design: Partial<BadgeDesign> }[] = [
  { name: 'Circuito', palette: 0, design: { shape: 'circle', rim: 'checker', bg: 'split', emblem: 'em:heavy-lightning', ornaments: ['laurel', 'stars'], finish: 'gloss', text: 'COPA HOWLER', textMode: 'band' } },
  { name: 'Moneda', palette: 1, design: { shape: 'circle', rim: 'rope', bg: 'solid', emblem: 'em:crown', ornaments: ['laurel', 'dots'], finish: 'metal', text: 'CAMPEONES', text2: 'COPA HOWLER', textMode: 'rim2' } },
  { name: 'Escudo', palette: 2, design: { shape: 'shield', rim: 'double', bg: 'sunset', emblem: 'em:achievement', ornaments: ['laurel', 'rays'], finish: 'metal', text: 'LIGA 2026', textMode: 'band' } },
  { name: 'Alas', palette: 3, design: { shape: 'shield', rim: 'solid', bg: 'solid', emblem: 'em:trophy-cup', ornaments: ['wings', 'rivets'], finish: 'enamel', text: 'PISTON CUP', textMode: 'ribbon' } },
  { name: 'Hexágono', palette: 5, design: { shape: 'hex', rim: 'pearls', bg: 'carbon', emblem: 'em:steering-wheel', ornaments: ['stars', 'rivets'], finish: 'carbon', text: 'DRIFT', textMode: 'band' } },
  { name: 'Sello', palette: 4, design: { shape: 'squircle', rim: 'double', bg: 'sunburst', emblem: 'em:checkered-flag', ornaments: ['flags', 'crown'], finish: 'gloss', text: 'GP', textMode: 'ribbon' } },
];

/** Generador pseudoaleatorio con semilla (mulberry32): misma semilla, misma serie. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Hash de texto a entero de 32 bits (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function pick<T>(rand: () => number, list: readonly T[]): T { return list[Math.floor(rand() * list.length)]!; }

/** Diseño al azar; `emblems` son los emblemas entre los que elegir (por defecto, solo los propios). */
export function randomBadge(rand: () => number, emblems: readonly string[] = OWN_EMBLEM_IDS.map((i) => 'own:' + i)): BadgeDesign {
  const shape: BadgeShape = pick(rand, BADGE_SHAPES);
  const modes = BADGE_TEXT_MODES.filter((m) => RIM_TEXT_SHAPES.includes(shape) || (m !== 'rim' && m !== 'rim2'));
  const words = ['COPA', 'LIGA', 'GP', 'TROFEO', 'DRIFT', 'RALLY', 'CAMPEONES', 'TOUGE', 'ENDURO'];
  return newBadge({
    shape, rim: pick(rand, BADGE_RIMS), bg: pick(rand, BADGE_BGS), emblem: pick(rand, emblems), finish: pick(rand, BADGE_FINISHES),
    ornaments: BADGE_ORNAMENTS.filter(() => rand() < 0.28), textMode: pick(rand, modes), text: pick(rand, words), text2: pick(rand, words),
    colors: { ...pick(rand, BADGE_PALETTES).colors },
  });
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const TIDY: BadgeOrnament[] = ['rays', 'laurel', 'stars', 'dots', 'rivets'];
/**
 * Insignia automática de un campeonato sin imagen: determinista (semilla = nombre), solo con emblemas propios (sin créditos ni biblioteca)
 * y con los colores de sus equipos si los hay.
 */
export function autoBadge(name: string, teamColors: readonly string[] = []): BadgeDesign {
  const rand = seededRandom(hashString(name.trim().toLowerCase() || 'howler'));
  const base = randomBadge(rand);
  // pocos adornos y nada que sobresalga: en una lista pequeña se ve más limpio
  const ornaments = TIDY.filter(() => rand() < 0.3).slice(0, 2);
  const cols = teamColors.filter((c) => HEX6.test(c)).map((c) => c.toLowerCase());
  let colors = base.colors;
  if (cols.length > 0) {
    const a = cols[0]!, b = cols[1];
    colors = { rim1: a, rim2: lighten(a, 0.8), bg1: darken(a, 0.72), bg2: darken(a, 0.86), accent: b ?? lighten(a, 0.35), emblem: b ? lighten(b, 0.25) : '#f2d36b', outline: darken(a, 0.9), text: '#ffffff' };
  }
  return { ...base, ornaments, textMode: 'none', text: '', text2: '', colors, shadow: false };
}
