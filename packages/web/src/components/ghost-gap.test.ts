import { describe, expect, it } from 'vitest';
import { distanceAt, gapsAt, timeAtDistance, type GapLap } from './ghost-gap';

/** Vuelta recta a velocidad constante: `mps` metros por segundo, 1000 m, muestras cada 100 ms. */
const lap = (mps: number): GapLap => {
  const n = Math.ceil(1000 / (mps * 0.1)) + 1;
  const t = Array.from({ length: n }, (_, i) => i * 100);
  const cum = t.map((ms) => Math.min(1000, (ms / 1000) * mps));
  return { t, cum, lapMs: (1000 / mps) * 1000 };
};

describe('ghost-gap', () => {
  it('distancia e instante son inversos', () => {
    const a = lap(50);
    expect(distanceAt(a, 4000)).toBeCloseTo(200, 1);
    expect(timeAtDistance(a, 200)).toBeCloseTo(4000, 0);
    expect(timeAtDistance(a, 2000)).toBeNull();
    expect(distanceAt(a, 99999)).toBeCloseTo(1000, 1); // parado en meta
  });
  it('el líder va primero y el otro llega adonde está el líder 1 s después', () => {
    const fast = lap(50), slow = lap(40);
    const g = gapsAt([slow, fast], 10_000);
    expect(g.leader).toBe(1);
    expect(g.distM[0]).toBeCloseTo(100, 0);
    expect(g.gapMs[1]).toBe(0);
    // el líder lleva 500 m en 10 s; el lento (40 m/s) pasa por los 500 m a los 12,5 s: 2,5 s después
    expect(g.gapMs[0]!).toBeCloseTo(2500, -1);
  });
});
