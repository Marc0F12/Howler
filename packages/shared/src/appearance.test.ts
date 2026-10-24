import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUTS, GRID_COLS, MODULE_META, PAGE_IDS, layoutOf, resolveLayout, sanitizeAppearance, settle, validateLayout } from './appearance';

describe('disposición', () => {
  it('toda la disposición de serie es válida y cada módulo existe', () => {
    for (const p of PAGE_IDS) {
      const c = validateLayout(layoutOf(p, DEFAULT_LAYOUTS[p]), p);
      expect(c.ok && c.value.modules.length).toBe(DEFAULT_LAYOUTS[p].length);
    }
    expect(new Set(MODULE_META.map((m) => m.id)).size).toBe(MODULE_META.length);
  });
  it('ignora módulos desconocidos, repetidos o de otra página y tamaños no permitidos', () => {
    const c = validateLayout({ format: 'howler-layout', version: 1, page: 'home', modules: [{ id: 'podium', size: 'half' }, { id: 'podium' }, { id: 'zzz' }, { id: 'cp-hero' }, { id: 'standings', size: 'third' }] });
    expect(c.ok && c.value.modules).toEqual([{ id: 'podium', size: 'half' }, { id: 'standings' }]);
  });
  it('rechaza otro formato o página', () => {
    expect(validateLayout({ format: 'x' }).ok).toBe(false);
    expect(validateLayout(layoutOf('home', []), 'session').ok).toBe(false);
  });
  it('resolveLayout añade al final los módulos nuevos', () => {
    const r = resolveLayout('home', [{ id: 'podium' }]);
    expect(r[0]).toMatchObject({ id: 'podium', x: 0, y: 0, w: 4 });
    expect(r.map((e) => e.id)).toContain('latest-records');
  });
});

describe('sanitizeAppearance', () => {
  it('tolera basura', () => {
    const display = { lang: 'auto', clock: '24h', dateOrder: 'auto', units: 'metric' };
    expect(sanitizeAppearance(null)).toEqual({ layouts: {}, display });
    expect(sanitizeAppearance({ layouts: { home: 3, x: [] } })).toEqual({ layouts: {}, display });
    expect(sanitizeAppearance({ display: { lang: 'fr', clock: '12h', dateOrder: 'ymd', units: 'imperial', extra: 1 } }).display).toEqual({ lang: 'auto', clock: '12h', dateOrder: 'ymd', units: 'imperial' });
  });
  it('conserva una disposición válida y limpia sus módulos', () => {
    const r = sanitizeAppearance({ layouts: { home: [{ id: 'podium', size: 'half' }, { id: 'zzz' }] } });
    expect(r.layouts.home).toEqual([{ id: 'podium', size: 'half' }]);
  });
});

describe('cuadrícula', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  it('la disposición de serie de cada página no solapa y cabe en 12 columnas', () => {
    for (const p of PAGE_IDS) {
      const r = resolveLayout(p, undefined).filter((e) => !e.hidden);
      for (const e of r) expect(e.x + e.w).toBeLessThanOrEqual(GRID_COLS);
      r.forEach((a, i) => r.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
    }
  });
  it('en la portada de serie el mapa y el podio van en la misma fila', () => {
    const r = resolveLayout('home', undefined);
    const map = r.find((e) => e.id === 'live-map')!, pod = r.find((e) => e.id === 'podium')!;
    expect(map).toMatchObject({ x: 0, w: 8 });
    expect(pod).toMatchObject({ x: 8, w: 4, y: map.y });
  });
  it('acepta un rectángulo válido y descarta uno fuera de la cuadrícula o de los límites del módulo', () => {
    const ok = validateLayout({ format: 'howler-layout', version: 2, page: 'home', modules: [{ id: 'podium', x: 2, y: 3, w: 5, h: 9 }] });
    expect(ok.ok && ok.value.modules[0]).toMatchObject({ id: 'podium', x: 2, y: 3, w: 5, h: 9 });
    for (const bad of [{ x: 10, y: 0, w: 5, h: 9 }, { x: 0, y: 0, w: 1, h: 9 }, { x: 0, y: 0, w: 4, h: 1 }, { x: 0.5, y: 0, w: 4, h: 9 }, { x: 0, y: -1, w: 4, h: 9 }]) {
      const c = validateLayout({ format: 'howler-layout', version: 2, page: 'home', modules: [{ id: 'podium', ...bad }] });
      expect(c.ok && c.value.modules[0]).toEqual({ id: 'podium' });
    }
  });
  it('settle baja el módulo que queda encima de otro', () => {
    const a = { id: 'a', x: 0, y: 0, w: 6, h: 4 }, b = { id: 'b', x: 3, y: 2, w: 6, h: 4 };
    expect(settle([a, b]).find((e) => e.id === 'b')).toMatchObject({ y: 4 });
  });
  it('una disposición con rectángulos solapados se corrige al resolverla', () => {
    const r = resolveLayout('home', [{ id: 'podium', x: 0, y: 0, w: 4, h: 8 }, { id: 'king', x: 2, y: 0, w: 6, h: 6 }]);
    const [a, b] = [r.find((e) => e.id === 'podium')!, r.find((e) => e.id === 'king')!];
    expect(overlap(a, b)).toBe(false);
  });
});

describe('tema del panel', () => {
  it('se guarda aparte, admite «original» y lo que no vale se descarta', () => {
    expect(sanitizeAppearance({ theme: 'gt', panelTheme: 'original' })).toMatchObject({ theme: 'gt', panelTheme: 'original' });
    expect(sanitizeAppearance({ panelTheme: 'no-existe' }).panelTheme).toBeUndefined();
    expect(sanitizeAppearance({ panelTheme: null }).panelTheme).toBeUndefined();
    expect(sanitizeAppearance({ theme: 'original' }).theme).toBeUndefined();
  });
});
