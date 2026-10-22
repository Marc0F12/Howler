import {
  OUTSIDE_ORNAMENTS, OWN_EMBLEMS, RIM_TEXT_SHAPES, SHAPE_PATHS, TEXT_PATHS, darken, lighten, flameMarkup,
  type BadgeOrnament, type BadgeShape, type BadgeTextMode, type Colors,
} from './catalog';
import { mix } from './color';
import { DEFAULT_EMBLEM_FIT, type BadgeDesign } from './design';
import { pathBBox, pointsAlong, type Box } from './path-geometry';

/** Busca un icono de la biblioteca por su id (sin el prefijo `em:`); `d` es el trazo en un lienzo de 512×512. */
export type IconLookup = (id: string) => { d: string } | undefined;

export interface RenderOptions {
  /** Prefijo de los ids internos del SVG: tiene que ser único si hay varias insignias en línea en la misma página. */
  uid?: string;
  icons?: IconLookup;
  /** Sustituye la sombra del diseño (el PNG exportado va sin sombra). */
  shadow?: boolean;
}

const f1 = (n: number) => n.toFixed(1);
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "'Arial Black',Impact,system-ui,sans-serif";

/** Modo de texto efectivo: en escudo y hexágono el borde cambia de dirección, así que el texto del borde pasa a la banda. */
export function effectiveTextMode(d: Pick<BadgeDesign, 'shape' | 'textMode'>): BadgeTextMode {
  return (d.textMode === 'rim' || d.textMode === 'rim2') && !RIM_TEXT_SHAPES.includes(d.shape) ? 'band' : d.textMode;
}

/** ¿Algo sobresale del marco (y el lienzo se amplía)? */
export function badgeOverflows(d: Pick<BadgeDesign, 'ornaments' | 'textMode' | 'shape'>): boolean {
  return d.ornaments.some((a) => OUTSIDE_ORNAMENTS.has(a)) || effectiveTextMode(d) === 'ribbon';
}

export const BADGE_BOX_PLAIN = { w: 200, h: 200 } as const;
export const BADGE_BOX_WIDE = { w: 300, h: 290 } as const;
export function badgeViewBox(d: Pick<BadgeDesign, 'ornaments' | 'textMode' | 'shape'>): { x: number; y: number; w: number; h: number } {
  return badgeOverflows(d) ? { x: -50, y: -42, ...BADGE_BOX_WIDE } : { x: 0, y: 0, ...BADGE_BOX_PLAIN };
}

const boxCache = new Map<string, Box>();
const cachedBox = (d: string) => { let b = boxCache.get(d); if (!b) { b = pathBBox(d); boxCache.set(d, b); } return b; };
const pointCache = new Map<string, [number, number][]>();
const cachedPoints = (d: string, n: number, s: number) => { const k = `${d}|${n}|${s}`; let p = pointCache.get(k); if (!p) { p = pointsAlong(d, n, s); pointCache.set(k, p); } return p; };

function laurelBranch(c: Colors): string {
  let out = '';
  const R = 63;
  const stem = Array.from({ length: 12 }, (_, i) => { const a = ((100 + i * 11.5) * Math.PI) / 180; return [100 + R * Math.cos(a), 104 + R * Math.sin(a)] as const; });
  out += `<path d="M${stem.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L')}" fill="none" stroke="${darken(c.accent, 0.4)}" stroke-width="2.2" stroke-linecap="round"/>`;
  const leaf = 'M0 0C5.2 -5 5.2 -13.5 0 -20C-5.2 -13.5 -5.2 -5 0 0Z';
  for (let i = 0; i < 11; i++) {
    const phi = 100 + i * 11.5, a = (phi * Math.PI) / 180, x = 100 + R * Math.cos(a), y = 104 + R * Math.sin(a);
    const grow = 0.75 + Math.min(i, 6) * 0.05;
    for (const t of [-34, 34]) out += `<path d="${leaf}" transform="translate(${f1(x)} ${f1(y)}) rotate(${(phi + 180 + t).toFixed(0)}) scale(${grow.toFixed(2)})" fill="${c.accent}" stroke="${darken(c.accent, 0.4)}" stroke-width="1.1" stroke-linejoin="round"/>`;
  }
  const last = stem[stem.length - 1]!;
  out += `<circle cx="${f1(last[0])}" cy="${f1(last[1])}" r="3.4" fill="${lighten(c.accent, 0.35)}" stroke="${darken(c.accent, 0.4)}" stroke-width="1"/>`;
  return out;
}

