import { describe, expect, it } from 'vitest';
import type { TraceDto } from '@howler/shared';
import { gearLabel, indexAt, lerpAngle, sampleAt, sampleChannel, sectorSplits, smoothPath } from './ghost-math';

const trace: TraceDto = {
  t: [0, 100, 200],
  x: [0, 10, 30],
  z: [0, 0, 20],
  h: [0, 0.5, 1],
  v: [100, 120, 140],
  gear: [3, 3, 4],
  rpm: [5000, 6000, 7000],
};

describe('ghost-math', () => {
  it('lerpAngle va por el camino corto', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 1); // pasa por π, no por 0
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('indexAt encuentra la última muestra anterior o igual', () => {
    expect(indexAt([0, 100, 200], -1)).toBe(-1);
    expect(indexAt([0, 100, 200], 0)).toBe(0);
    expect(indexAt([0, 100, 200], 150)).toBe(1);
    expect(indexAt([0, 100, 200], 999)).toBe(2);
  });

  it('sampleAt interpola posición, rumbo y velocidad entre muestras', () => {
    const s = sampleAt(trace, 150, 200);
    expect(s.x).toBeCloseTo(20); // mitad entre 10 y 30
    expect(s.z).toBeCloseTo(10);
    expect(s.h).toBeCloseTo(0.75);
    expect(s.v).toBeCloseTo(130);
    expect(s.finished).toBe(false);
  });

  it('antes del inicio se queda en la primera muestra y después del final, en la última y terminado', () => {
    expect(sampleAt(trace, -50, 200).x).toBe(0);
    const end = sampleAt(trace, 5000, 200);
    expect([end.x, end.z, end.finished]).toEqual([30, 20, true]);
  });

  it('la marcha se enseña como en el juego', () => {
    expect([gearLabel(0), gearLabel(1), gearLabel(2), gearLabel(5)]).toEqual(['R', 'N', '1', '4']);
  });
});

import { sectorRanges, summarizeSectors } from './ghost-math';

describe('sectores de los fantasmas', () => {
  it('quién gana cada sector y la vuelta óptima', () => {
    const s = summarizeSectors([{ sectorsMs: [30000, 40000, 20000] }, { sectorsMs: [31000, 39000, 20000] }, { sectorsMs: [] }]);
    expect(s.best).toEqual([30000, 39000, 20000]);
    expect(s.winner).toEqual([0, 1, null]); // el tercero empata
    expect(s.optimalMs).toBe(89000);
  });
  it('sin sectores en alguien no hay óptima', () => {
    expect(summarizeSectors([{ sectorsMs: [1, 2] }, { sectorsMs: [3] }]).best).toEqual([1, 2]);
    expect(summarizeSectors([{ sectorsMs: [] }]).optimalMs).toBeNull();
    expect(summarizeSectors([{ sectorsMs: [5, 0] }]).optimalMs).toBeNull();
  });
  it('rangos de muestras por sector, encadenados y hasta el final', () => {
    const t = [0, 100, 200, 300, 400, 500, 600];
    expect(sectorRanges(t, [250, 150, 200])).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(sectorRanges(t, [])).toEqual([]);
    expect(sectorRanges(t, [250, null])).toEqual([]);
  });
});

describe('subsectores y marcas', () => {
  // Recta de 1000 m recorrida en 10 s a 100 m/s, con muestras cada 100 ms
  const trace = { t: Array.from({ length: 101 }, (_, i) => i * 100), x: Array.from({ length: 101 }, (_, i) => i * 10), z: Array.from({ length: 101 }, () => 0) };
  it('da un límite por sector y reparte los subsectores por distancia', () => {
    const r = sectorSplits(trace, [4000, 6000], 2);
    expect(r.marks.filter((m) => m.sub === 0).map((m) => Math.round(m.x))).toEqual([0, 400]);
    expect(r.marks.find((m) => m.sector === 0 && m.sub === 1)!.x).toBeCloseTo(200, 0);
    expect(r.subMs[0]!.reduce((a, b) => a + b, 0)).toBeCloseTo(4000, 3);
    expect(r.subMs[1]!.map(Math.round)).toEqual([3000, 3000]);
  });
  it('sin subdivisión solo hay límites y un tramo por sector', () => {
    const r = sectorSplits(trace, [4000, 6000], 1);
    expect(r.marks.every((m) => m.sub === 0)).toBe(true);
    expect(r.subMs).toEqual([[4000], [6000]]);
  });
  it('suaviza sin mover extremos', () => {
    const s = smoothPath([0, 10, 0, 10, 0], [0, 0, 0, 0, 0], 1);
    expect(s.x[0]).toBe(0);
    expect(s.x[4]).toBe(0);
    expect(s.x[2]).toBeCloseTo(20 / 3, 5);
  });
});

describe('sampleChannel', () => {
  const t = [0, 100, 300], v = [0, 10, 50];
  it('interpola entre muestras y se queda en los extremos', () => {
    expect(sampleChannel(t, v, -5)).toBe(0);
    expect(sampleChannel(t, v, 50)).toBeCloseTo(5, 6);
    expect(sampleChannel(t, v, 200)).toBeCloseTo(30, 6);
    expect(sampleChannel(t, v, 300)).toBe(50);
    expect(sampleChannel(t, v, 9999)).toBe(50);
    expect(sampleChannel([], [], 10)).toBe(0);
  });
});
