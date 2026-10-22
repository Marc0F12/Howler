/**
 * Apariencia de la web: disposición de módulos por página (los temas se añadirán más adelante). Formatos documentados en docs/MODULAR.md.
 * Todo lo que entra (archivo importado, configuración, API) pasa por estos validadores: lo inválido se rechaza o se descarta,
 * nunca se ejecuta ni se pinta tal cual.
 */

import { sanitizeThemeSelection, type ThemeSelection } from './theme';

export const LAYOUT_FORMAT = 'howler-layout';
export const FORMAT_VERSION = 2;

// --- Módulos ---------------------------------------------------------------------------------------------------

export const MODULE_SIZES = ['full', 'two-thirds', 'half', 'third'] as const;
export type ModuleSize = (typeof MODULE_SIZES)[number];

export const PAGE_IDS = ['home', 'session'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface ModuleMeta {
  id: string;
  /** Páginas donde se puede colocar. */
  pages: readonly PageId[];
  sizes: readonly ModuleSize[];
  /** De serie y, si cambia el tamaño, qué tamaño por página. */
  defaultSize: ModuleSize;
  /** Alto de serie en filas de la cuadrícula, y mínimos al redimensionar (columnas y filas). */
  defaultH: number;
  minW: number;
  minH: number;
}

const ALL: readonly ModuleSize[] = MODULE_SIZES;
const WIDE: readonly ModuleSize[] = ['full', 'two-thirds', 'half'];
const mod = (id: string, pages: PageId[], sizes: readonly ModuleSize[], defaultSize: ModuleSize, defaultH: number, minW = 3, minH = 2): ModuleMeta => ({ id, pages, sizes, defaultSize, defaultH, minW, minH });

/** Catálogo de módulos de la web. Los componentes y títulos viven en la web (`modules/registry`); aquí solo lo que hay que validar. */
export const MODULE_META: readonly ModuleMeta[] = [
  mod('session-head', ['home', 'session'], ['full'], 'full', 3, 4),
  mod('record-ticker', ['home'], ['full'], 'full', 3, 4, 2),
  mod('live-map', ['home'], ALL, 'two-thirds', 15, 3, 6),
  mod('podium', ['home', 'session'], ALL, 'third', 15, 3, 6),
  mod('standings', ['home', 'session'], ['full', 'two-thirds'], 'full', 16, 5, 6),
  mod('king', ['home', 'session'], ALL, 'full', 9, 3, 5),
  mod('latest-records', ['home'], WIDE, 'full', 14, 4, 5),
];
export const moduleMeta = (id: string): ModuleMeta | undefined => MODULE_META.find((m) => m.id === id);
/** Ancho de serie de un módulo en columnas. */
export const defaultCols = (m: ModuleMeta): number => Math.max(m.minW, COLS_OF[m.defaultSize]);

/** Cuadrícula: 12 columnas; cada fila mide `GRID_ROW_PX` y entre celdas hay `GRID_GAP_PX`. (x, y) es la esquina superior izquierda. */
export const GRID_COLS = 12;
export const GRID_ROW_PX = 24;
export const GRID_GAP_PX = 8;
export interface Rect { x: number; y: number; w: number; h: number }
const COLS_OF: Record<ModuleSize, number> = { full: 12, 'two-thirds': 8, half: 6, third: 4 };

/** Un módulo en la disposición. Sin rectángulo (disposiciones antiguas) se coloca en fila según `size` y su alto de serie. */
export interface LayoutEntry extends Partial<Rect> { id: string; size?: ModuleSize; hidden?: boolean }
export type PlacedEntry = LayoutEntry & Rect;
export interface Layout { format: typeof LAYOUT_FORMAT; version: number; page: PageId; modules: LayoutEntry[] }

const entry = (id: string, size?: ModuleSize, hidden?: boolean, rect?: Partial<Rect>): LayoutEntry => ({ id, ...(size ? { size } : {}), ...(hidden ? { hidden } : {}), ...(rect ?? {}) });
const hasRect = (e: LayoutEntry): e is PlacedEntry => e.x != null && e.y != null && e.w != null && e.h != null;

/** La disposición de serie de cada página. «Restaurar» siempre vuelve a esto. */
export const DEFAULT_LAYOUTS: Record<PageId, LayoutEntry[]> = {
  home: [entry('session-head'), entry('record-ticker'), entry('live-map', 'two-thirds'), entry('podium', 'third'), entry('standings'), entry('king'), entry('latest-records', 'full', true)],
  session: [entry('session-head'), entry('podium', 'full'), entry('standings'), entry('king')],
};

export const isPageId = (v: unknown): v is PageId => typeof v === 'string' && (PAGE_IDS as readonly string[]).includes(v);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Rectángulo válido (cuatro enteros dentro de la cuadrícula y de los límites del módulo) o nada: si no, el módulo se coloca solo. */
function cleanRect(raw: Record<string, unknown>, meta: ModuleMeta): Rect | undefined {
  const { x, y, w, h } = raw;
  if (![x, y, w, h].every((n) => Number.isInteger(n))) return undefined;
  const [X, Y, W, H] = [x, y, w, h] as number[];
  if (W! < meta.minW || W! > GRID_COLS || X! < 0 || X! + W! > GRID_COLS || H! < meta.minH || H! > 80 || Y! < 0 || Y! > 400) return undefined;
  return { x: X!, y: Y!, w: W!, h: H! };
}

/** Valida una disposición. Los módulos desconocidos o de otra página se ignoran (por compatibilidad con versiones futuras); los repetidos, también. */
export function validateLayout(input: unknown, page?: PageId): Checked<Layout> {
  if (!isObj(input)) return bad('El archivo no es una disposición.');
  if (input.format !== LAYOUT_FORMAT) return bad('No es un archivo de disposición de Howler.');
  if (typeof input.version !== 'number' || input.version > FORMAT_VERSION || input.version < 1) return bad('Versión de disposición no admitida.');
  if (!isPageId(input.page)) return bad('Página desconocida.');
  if (page && input.page !== page) return bad('La disposición es de otra página.');
  if (!Array.isArray(input.modules) || input.modules.length > 40) return bad('La lista de módulos no es válida.');
  const seen = new Set<string>();
  const modules: LayoutEntry[] = [];
  for (const raw of input.modules) {
    if (!isObj(raw) || typeof raw.id !== 'string') return bad('Hay un módulo mal formado.');
    const meta = moduleMeta(raw.id);
    if (!meta || !meta.pages.includes(input.page) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const size = (MODULE_SIZES as readonly unknown[]).includes(raw.size) && meta.sizes.includes(raw.size as ModuleSize) ? (raw.size as ModuleSize) : undefined;
    modules.push(entry(raw.id, size, raw.hidden === true, cleanRect(raw, meta)));
  }
  return { ok: true, value: { format: LAYOUT_FORMAT, version: FORMAT_VERSION, page: input.page, modules } };
}

export const layoutOf = (page: PageId, modules: LayoutEntry[]): Layout => ({ format: LAYOUT_FORMAT, version: FORMAT_VERSION, page, modules });

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Quita los solapes entre módulos visibles: si dos coinciden, el que está más abajo (o más a la derecha) baja hasta quedar libre. */
export function settle<T extends PlacedEntry>(items: T[]): T[] {
  const placed: T[] = [];
  const order = items.map((e, i) => ({ e, i })).filter(({ e }) => !e.hidden).sort((a, b) => a.e.y - b.e.y || a.e.x - b.e.x || a.i - b.i);
  const out = new Map<T, T>();
  for (const { e } of order) {
    let y = e.y;
    for (let again = true; again;) {
      again = false;
      for (const p of placed) if (overlaps({ ...e, y }, p)) { y = p.y + p.h; again = true; }
    }
    const moved = y === e.y ? e : { ...e, y };
    placed.push(moved);
    out.set(e, moved);
  }
  return items.map((e) => out.get(e) ?? e);
}

/** Disposición efectiva: la guardada + los módulos de la página que no estaban (al final; ocultos si lo eran de serie); todos con su rectángulo. */
export function resolveLayout(page: PageId, stored: LayoutEntry[] | undefined): PlacedEntry[] {
  const defaults = DEFAULT_LAYOUTS[page];
  const base = stored ?? defaults;
  const have = new Set(base.map((e) => e.id));
  const all = [...base, ...defaults.filter((d) => !have.has(d.id))];
  // Los que traen rectángulo se quedan donde están; el resto se coloca en fila debajo, según su ancho (`size`) y alto de serie.
  const fixed = all.filter((e) => hasRect(e) && !e.hidden);
  let y = fixed.reduce((m, e) => Math.max(m, (e.y ?? 0) + (e.h ?? 0)), 0);
  let x = 0, rowH = 0;
  const flowed = new Map<LayoutEntry, PlacedEntry>();
  for (const e of all) {
    if (hasRect(e) && !e.hidden) continue;
    const meta = moduleMeta(e.id);
    const w = hasRect(e) ? e.w : Math.max(meta?.minW ?? 1, COLS_OF[e.size ?? meta?.defaultSize ?? 'full']);
    const h = hasRect(e) ? e.h : meta?.defaultH ?? 8;
    if (e.hidden) { flowed.set(e, { ...e, x: hasRect(e) ? e.x : 0, y: hasRect(e) ? e.y : y, w, h }); continue; }
    if (x + w > GRID_COLS) { y += rowH; x = 0; rowH = 0; }
    flowed.set(e, { ...e, x, y, w, h });
    x += w; rowH = Math.max(rowH, h);
  }
  return settle(all.map((e) => (hasRect(e) && !e.hidden ? e : flowed.get(e)!)));
}

// --- Configuración guardada ------------------------------------------------------------------------------------

/** Idioma, hora, fecha y medidas de la web pública: los decide quien controla el panel y valen para todos los visitantes. «auto» = lo del navegador (idioma) o lo del idioma (hora y fecha). */
export const DISPLAY_LANGS = ['auto', 'es', 'en'] as const;
export const DISPLAY_CLOCKS = ['24h', '12h', 'auto'] as const;
export const DISPLAY_DATES = ['auto', 'dmy', 'mdy', 'ymd'] as const;
export const DISPLAY_UNITS = ['metric', 'imperial'] as const;
export interface DisplayConfig {
  lang: (typeof DISPLAY_LANGS)[number];
  clock: (typeof DISPLAY_CLOCKS)[number];
  dateOrder: (typeof DISPLAY_DATES)[number];
  units: (typeof DISPLAY_UNITS)[number];
}
export const DEFAULT_DISPLAY: DisplayConfig = { lang: 'auto', clock: '24h', dateOrder: 'auto', units: 'metric' };
const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
export function sanitizeDisplay(raw: unknown): DisplayConfig {
  const r = isObj(raw) ? raw : {};
  return { lang: pick(DISPLAY_LANGS, r.lang, DEFAULT_DISPLAY.lang), clock: pick(DISPLAY_CLOCKS, r.clock, DEFAULT_DISPLAY.clock), dateOrder: pick(DISPLAY_DATES, r.dateOrder, DEFAULT_DISPLAY.dateOrder), units: pick(DISPLAY_UNITS, r.units, DEFAULT_DISPLAY.units) };
}

export interface AppearanceConfig {
  /** Idioma, hora, fecha y medidas de la web. */
  display: DisplayConfig;
  /** Solo las páginas personalizadas; el resto usa la de serie. */
  layouts: Partial<Record<PageId, LayoutEntry[]>>;
  /** Tema elegido por el administrador: id de uno de serie o tema propio importado. Ausente = «original». */
  theme?: ThemeSelection;
}
export const DEFAULT_APPEARANCE: AppearanceConfig = { layouts: {}, display: DEFAULT_DISPLAY };

/** Limpia lo guardado o recibido: lo que no valga se descarta (nunca falla). */
export function sanitizeAppearance(raw: unknown): AppearanceConfig {
  const r = isObj(raw) ? raw : {};
  const layouts: AppearanceConfig['layouts'] = {};
  if (isObj(r.layouts)) {
    for (const page of PAGE_IDS) {
      const l = r.layouts[page];
      if (!Array.isArray(l)) continue;
      const c = validateLayout(layoutOf(page, l as LayoutEntry[]), page);
      if (c.ok) layouts[page] = c.value.modules;
    }
  }
  const theme = sanitizeThemeSelection(r.theme);
  const display = sanitizeDisplay(r.display);
  return theme === undefined ? { layouts, display } : { layouts, display, theme };
}
