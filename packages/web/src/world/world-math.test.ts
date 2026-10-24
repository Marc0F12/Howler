import { describe, expect, it } from 'vitest';
import { clampView, clusterPins, fitBounds, minZoom, project, toScreen, unproject, visibleTiles, TILE } from './world-math';

describe('proyección', () => {
  it('el ecuador y el meridiano 0 caen en el centro del mundo', () => {
    const p = project(0, 0);
    expect(p.x).toBeCloseTo(TILE / 2, 6);
    expect(p.y).toBeCloseTo(TILE / 2, 6);
  });
  it('proyectar y deshacer devuelve el mismo punto', () => {
    const { x, y } = project(41.57, 2.26);
    const back = unproject(x, y);
    expect(back.lat).toBeCloseTo(41.57, 6);
    expect(back.lon).toBeCloseTo(2.26, 6);
  });
  it('los polos se recortan a la latitud de Mercator', () => {
    expect(project(90, 0).y).toBeGreaterThanOrEqual(0);
    expect(project(-90, 0).y).toBeLessThanOrEqual(TILE);
  });
});

describe('vista', () => {
  it('no deja enseñar nada fuera del mundo', () => {
    const v = clampView({ cx: -50, cy: 999, zoom: 0 }, 1000, 600);
    expect(v.zoom).toBeGreaterThanOrEqual(minZoom(1000, 600));
    const tl = toScreen(v, 1000, 600, { x: 0, y: 0 });
    const br = toScreen(v, 1000, 600, { x: TILE, y: TILE });
    expect(tl.x).toBeLessThanOrEqual(0.001);
    expect(tl.y).toBeLessThanOrEqual(0.001);
    expect(br.x).toBeGreaterThanOrEqual(999.999);
    expect(br.y).toBeGreaterThanOrEqual(599.999);
  });
  it('encaja un rectángulo pequeño con más zoom que uno grande', () => {
    const small = project(41.5, 2.2), small2 = project(41.6, 2.3);
    const near = fitBounds({ x0: small.x, y0: small2.y, x1: small2.x, y1: small.y }, 1000, 600);
    const world = fitBounds({ x0: 0, y0: 0, x1: TILE, y1: TILE }, 1000, 600);
    expect(near.zoom).toBeGreaterThan(world.zoom);
  });
});

describe('agrupación', () => {
  const a = project(41.57, 2.26), b = project(41.58, 2.27), far = project(-33.9, 151.2);
  const items = [{ at: a, item: 'a' }, { at: b, item: 'b' }, { at: far, item: 'far' }];
  it('alejado, los circuitos cercanos se juntan', () => {
    const c = clusterPins(items, 3, 44);
    expect(c.map((g) => g.items.length).sort()).toEqual([1, 2]);
  });
  it('cerca, se separan', () => {
    const c = clusterPins(items, 15, 44);
    expect(c.every((g) => g.items.length === 1)).toBe(true);
  });
});

describe('agrupación sin separación', () => {
  it('dos trazados del mismo circuito no se separan nunca', () => {
    const p = project(41.57, 2.26);
    const c = clusterPins([{ at: p, item: 'gp' }, { at: p, item: 'moto' }], 18, 46);
    expect(c).toHaveLength(1);
    expect(c[0]!.splitless).toBe(true);
  });
  it('dos circuitos de la misma ciudad sí se separan al acercar', () => {
    const a = project(41.57, 2.26), b = project(41.60, 2.30);
    expect(clusterPins([{ at: a, item: 'a' }, { at: b, item: 'b' }], 3, 46)[0]!.splitless).toBe(false);
  });
});

describe('teselas', () => {
  it('cubren la ventana y no se salen del mundo', () => {
    const v = clampView({ cx: TILE / 2, cy: TILE / 2, zoom: 3 }, 800, 600);
    const tiles = visibleTiles(v, 800, 600, 3);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x < 8 && t.y < 8)).toBe(true);
    expect(tiles[0]!.size).toBeCloseTo(256);
  });
});