function featherWing(c: Colors): string {
  let out = '';
  const feather = (len: number, a: number, fill: string) => `<path d="M0 0C${f1(len * 0.22)} ${f1(-len * 0.18)} ${f1(len * 0.68)} ${f1(-len * 0.2)} ${f1(len)} ${f1(-len * 0.05)}C${f1(len * 0.7)} ${f1(len * 0.11)} ${f1(len * 0.25)} ${f1(len * 0.12)} 0 ${f1(len * 0.06)}Z" transform="rotate(${a})" fill="${fill}" stroke="${c.outline}" stroke-width="2" stroke-linejoin="round"/>`;
  for (let i = 7; i >= 0; i--) out += feather(86 - i * 6.5, -4 - i * 11, c.accent);
  for (let i = 5; i >= 0; i--) out += feather(52 - i * 5, -10 - i * 14, lighten(c.accent, 0.35));
  return out;
}

function flagPair(c: Colors): string {
  const flag = `<g><rect x="-44" y="0" width="44" height="30" fill="${c.rim2}" stroke="${c.outline}" stroke-width="1.5"/>${[0, 1, 2, 3, 4, 5].map((x) => [0, 1, 2].map((y) => ((x + y) % 2 ? '' : `<rect x="${-44 + x * 7.33}" y="${y * 10}" width="7.33" height="10" fill="${c.outline}"/>`)).join('')).join('')}</g>`;
  const one = `<g><line x1="0" y1="0" x2="0" y2="290" stroke="${darken(c.accent, 0.15)}" stroke-width="5" stroke-linecap="round"/><line x1="0" y1="0" x2="0" y2="290" stroke="${c.outline}" stroke-width="1.2" opacity=".6"/>${flag}</g>`;
  return `<g transform="translate(34 -26) rotate(-29.4)">${one}</g><g transform="translate(166 -26) scale(-1 1) rotate(-29.4)">${one}</g>`;
}

const SHOULDER: Record<BadgeShape, number> = { circle: 12, shield: 22, hex: 22, squircle: 10 };

function ornamentsBack(set: Set<BadgeOrnament>, c: Colors, shape: BadgeShape): string {
  let out = '';
  if (set.has('flags')) out += flagPair(c);
  if (set.has('flames')) out += `<g transform="translate(-24 96) scale(.72) rotate(-12 50 50)">${flameMarkup(c.accent, lighten(c.accent, 0.5))}</g><g transform="translate(152 96) scale(.72) rotate(12 50 50)">${flameMarkup(c.accent, lighten(c.accent, 0.5))}</g><g transform="translate(-10 124) scale(.5) rotate(-30 50 50)">${flameMarkup(darken(c.accent, 0.1), lighten(c.accent, 0.4))}</g><g transform="translate(160 124) scale(.5) rotate(30 50 50)">${flameMarkup(darken(c.accent, 0.1), lighten(c.accent, 0.4))}</g>`;
  if (set.has('wings')) { const sx = SHOULDER[shape]; out += `<g transform="translate(${sx} 100) scale(-.78 .78)" stroke-linejoin="round">${featherWing(c)}</g><g transform="translate(${200 - sx} 100) scale(.78 .78)" stroke-linejoin="round">${featherWing(c)}</g>`; }
  return out;
}

