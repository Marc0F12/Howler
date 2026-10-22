/**
 * Temas de la web: son DATOS (colores, forma, tipografía...), nunca código ni CSS libre.
 * El formato se valida de forma estricta; lo que no vale se rechaza al importar y se descarta al leer lo guardado.
 */
export const THEME_FORMAT = 'howler-theme';
export const THEME_VERSION = 1;

export const COLOR_KEYS = [
  'bg', 'surface', 'surface2', 'line', 'text', 'muted', 'accent', 'onAccent',
  'live', 'wait', 'down', 'gold', 'silver', 'bronze', 'best', 'personal', 'other',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const SHAPES = ['rounded', 'capsule', 'square'] as const;
export const TEXTURES = ['none', 'dots', 'carbon'] as const;
export const FONTS = ['system', 'geometric', 'condensed', 'extended', 'mono', 'grotesk', 'grotesk-narrow'] as const;
/** `boxed` = paneles con fondo y borde; `open` = sin caja, separados por un filete (torre de tiempos); `glass` = cristal esmerilado translúcido. */
export const PANELS = ['boxed', 'open', 'glass'] as const;
/** Puesto en un cuadradito claro con la cifra oscura (`tag`) o como número suelto. */
export const RANKS = ['plain', 'tag'] as const;
/** Mejores tiempos: solo el color del texto (`text`) o la casilla rellena (`fill`). */
export const BESTS = ['text', 'fill'] as const;
export const DENSITIES = ['compact', 'normal', 'roomy'] as const;
export const BASES = ['dark', 'light'] as const;
export type Shape = (typeof SHAPES)[number];
export type Texture = (typeof TEXTURES)[number];
export type FontKind = (typeof FONTS)[number];
export type PanelStyle = (typeof PANELS)[number];
export type RankStyle = (typeof RANKS)[number];
export type BestStyle = (typeof BESTS)[number];
export type Density = (typeof DENSITIES)[number];

export interface Theme {
  format: typeof THEME_FORMAT;
  version: number;
  /** Identificador corto (a-z, 0-9, guiones). Los de serie: original, f1, essential, gt. */
  id: string;
  name: string;
  base: (typeof BASES)[number];
  colors: Record<ColorKey, string>;
  /** Colores categóricos de las gráficas (8). */
  chart: string[];
  /** Radio base de las esquinas, en px (0-20). */
  radius: number;
  shape: Shape;
  texture: Texture;
  /** Tiras de datos que se difuminan a transparente por la derecha. */
  fade: boolean;
  font: FontKind;
  numberFont: FontKind;
  /** Multiplicador de la duración de las animaciones (0 = sin animación, 1 = normal). */
  motion: number;
  density: Density;
  /** Estilo de los paneles (opcional: sin él, `boxed`). */
  panels?: PanelStyle;
  /** Cómo se pinta el puesto (opcional: `plain`). */
  rank?: RankStyle;
  /** Cómo se marcan los mejores tiempos (opcional: `text`). */
  best?: BestStyle;
  /** Tipografía de títulos (opcional: la misma que el texto). */
  displayFont?: FontKind;
  /** Colores de la banda de «nuevo récord» (opcionales: sin ellos, el amarillo `wait` del tema con texto negro). */
  tickerBg?: string;
  tickerFg?: string;
}

/** Colores de las gráficas por defecto: paleta categórica validada para fondo oscuro con el validador del skill dataviz (separación para daltonismo y contraste ≥ 3:1). Orden fijo; el 9.º elemento no existe. */
const CHART = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** «Muro de boxes»: grafito cálido, sin tarjetas, marca monocroma (el único color de la pantalla es el dato), Archivo y cifras estrechas. */
const original: Theme = {
  format: THEME_FORMAT, version: THEME_VERSION, id: 'original', name: 'Original', base: 'dark',
  colors: {
    bg: '#0e0e0d', surface: '#151514', surface2: '#1c1c1a', line: '#2c2b28', text: '#eceae3', muted: '#8f8d85',
    accent: '#eceae3', onAccent: '#0e0e0d', live: '#35d07f', wait: '#f2c21b', down: '#ff4d3d',
    gold: '#e8c25a', silver: '#c7c9cc', bronze: '#cf8a56', best: '#b052ff', personal: '#2fe08f', other: '#f2c21b',
  },
  chart: CHART, radius: 2, shape: 'square', texture: 'none', fade: false, font: 'grotesk', numberFont: 'grotesk-narrow', motion: 1, density: 'normal', panels: 'open',
};

/** «Hoja de cronometraje»: variante clara del Original (papel cálido, tinta y un azul de tinta como único acento). Paleta de gráficas del skill dataviz para fondo claro. */
const originalLight: Theme = {
  ...original, id: 'original-light', base: 'light',
  colors: {
    bg: '#efece4', surface: '#f8f6f0', surface2: '#e6e2d7', line: '#cfcabc', text: '#14130f', muted: '#5f5c52',
    accent: '#1f3fd0', onAccent: '#ffffff', live: '#0b6b3b', wait: '#8a5f00', down: '#c4161c',
    gold: '#855a00', silver: '#646972', bronze: '#8a4f25', best: '#7a2ed0', personal: '#0b6b3b', other: '#8a5f00',
  },
  chart: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};

const f1: Theme = {
  format: THEME_FORMAT, version: THEME_VERSION, id: 'f1', name: 'F1', base: 'dark',
  colors: {
    bg: '#0a0a0c', surface: '#15151a', surface2: '#1e1e25', line: '#2e2e38', text: '#ffffff', muted: '#9b9ba8',
    accent: '#e10600', onAccent: '#ffffff', live: '#00d26a', wait: '#ffd400', down: '#ff4a40',
    gold: '#d4af37', silver: '#c0c0c8', bronze: '#cd7f32', best: '#bf5cf0', personal: '#00d26a', other: '#ffd400',
  },
  chart: CHART, radius: 4, shape: 'square', texture: 'none', fade: false, font: 'condensed', numberFont: 'condensed', motion: 1, density: 'normal',
};

const essential: Theme = {
  format: THEME_FORMAT, version: THEME_VERSION, id: 'essential', name: 'Essential', base: 'dark',
  colors: {
    bg: '#0d0f12', surface: '#16181d', surface2: '#1f2227', line: '#2b2f36', text: '#f2f3f5', muted: '#9aa0aa',
    accent: '#f2b705', onAccent: '#111111', live: '#19c24a', wait: '#f2b705', down: '#ff5a52',
    gold: '#f2b705', silver: '#c8ccd2', bronze: '#d58b55', best: '#c963d6', personal: '#19c24a', other: '#f2b705',
  },
  chart: CHART, radius: 12, shape: 'capsule', texture: 'dots', fade: false, font: 'geometric', numberFont: 'geometric', motion: 1, density: 'compact', panels: 'glass', rank: 'tag', best: 'fill', displayFont: 'extended',
};

const gt: Theme = {
  format: THEME_FORMAT, version: THEME_VERSION, id: 'gt', name: 'GT', base: 'dark',
  colors: {
    bg: '#16171a', surface: '#1f2023', surface2: '#2a2c31', line: '#3a3d44', text: '#f4f4f6', muted: '#9a9da6',
    accent: '#5a7be0', onAccent: '#0b0b0d', live: '#16a032', wait: '#e6b422', down: '#ff4a5c',
    gold: '#e6c34a', silver: '#c9ccd3', bronze: '#c98a55', best: '#b565e8', personal: '#16a032', other: '#e6c34a',
  },
  chart: CHART, radius: 3, shape: 'square', texture: 'carbon', fade: true, font: 'system', numberFont: 'extended', motion: 1, density: 'normal', rank: 'tag', best: 'fill',
};

/** Estilo de los menús de Content Manager (capturas de Marc): casi negro, rectas, texto pequeño y condensado, acento naranja. */
const cm: Theme = {
  format: THEME_FORMAT, version: THEME_VERSION, id: 'cm', name: 'CM',
  base: 'dark',
  colors: {
    bg: '#0a0b0a', surface: '#101111', surface2: '#1a1b1b', line: '#2a2b2b', text: '#d9d9d9', muted: '#8d8f8f',
    accent: '#ff4500', onAccent: '#111111', live: '#35b04a', wait: '#f2a30f', down: '#ff4b3e',
    gold: '#f2a30f', silver: '#b4b6b6', bronze: '#c0703a', best: '#b45cf0', personal: '#35b04a', other: '#f2a30f',
  },
  chart: CHART, radius: 1, shape: 'square', texture: 'none', fade: false, font: 'condensed', numberFont: 'condensed', motion: 0.4, density: 'compact',
};

export const BUILTIN_THEMES: readonly Theme[] = [original, originalLight, f1, essential, gt, cm];
/** Temas que se enseñan como tarjeta propia (el Original claro cuelga de la tarjeta Original). */
export const THEME_CARDS: readonly Theme[] = BUILTIN_THEMES.filter((th) => th.id !== 'original-light');
export const DEFAULT_THEME_ID = 'original';
export const builtinTheme = (id: string): Theme | undefined => BUILTIN_THEMES.find((t) => t.id === id);

/** Lo que se guarda: el id de un tema de serie, o un tema propio (importado) completo. */
export type ThemeSelection = string | Theme;

export type ThemeChecked = { ok: true; value: Theme } | { ok: false; error: string };
const bad = (error: string): ThemeChecked => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Validación estricta: cualquier campo desconocido o fuera de rango rechaza el tema (no se corrige a escondidas). */
export function validateTheme(input: unknown): ThemeChecked {
  if (!isObj(input)) return bad('El archivo no es un tema.');
  if (input.format !== THEME_FORMAT) return bad('No es un archivo de tema de Howler.');
  if (typeof input.version !== 'number' || input.version > THEME_VERSION) return bad('Versión de tema no admitida.');
  const allowed = new Set(['format', 'version', 'id', 'name', 'base', 'colors', 'chart', 'radius', 'shape', 'texture', 'fade', 'font', 'numberFont', 'motion', 'density', 'panels', 'rank', 'best', 'displayFont', 'tickerBg', 'tickerFg']);
  if (Object.keys(input).some((k) => !allowed.has(k))) return bad('El tema trae campos desconocidos.');
  if (typeof input.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(input.id)) return bad('El identificador del tema no es válido.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 40) return bad('El nombre del tema no es válido.');
  if (!oneOf(BASES, input.base)) return bad('El tipo de tema (claro/oscuro) no es válido.');
  if (!isObj(input.colors)) return bad('Faltan los colores del tema.');
  const colors = {} as Record<ColorKey, string>;
  for (const k of COLOR_KEYS) {
    const c = input.colors[k];
    if (typeof c !== 'string' || !HEX.test(c)) return bad('Los colores deben ser del tipo #rrggbb.');
    colors[k] = c.toLowerCase();
  }
  if (Object.keys(input.colors).some((k) => !(COLOR_KEYS as readonly string[]).includes(k))) return bad('El tema trae colores desconocidos.');
  if (!Array.isArray(input.chart) || input.chart.length !== 8 || input.chart.some((c) => typeof c !== 'string' || !HEX.test(c))) return bad('Las gráficas necesitan 8 colores #rrggbb.');
  if (typeof input.radius !== 'number' || !(input.radius >= 0 && input.radius <= 20)) return bad('El radio debe estar entre 0 y 20.');
  if (!oneOf(SHAPES, input.shape) || !oneOf(TEXTURES, input.texture) || !oneOf(FONTS, input.font) || !oneOf(FONTS, input.numberFont) || !oneOf(DENSITIES, input.density)) return bad('El tema trae una opción de forma, textura, tipografía o densidad que no existe.');
  if (input.panels !== undefined && !oneOf(PANELS, input.panels)) return bad('El estilo de paneles no existe.');
  if (input.rank !== undefined && !oneOf(RANKS, input.rank)) return bad('El estilo de puesto no existe.');
  if (input.best !== undefined && !oneOf(BESTS, input.best)) return bad('El estilo de mejores tiempos no existe.');
  if (input.displayFont !== undefined && !oneOf(FONTS, input.displayFont)) return bad('La tipografía de títulos no existe.');
  for (const k of ['tickerBg', 'tickerFg'] as const) if (input[k] !== undefined && (typeof input[k] !== 'string' || !HEX.test(input[k] as string))) return bad('Los colores de la banda de récord deben ser del tipo #rrggbb.');
  if (typeof input.fade !== 'boolean') return bad('La opción de difuminado no es válida.');
  if (typeof input.motion !== 'number' || !(input.motion >= 0 && input.motion <= 2)) return bad('El movimiento debe estar entre 0 y 2.');
  return {
    ok: true,
    value: {
      format: THEME_FORMAT, version: THEME_VERSION, id: input.id, name: input.name.trim(), base: input.base, colors,
      chart: (input.chart as string[]).map((c) => c.toLowerCase()), radius: input.radius, shape: input.shape, texture: input.texture,
      fade: input.fade, font: input.font, numberFont: input.numberFont, motion: input.motion, density: input.density,
      ...(input.panels ? { panels: input.panels } : {}),
      ...(input.rank ? { rank: input.rank } : {}),
      ...(input.best ? { best: input.best } : {}),
      ...(input.displayFont ? { displayFont: input.displayFont } : {}),
      ...(input.tickerBg ? { tickerBg: (input.tickerBg as string).toLowerCase() } : {}),
      ...(input.tickerFg ? { tickerFg: (input.tickerFg as string).toLowerCase() } : {}),
    },
  };
}

/** Tema que corresponde a lo guardado (id de serie o tema propio); lo desconocido cae al original. */
export function resolveTheme(sel: ThemeSelection | undefined | null): Theme {
  if (typeof sel === 'string') return builtinTheme(sel) ?? original;
  if (sel) { const c = validateTheme(sel); if (c.ok) return c.value; }
  return original;
}

/** Limpia lo guardado o recibido: devuelve undefined si es el tema de serie por defecto o no vale. */
export function sanitizeThemeSelection(raw: unknown): ThemeSelection | undefined {
  if (typeof raw === 'string') return builtinTheme(raw) && raw !== DEFAULT_THEME_ID ? raw : undefined;
  if (isObj(raw)) { const c = validateTheme(raw); if (c.ok) return c.value; }
  return undefined;
}

// --- Traducción a variables CSS ----------------------------------------------------------------------------------

export const FONT_STACKS: Record<FontKind, string> = {
  system: "'Segoe UI', system-ui, sans-serif",
  geometric: "'Outfit', 'Segoe UI', system-ui, sans-serif",
  condensed: "'Barlow Condensed', 'Arial Narrow', 'Segoe UI', system-ui, sans-serif",
  extended: "'Michroma', 'Segoe UI', system-ui, sans-serif",
  mono: "'Cascadia Mono', Consolas, monospace",
  grotesk: "'Archivo Variable', 'Archivo', 'Segoe UI', system-ui, sans-serif",
  'grotesk-narrow': "'Archivo Variable', 'Archivo', 'Segoe UI', system-ui, sans-serif",
};

const DENSITY_PAD: Record<Density, string> = { compact: '0.85', normal: '1', roomy: '1.2' };

const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const relLum = (hex: string) => { const [r, g, b] = toRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
const contrastOf = (a: string, b: string) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const mixHex = (a: string, b: string, k: number) => '#' + toRgb(a).map((v, i) => Math.round(v + (toRgb(b)[i]! - v) * k).toString(16).padStart(2, '0')).join('');

/** El acento como COLOR DE TEXTO: el propio acento si se lee (≥ 4,5:1) sobre fondo y superficies; si no, se acerca poco a poco al color del texto hasta que se lea. */
export function accentTextColor(c: Pick<Theme['colors'], 'accent' | 'text' | 'bg' | 'surface' | 'surface2'>): string {
  const ok = (col: string) => [c.bg, c.surface, c.surface2].every((bg) => contrastOf(col, bg) >= 4.5);
  if (ok(c.accent)) return c.accent;
  for (let k = 0.1; k < 1; k += 0.1) { const m = mixHex(c.accent, c.text, k); if (ok(m)) return m; }
  return c.text;
}

/** Variables CSS y atributos `data-*` que aplican el tema. El tema nunca produce CSS libre. */
export function themeVars(theme: Theme): { vars: Record<string, string>; attrs: Record<string, string> } {
  const c = theme.colors;
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;
  const vars: Record<string, string> = {
    '--bg': c.bg, '--surface': c.surface, '--surface-2': c.surface2, '--line': c.line, '--text': c.text, '--muted': c.muted,
    '--accent': c.accent, '--accent-text': accentTextColor(c), '--on-accent': c.onAccent, '--live': c.live, '--wait': c.wait, '--down': c.down,
    '--medal-gold': c.gold, '--medal-silver': c.silver, '--medal-bronze': c.bronze,
    '--sector-best': c.best, '--personal': c.personal, '--other': c.other, '--up': c.live, '--dn': c.down,
    '--r2': px(theme.radius * 0.8), '--r3': px(theme.radius), '--r4': px(theme.radius * 1.2),
    '--motion': String(theme.motion), '--pad': DENSITY_PAD[theme.density],
    '--font-ui': FONT_STACKS[theme.font], '--font-display': FONT_STACKS[theme.displayFont ?? theme.font], '--font-num': FONT_STACKS[theme.numberFont],
    '--font-num-var': theme.numberFont === 'grotesk-narrow' ? "'wdth' 75" : 'normal',
    'color-scheme': theme.base,
  };
  if (theme.tickerBg) vars['--ticker-bg'] = theme.tickerBg;
  if (theme.tickerFg) vars['--ticker-fg'] = theme.tickerFg;
  theme.chart.forEach((col, i) => { vars[`--chart-${i + 1}`] = col; });
  const attrs = { 'data-theme': theme.id, 'data-shape': theme.shape, 'data-texture': theme.texture, 'data-fade': theme.fade ? 'on' : 'off', 'data-density': theme.density, 'data-panels': theme.panels ?? 'boxed', 'data-base': theme.base, 'data-rank': theme.rank ?? 'plain', 'data-best': theme.best ?? 'text', 'data-numfont': theme.numberFont };
  return { vars, attrs };
}

/** Colores de acento a elegir (los 10 que ofrece Content Manager, aproximados). */
export const ACCENT_SWATCHES = ['#a30036', '#2b9dff', '#00aaa6', '#2f9e3f', '#8fc31f', '#f2a30f', '#ff4500', '#e3140a', '#ff0a9e', '#a40ae6'] as const;

/** Texto legible sobre un acento: oscuro si el acento es claro, blanco si es oscuro. */
export function onAccentFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  // El que dé más contraste: con blanco es 1,05/(l+0,05) y con el negro de la interfaz (#111111, luminancia ~0,0056) (l+0,05)/0,0556
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#ffffff' : '#111111';
}

/** El mismo tema con otro color de acento (tema propio `<id>-accent`, para guardarlo como cualquier otro). */
export function withAccent(theme: Theme, accent: string): Theme {
  const baseId = theme.id.replace(/-accent$/, '');
  const baseName = theme.name.replace(/ · acento$/, '');
  return { ...theme, id: `${baseId}-accent`.slice(0, 32), name: `${baseName} · acento`.slice(0, 40), colors: { ...theme.colors, accent, onAccent: onAccentFor(accent) } };
}

/** El mismo tema con otros colores de la banda de récord (`undefined` = el de serie). Un tema de serie pasa a ser propio (`<id>-custom`). */
export function withTicker(theme: Theme, bg: string | undefined, fg: string | undefined): Theme {
  const { tickerBg: _b, tickerFg: _f, ...rest } = theme;
  const next: Theme = { ...rest, ...(bg ? { tickerBg: bg.toLowerCase() } : {}), ...(fg ? { tickerFg: fg.toLowerCase() } : {}) };
  if (!BUILTIN_THEMES.some((b) => b.id === theme.id)) return next;
  return bg || fg ? { ...next, id: `${theme.id}-custom`.slice(0, 32), name: `${theme.name} · propio`.slice(0, 40) } : next;
}
