import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BADGE_BGS, BADGE_FINISHES, BADGE_ORNAMENTS, BADGE_PALETTES, BADGE_PRESETS, BADGE_RIMS, BADGE_SHAPES, BADGE_TEXT_MODES, OWN_EMBLEM_IDS, SHAPE_PATHS,
  autoBadge, badgeIconIds, badgeViewBox, cleanBadgeText, effectiveTextMode, newBadge, pathBBox, pointsAlong, randomBadge, renderBadge,
  seededRandom, validateBadge, type BadgeDesign, type IconLookup,
} from './index';

const ICONS: { id: string; d: string }[] = JSON.parse(readFileSync(new URL('../../../web/src/badge/icons.json', import.meta.url), 'utf8'));
const byId = new Map(ICONS.map((i) => [i.id, i]));
const icons: IconLookup = (id) => byId.get(id);

/** ¿Está bien formado? Etiquetas que abren y cierran, atributos entre comillas y sin NaN. */
function wellFormed(svg: string): boolean {
  if (/NaN|undefined|Infinity/.test(svg)) return false;
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const [, close, name, attrs, self] = m;
    if (/="[^"]*$/.test(attrs!) || (attrs!.match(/"/g)?.length ?? 0) % 2) return false;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name!);
  }
  return stack.length === 0;
}

describe('geometría de trazados', () => {
  it('mide la caja de las formas', () => {
    const b = pathBBox(SHAPE_PATHS.circle);
    expect(b.x).toBeCloseTo(8, 0); expect(b.w).toBeCloseTo(184, 0); expect(b.h).toBeCloseTo(184, 0);
    const h = pathBBox(SHAPE_PATHS.hex);
    expect(h.x).toBe(20); expect(h.w).toBe(160); expect(h.y).toBe(6); expect(h.h).toBe(188);
  });
  it('reparte puntos por el contorno y los encoge hacia el centro', () => {
    const p = pointsAlong(SHAPE_PATHS.circle, 8, 1);
    expect(p).toHaveLength(8);
    for (const [x, y] of p) expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(92, 0);
    for (const [x, y] of pointsAlong(SHAPE_PATHS.circle, 8, 0.5)) expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(46, 0);
  });
  it('lee trazados relativos y con comandos encadenados', () => {
    const b = pathBBox('m10 10l20 0 0 30h-20z');
    expect(b).toMatchObject({ x: 10, y: 10, w: 20, h: 30 });
  });
});

describe('validación del formato howler-badge', () => {
  const ok = () => JSON.parse(JSON.stringify(newBadge()));
  it('acepta un diseño válido y lo devuelve normalizado', () => {
    const r = validateBadge({ ...ok(), text: '  Copa\u0007 ', colors: { ...newBadge().colors, rim1: '#ABCDEF' } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.badge.text).toBe('Copa'); expect(r.badge.colors.rim1).toBe('#abcdef'); }
  });
  it('rechaza campos desconocidos, valores fuera de lista y colores mal escritos', () => {
    expect(validateBadge({ ...ok(), extra: 1 }).ok).toBe(false);
    expect(validateBadge({ ...ok(), shape: 'star' }).ok).toBe(false);
    expect(validateBadge({ ...ok(), format: 'otro' }).ok).toBe(false);
    expect(validateBadge({ ...ok(), version: 2 }).ok).toBe(false);
    expect(validateBadge({ ...ok(), emblem: 'own:desconocido' }).ok).toBe(false);
    expect(validateBadge({ ...ok(), emblem: 'gi:<script>' }).ok).toBe(false);
    expect(validateBadge({ ...ok(), ornaments: ['laurel', 'laurel'] }).ok).toBe(false);
    expect(validateBadge({ ...ok(), ornaments: ['fuego'] }).ok).toBe(false);
    expect(validateBadge({ ...ok(), text: 'x'.repeat(21) }).ok).toBe(false);
    expect(validateBadge({ ...ok(), emblemFit: { size: 300, dx: 0, dy: 0, rot: 0 } }).ok).toBe(false);
    expect(validateBadge({ ...ok(), emblemFit: { size: 100, dx: 0, dy: 0, rot: 0, z: 1 } }).ok).toBe(false);
    expect(validateBadge({ ...ok(), colors: { ...ok().colors, text: 'red' } }).ok).toBe(false);
    expect(validateBadge({ ...ok(), colors: { ...ok().colors, extra: '#ffffff' } }).ok).toBe(false);
    expect(validateBadge(null).ok).toBe(false);
    expect(validateBadge([]).ok).toBe(false);
  });
  it('ordena los adornos y limpia el texto', () => {
    const r = validateBadge({ ...ok(), ornaments: ['crown', 'rays'] });
    expect(r.ok && r.badge.ornaments).toEqual(['rays', 'crown']);
    expect(cleanBadgeText('a‮b\n')).toBe('ab');
  });
  it('cada combinación del catálogo pasa la validación', () => {
    for (const shape of BADGE_SHAPES) for (const rim of BADGE_RIMS) for (const bg of BADGE_BGS) for (const finish of BADGE_FINISHES) for (const textMode of BADGE_TEXT_MODES) {
      expect(validateBadge(newBadge({ shape, rim, bg, finish, textMode })).ok).toBe(true);
    }
    for (const o of BADGE_ORNAMENTS) expect(validateBadge(newBadge({ ornaments: [o] })).ok).toBe(true);
    for (const e of OWN_EMBLEM_IDS) expect(validateBadge(newBadge({ emblem: 'own:' + e })).ok).toBe(true);
    for (const p of BADGE_PALETTES) expect(validateBadge(newBadge({ colors: p.colors })).ok).toBe(true);
  });
  it('los créditos salen del id del emblema', () => {
    expect(badgeIconIds(newBadge({ emblem: 'gi:crown' }))).toEqual(['crown']);
    expect(badgeIconIds(newBadge({ emblem: 'own:flag' }))).toEqual([]);
  });
});

describe('dibujo del SVG', () => {
  it('es determinista y está bien formado en todas las formas, marcos, fondos y acabados', () => {
    for (const shape of BADGE_SHAPES) for (const rim of BADGE_RIMS) for (const bg of BADGE_BGS) for (const finish of BADGE_FINISHES) {
      const d = newBadge({ shape, rim, bg, finish, text: 'COPA', ornaments: ['laurel', 'dots', 'rivets', 'stars', 'rays'] });
      const a = renderBadge(d, { uid: 't' });
      expect(a).toBe(renderBadge(d, { uid: 't' }));
      expect(wellFormed(a), `${shape}/${rim}/${bg}/${finish}`).toBe(true);
    }
  });
  it('cada modo de texto y adorno produce un SVG correcto', () => {
    for (const shape of BADGE_SHAPES) for (const textMode of BADGE_TEXT_MODES) for (const o of BADGE_ORNAMENTS) {
      const svg = renderBadge(newBadge({ shape, textMode, text: 'Hola & <adiós>', text2: 'Arriba', ornaments: [o] }), { icons });
      expect(wellFormed(svg), `${shape}/${textMode}/${o}`).toBe(true);
      expect(svg).not.toContain('<adiós>');
    }
  });
  it('el texto en el borde se degrada a banda en escudo y hexágono', () => {
    for (const shape of ['shield', 'hex'] as const) {
      expect(effectiveTextMode({ shape, textMode: 'rim' })).toBe('band');
      expect(effectiveTextMode({ shape, textMode: 'rim2' })).toBe('band');
      const svg = renderBadge(newBadge({ shape, textMode: 'rim2', text: 'ABAJO', text2: 'ARRIBA' }), { uid: 'q' });
      expect(svg).toContain('id="q-tb"');
      expect(svg).not.toContain('id="q-rb"');
    }
    for (const shape of ['circle', 'squircle'] as const) {
      const svg = renderBadge(newBadge({ shape, textMode: 'rim2', text: 'ABAJO', text2: 'ARRIBA' }), { uid: 'q' });
      expect(svg).toContain('id="q-rb"'); expect(svg).toContain('id="q-rt"'); expect(svg).not.toContain('id="q-tb"');
    }
  });
  it('amplía el lienzo solo si algo sobresale', () => {
    expect(badgeViewBox(newBadge({ ornaments: ['laurel'], textMode: 'band' })).w).toBe(200);
    expect(badgeViewBox(newBadge({ ornaments: ['wings'] })).w).toBe(300);
    expect(badgeViewBox(newBadge({ textMode: 'ribbon' })).w).toBe(300);
    expect(badgeViewBox(newBadge({ shape: 'hex', textMode: 'rim' })).w).toBe(200);
  });
  it('sin texto el emblema va centrado y con texto de banda sube', () => {
    const none = renderBadge(newBadge({ textMode: 'none', ornaments: [] }), { uid: 'n' });
    const band = renderBadge(newBadge({ textMode: 'band', text: 'X', ornaments: [] }), { uid: 'n' });
    expect(none).toMatch(/translate\(100\.0 100\.0\) rotate\(0\)/);
    expect(band).toMatch(/translate\(100\.0 88\.0\) rotate\(0\)/);
  });
  it('un emblema de la biblioteca sin la biblioteca cargada no rompe nada', () => {
    const svg = renderBadge(newBadge({ emblem: 'gi:crown' }));
    expect(wellFormed(svg)).toBe(true);
  });
  it('los ids internos llevan el prefijo pedido (varias insignias en la misma página)', () => {
    const a = renderBadge(newBadge(), { uid: 'uno' }), b = renderBadge(newBadge(), { uid: 'dos' });
    expect(a).toContain('id="uno-in"'); expect(b).not.toContain('uno-');
  });
  it('los 321 iconos de la biblioteca se dibujan con su caja real', () => {
    for (const ic of ICONS) {
      const svg = renderBadge(newBadge({ emblem: 'gi:' + ic.id, ornaments: [] }), { icons });
      expect(wellFormed(svg), ic.id).toBe(true);
      expect(svg, ic.id).toContain(`d="${ic.d}"`);
    }
  });
  it('las plantillas usan iconos que existen y son válidas', () => {
    for (const p of BADGE_PRESETS) {
      const d = newBadge({ ...p.design, colors: BADGE_PALETTES[p.palette]!.colors });
      expect(validateBadge(d).ok).toBe(true);
      expect(byId.has(d.emblem.slice(3)), p.name).toBe(true);
    }
  });
});

describe('insignia automática y al azar', () => {
  it('misma semilla, mismo diseño; distinto nombre, distinto diseño', () => {
    expect(autoBadge('Copa Howler')).toEqual(autoBadge('  copa howler '));
    const names = ['Copa Howler', 'Liga de invierno', 'GP Gandía', 'Touge Cup', 'Endurance 6h', 'Rally Sierra'];
    expect(new Set(names.map((n) => JSON.stringify(autoBadge(n)))).size).toBe(names.length);
  });
  it('es válida, no usa la biblioteca (sin créditos) y nada sobresale', () => {
    for (const n of ['a', 'Copa Howler', 'ñandú', '😀 liga', '']) {
      const b = autoBadge(n, ['#ff3300', '#0033ff']);
      expect(validateBadge(b).ok).toBe(true);
      expect(badgeIconIds(b)).toEqual([]);
      expect(b.emblem.startsWith('own:')).toBe(true);
      expect(badgeViewBox(b).w).toBe(200);
      expect(wellFormed(renderBadge(b, { uid: 'a' }))).toBe(true);
    }
  });
  it('toma los colores de los equipos, y ignora los que no son #rrggbb', () => {
    expect(autoBadge('X', ['#123456']).colors.rim1).toBe('#123456');
    expect(autoBadge('X', ['rojo']).colors).toEqual(autoBadge('X', []).colors);
  });
  it('randomBadge siempre devuelve diseños válidos', () => {
    const r = seededRandom(7);
    for (let i = 0; i < 200; i++) {
      const b: BadgeDesign = randomBadge(r, ICONS.map((x) => 'gi:' + x.id));
      expect(validateBadge(b).ok).toBe(true);
    }
  });
});