function ornamentsInner(set: Set<BadgeOrnament>, c: Colors, d: string): string {
  let out = '';
  if (set.has('rays')) out += `<g opacity=".28">${Array.from({ length: 16 }, (_, i) => `<path d="M100 100L${f1(100 + 220 * Math.cos((i * 22.5 * Math.PI) / 180))} ${f1(100 + 220 * Math.sin((i * 22.5 * Math.PI) / 180))}L${f1(100 + 220 * Math.cos(((i * 22.5 + 11) * Math.PI) / 180))} ${f1(100 + 220 * Math.sin(((i * 22.5 + 11) * Math.PI) / 180))}Z" fill="${c.accent}"/>`).join('')}</g>`;
  if (set.has('dots')) out += cachedPoints(d, 30, 0.76).map((p) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.1" fill="${c.accent}"/>`).join('');
  if (set.has('laurel')) out += `<g>${laurelBranch(c)}</g><g transform="translate(200 0) scale(-1 1)">${laurelBranch(c)}</g>`;
  if (set.has('stars')) out += [0, 1, 2, 3, 4].map((i) => {
    const a = ((232 + i * 19) * Math.PI) / 180, x = 100 + 70 * Math.cos(a), y = 104 + 70 * Math.sin(a), sc = i === 2 ? 1.5 : i % 2 ? 1 : 1.2;
    const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => { const aa = -Math.PI / 2 + (k * Math.PI) / 5, r = (k % 2 ? 2.8 : 6.2) * sc; return f1(x + r * Math.cos(aa)) + ',' + f1(y + r * Math.sin(aa)); }).join(' ');
    return `<polygon points="${pts}" fill="${c.accent}" stroke="${c.outline}" stroke-width=".8"/>`;
  }).join('');
  return out;
}

