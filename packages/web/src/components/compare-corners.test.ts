import { describe, expect, it } from 'vitest';
import { cornerStats, detectCorners, extremeCorner } from './compare-corners';
import type { compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;

/** Vuelta de 400 puntos con dos curvas lentas (en el 25 % y el 70 %) sobre una recta a 200 km/h. */
const profile = (dip1 = 120, dip2 = 90) => Array.from({ length: 400 }, (_, i) => {
  const x = i / 399;
  return 200 - dip1 * Math.exp(-(((x - 0.25) / 0.035) ** 2)) - dip2 * Math.exp(-(((x - 0.7) / 0.035) ** 2));
});

describe('detectCorners', () => {
  it('encuentra las curvas en orden y con su ventana alrededor del punto más lento', () => {
    const c = detectCorners(profile(), 2000);
    expect(c.map((k) => k.n)).toEqual([1, 2]);
    expect(Math.abs(c[0]!.im - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(c[1]!.im - 280)).toBeLessThanOrEqual(2);
    for (const k of c) { expect(k.i0).toBeLessThan(k.im); expect(k.i1).toBeGreaterThan(k.im); }
  });
  it('ignora los baches pequeños y las vueltas sin curvas', () => {
    expect(detectCorners(Array.from({ length: 400 }, (_, i) => 200 - 4 * Math.sin(i / 7)), 2000)).toEqual([]);
    expect(detectCorners([100, 100, 100], 1000)).toEqual([]);
  });
  it('las ventanas de dos curvas seguidas no se pisan', () => {
    const s = Array.from({ length: 400 }, (_, i) => 200 - 100 * Math.exp(-(((i - 100) / 9) ** 2)) - 100 * Math.exp(-(((i - 130) / 9) ** 2)));
    const c = detectCorners(s, 2000);
    expect(c.length).toBe(2);
    expect(c[0]!.i1).toBeLessThan(c[1]!.im);
  });
});

describe('cornerStats', () => {
  const ref = profile(), other = profile(130, 90).map((v, i) => v - (i > 200 ? 0 : 0));
  const deltaMs = [Array.from({ length: 400 }, () => 0), Array.from({ length: 400 }, (_, i) => (i < 100 ? 0 : i < 200 ? 80 : 90))];
  const cmp = { ref: 0, speed: [ref, other], deltaMs, laps: [{ lengthM: 2000 }, { lengthM: 2000 }] } as unknown as Comparison;
  it('mide velocidades y tiempo perdido por curva frente a la referencia', () => {
    const corners = detectCorners(ref, 2000);
    const stats = cornerStats(cmp, corners);
    expect(stats).toHaveLength(2);
    expect(stats[0]!.min[1]).toBeLessThan(stats[0]!.min[0]!);        // la otra vuelta es más lenta en la curva 1
    expect(stats[0]!.loseMs[0]).toBe(0);
    expect(stats[0]!.loseMs[1]).toBeGreaterThan(0);
    expect(stats[0]!.brakeM).toEqual([null, null]);                    // sin datos de freno
    expect(extremeCorner(stats, 1)?.corner.n).toBe(1);
    expect(extremeCorner(stats, 1, true)?.corner.n).toBe(2);
    expect(extremeCorner([], 1)).toBeNull();
  });
  it('compara el punto de frenada cuando hay freno', () => {
    const corners = detectCorners(ref, 2000);
    const brake = (from: number) => Array.from({ length: 400 }, (_, i) => (i >= from && i <= 100 ? 1 : 0));
    const withBrake = { ...cmp, brake: [brake(80), brake(86)] } as unknown as Comparison;
    const s = cornerStats(withBrake, corners);
    expect(s[0]!.brakeM[1]).toBeCloseTo(((86 - 80) / 399) * 2000, 3); // frena ~30 m más tarde
    expect(s[0]!.brakeM[0]).toBeNull();
  });
});