function ornamentsFront(set: Set<BadgeOrnament>, c: Colors, d: string): string {
  let out = '';
  if (set.has('rivets')) out += cachedPoints(d, 8, 0.93).map((p) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4" fill="${c.accent}" stroke="${c.outline}" stroke-width="1.6"/><circle cx="${f1(p[0] - 1.2)}" cy="${f1(p[1] - 1.2)}" r="1.3" fill="#fff" opacity=".7"/>`).join('');
  if (set.has('crown')) out += `<g transform="translate(66 -26) scale(.68)" stroke="${c.outline}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"><path d="M8 76L14 26L34 52L50 18L66 52L86 26L92 76Z" fill="${c.accent}"/><rect x="8" y="78" width="84" height="12" rx="3" fill="${c.accent}"/><circle cx="14" cy="24" r="5" fill="${lighten(c.accent, 0.4)}"/><circle cx="50" cy="16" r="5" fill="${lighten(c.accent, 0.4)}"/><circle cx="86" cy="24" r="5" fill="${lighten(c.accent, 0.4)}"/></g>`;
  return out;
}

function emblemOf(key: string, c: Colors, icons?: IconLookup): { markup: string; box: Box } | null {
  if (key.startsWith('em:') || key.startsWith('gi:')) {
    const ic = icons?.(key.slice(3));
    return ic ? { markup: `<path d="${ic.d}" fill="${c.emblem}" fill-rule="evenodd"/>`, box: cachedBox(ic.d) } : null;
  }
  const own = OWN_EMBLEMS[key.replace(/^own:/, '')];
  return own ? { markup: own.markup(c), box: own.box } : null;
}

/** Dibuja la insignia como un SVG autónomo. Función pura: mismo diseño, mismo texto (no usa el DOM). */
export function renderBadge(st: BadgeDesign, opts: RenderOptions = {}): string {
  const uid = opts.uid ?? 'b';
  const c = st.colors, d = SHAPE_PATHS[st.shape], k = (n: string) => `${uid}-${n}`, set = new Set<BadgeOrnament>(st.ornaments);
  const inset = 'translate(100 100) scale(.855) translate(-100 -100)';
  const tp = TEXT_PATHS[st.shape];
  const mode = effectiveTextMode(st);
  const vbx = badgeViewBox(st);
  const vb = `${vbx.x} ${vbx.y} ${vbx.w} ${vbx.h}`;
  const shadow = opts.shadow ?? st.shadow;
  const metal = st.finish === 'metal';
  const rimFill = metal ? `url(#${k('rim')})` : c.rim1;
  const defs = `<defs>
    <clipPath id="${k('in')}"><path d="${d}" transform="${inset}"/></clipPath>
    <clipPath id="${k('out')}"><path d="${d}"/></clipPath>
    <linearGradient id="${k('rim')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(c.rim1, 0.55)}"/><stop offset=".35" stop-color="${c.rim1}"/><stop offset=".6" stop-color="${darken(c.rim1, 0.3)}"/><stop offset=".85" stop-color="${lighten(c.rim1, 0.25)}"/><stop offset="1" stop-color="${darken(c.rim1, 0.2)}"/></linearGradient>
    <linearGradient id="${k('sun')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg2}"/><stop offset=".55" stop-color="${mix(c.bg1, c.bg2, 0.4)}"/><stop offset="1" stop-color="${c.bg1}"/></linearGradient>
    <linearGradient id="${k('gl')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <pattern id="${k('chk')}" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${c.bg1}"/><rect width="12" height="12" fill="${c.bg2}"/><rect x="12" y="12" width="12" height="12" fill="${c.bg2}"/></pattern>
    <pattern id="${k('cb')}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#16171a"/><path d="M0 0H4V4H0ZM4 4H8V8H4Z" fill="#23252a"/></pattern>
    <filter id="${k('sh')}" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".45"/></filter>
  </defs>`;
  const sc = (n: number) => `transform="translate(100 100) scale(${n}) translate(-100 -100)"`;
  let rim = `<path d="${d}" fill="${rimFill}"/>`;
  if (st.rim === 'checker') rim += `<path d="${d}" ${sc(0.965)} pathLength="960" fill="none" stroke="${c.rim2}" stroke-width="6.5" stroke-dasharray="20 20"/><path d="${d}" ${sc(0.905)} pathLength="960" fill="none" stroke="${c.rim2}" stroke-width="6.5" stroke-dasharray="20 20" stroke-dashoffset="20"/>`;
  if (st.rim === 'double') rim += `<path d="${d}" ${sc(0.955)} fill="none" stroke="${c.rim2}" stroke-width="2.2"/><path d="${d}" ${sc(0.9)} fill="none" stroke="${c.rim2}" stroke-width="2.2"/>`;
  if (st.rim === 'pearls') rim += `<path d="${d}" ${sc(0.93)} pathLength="960" fill="none" stroke="${c.rim2}" stroke-width="6" stroke-linecap="round" stroke-dasharray="0.1 19.9"/>`;
  if (st.rim === 'rope') rim += `<path d="${d}" ${sc(0.93)} pathLength="960" fill="none" stroke="${c.rim2}" stroke-width="7" stroke-linecap="round" stroke-dasharray="10 10"/>`;
  rim += `<path d="${d}" fill="none" stroke="${c.outline}" stroke-width="3" stroke-linejoin="round"/>`;
  let bg: string;
  switch (st.bg) {
    case 'split': bg = `<rect width="200" height="200" fill="${c.bg1}"/><rect y="120" width="200" height="90" fill="${c.bg2}"/>`; break;
    case 'sunburst': bg = `<rect width="200" height="200" fill="${c.bg1}"/>${Array.from({ length: 12 }, (_, i) => `<path d="M100 100L${f1(100 + 200 * Math.cos((i * 30 * Math.PI) / 180))} ${f1(100 + 200 * Math.sin((i * 30 * Math.PI) / 180))}L${f1(100 + 200 * Math.cos(((i * 30 + 15) * Math.PI) / 180))} ${f1(100 + 200 * Math.sin(((i * 30 + 15) * Math.PI) / 180))}Z" fill="${c.bg2}"/>`).join('')}`; break;
    case 'stripes': bg = `<rect width="200" height="200" fill="${c.bg1}"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${-60 + i * 36}" y="-20" width="18" height="260" fill="${c.bg2}" transform="rotate(25 100 100)"/>`).join('')}`; break;
    case 'checker': bg = `<rect width="200" height="200" fill="url(#${k('chk')})"/>`; break;
    case 'sunset': bg = `<rect width="200" height="200" fill="url(#${k('sun')})"/>`; break;
    case 'carbon': bg = `<rect width="200" height="200" fill="url(#${k('cb')})"/><rect width="200" height="200" fill="${c.bg2}" opacity=".35"/>`; break;
    default: bg = `<rect width="200" height="200" fill="${c.bg1}"/>`;
  }
  if (st.finish === 'carbon' && st.bg !== 'carbon') bg += `<rect width="200" height="200" fill="url(#${k('cb')})" opacity=".35"/>`;

  const t1 = (st.text || '').trim(), t2 = (st.text2 || '').trim();
  // emblema: centrado por su caja real; tamaño, posición y giro se ajustan aparte
  const em = emblemOf(st.emblem, c, opts.icons);
  const E = st.emblemFit || DEFAULT_EMBLEM_FIT;
  const withBand = mode === 'band' && !!t1;
  let emblem = '';
  if (em) {
    const base = withBand ? 64 : 80;
    const s = (base * (E.size / 100)) / Math.max(em.box.w, em.box.h);
    const cx = 100 + E.dx, cy = (withBand ? 88 : 100) + E.dy;
    emblem = `<g transform="translate(${f1(cx)} ${f1(cy)}) rotate(${E.rot}) scale(${s.toFixed(4)}) translate(${f1(-(em.box.x + em.box.w / 2))} ${f1(-(em.box.y + em.box.h / 2))})"><g stroke="${c.outline}" stroke-width="${(4.5 / s).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${em.markup}</g></g>`;
  }

  // texto que sigue la forma
  const fit = (str: string, len: number) => Math.max(8, Math.min(16, len / (Math.max(str.length, 4) * 0.82)));
  const label = (id: string, str: string, len: number) => str ? `<text font-family="${FONT}" font-weight="900" font-size="${fit(str, len).toFixed(1)}" letter-spacing="1" fill="${c.text}" stroke="${c.outline}" stroke-width="2.2" paint-order="stroke" text-anchor="middle"><textPath href="#${id}" startOffset="50%" dominant-baseline="central">${esc(str.toUpperCase())}</textPath></text>` : '';
  let band = '', rimText = '', ribbon = '';
  if (withBand) band = `<path id="${k('tb')}" d="${tp.band}" fill="none" stroke="${c.bg2}" stroke-width="23"/>${label(k('tb'), t1, tp.bandLen)}`;
  const rimBand = (id: string, dd: string) => `<path id="${id}" d="${dd}" fill="none" stroke="${c.bg2}" stroke-width="15" opacity=".94"/>`;
  if ((mode === 'rim' || mode === 'rim2') && t1 && tp.rimB) rimText += rimBand(k('rb'), tp.rimB) + label(k('rb'), t1, tp.rimLen ?? 130);
  if (mode === 'rim2' && t2 && tp.rimT) rimText += rimBand(k('rt'), tp.rimT) + label(k('rt'), t2, tp.rimLen ?? 130);
  if (mode === 'ribbon' && t1) ribbon = `<g><path d="M10 152L-18 156L-6 168L-18 180L10 184Z" fill="${darken(c.bg2, 0.25)}" stroke="${c.outline}" stroke-width="2" stroke-linejoin="round"/><path d="M190 152L218 156L206 168L218 180L190 184Z" fill="${darken(c.bg2, 0.25)}" stroke="${c.outline}" stroke-width="2" stroke-linejoin="round"/><path d="M10 148Q100 176 190 148L190 184Q100 212 10 184Z" fill="${c.bg2}" stroke="${c.outline}" stroke-width="2.4" stroke-linejoin="round"/><path id="${k('rbn')}" d="M24 168Q100 194 176 168" fill="none"/>${label(k('rbn'), t1, 150)}</g>`;

  const inner = `<g clip-path="url(#${k('in')})">${bg}${ornamentsInner(set, c, d)}${emblem}${band}${st.finish === 'enamel' ? `<path d="${d}" transform="${inset}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="9"/>` : ''}</g><path d="${d}" transform="${inset}" fill="none" stroke="${c.outline}" stroke-width="2.4"/><g clip-path="url(#${k('out')})">${rimText}</g>`;
  const gloss = st.finish === 'gloss' || st.finish === 'metal' ? `<g clip-path="url(#${k('out')})"><ellipse cx="100" cy="46" rx="86" ry="50" fill="url(#${k('gl')})"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${defs}<g${shadow ? ` filter="url(#${k('sh')})"` : ''}>${ornamentsBack(set, c, st.shape)}${rim}${inner}${gloss}${ornamentsFront(set, c, d)}${ribbon}</g></svg>`;
}
