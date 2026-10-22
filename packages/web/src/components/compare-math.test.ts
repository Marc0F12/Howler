import { describe, expect, it } from 'vitest';
import type { TraceDto } from '@howler/shared';
import { compareLaps, cumulativeDistance, indexAtTime, resampleByDistance, smooth, winnerRuns } from './compare-math';

/** Vuelta en línea recta de 1.000 m: velocidad `kmh(m)` en cada metro, muestras cada 100 ms. */
function straight(kmh: (m: number) => number, length = 1000): { trace: TraceDto; lapMs: number } {
  const t: number[] = [], x: number[] = [], v: number[] = [];
  let ms = 0, m = 0;
  while (m < length) {
    t.push(ms); x.push(m); v.push(kmh(m));
    const step = (kmh(m) / 3.6) * 0.1; // metros en 100 ms
    m += Math.max(step, 0.01);
    ms += 100;
  }
  return { trace: { t, x, z: x.map(() => 0), h: x.map(() => 0), v, gear: x.map(() => 3), rpm: x.map(() => 5000) }, lapMs: ms };
}

describe('compare-math', () => {
  it('cumulativeDistance suma los tramos entre muestras', () => {
    const tr = { t: [0, 1, 2], x: [0, 3, 3], z: [0, 4, 10], h: [0, 0, 0], v: [0, 0, 0], gear: [0, 0, 0], rpm: [0, 0, 0] };
    expect(cumulativeDistance(tr)).toEqual([0, 5, 11]);
  });

  it('la marcha se queda en la más cercana y las rpm se interpolan', () => {
    const lap = straight(() => 100);
    const r = resampleByDistance({ ...lap.trace, gear: lap.trace.t.map((_, i) => 2 + (i % 2)), rpm: lap.trace.t.map((_, i) => 1000 + i * 100) }, lap.lapMs, 30);
    expect(r.gear).toHaveLength(30);
    expect(r.gear.every((g) => g === 2 || g === 3)).toBe(true);
    expect(r.rpm[0]).toBeCloseTo(1000, 0);
  });

  it('resampleByDistance da el mismo número de puntos y ancla el tiempo de salida y de meta', () => {
    const lap = straight(() => 100);
    const r = resampleByDistance(lap.trace, lap.lapMs, 50);
    expect(r.t).toHaveLength(50);
    expect(r.t[0]).toBe(0);
    expect(r.t.at(-1)).toBe(lap.lapMs);
    expect(r.lengthM).toBeGreaterThan(900);
    // tiempos crecientes
    r.t.forEach((v, i) => { if (i > 0) expect(v).toBeGreaterThanOrEqual(r.t[i - 1]!); });
  });

  it('la diferencia final con la referencia es exactamente la diferencia de tiempos de vuelta', () => {
    const fast = straight(() => 180), slow = straight(() => 150);
    const c = compareLaps([slow, fast]);
    expect(c.ref).toBe(1);
    expect(c.deltaMs[1]!.every((d) => d === 0)).toBe(true);
    expect(c.deltaMs[0]!.at(-1)).toBeCloseTo(slow.lapMs - fast.lapMs, 5);
    expect(c.deltaMs[0]![0]).toBe(0);
    // el lento va perdiendo tiempo de forma continua en toda la recta
    expect(c.deltaMs[0]![200]!).toBeGreaterThan(0);
    expect(c.deltaMs[0]![200]!).toBeLessThan(c.deltaMs[0]!.at(-1)!);
  });

  it('winner marca quién va más rápido en cada zona: aquí el segundo gana solo a mitad de vuelta', () => {
    const a = straight((m) => (m < 500 ? 200 : 120));
    const b = straight((m) => (m < 500 ? 120 : 200));
    const c = compareLaps([a, b]);
    const runs = winnerRuns(c.winner);
    expect(runs[0]!.lap).toBe(0);
    expect(runs.at(-1)!.lap).toBe(1);
    expect(runs.length).toBeLessThanOrEqual(3); // sin parpadeos: una zona para cada uno
  });

  it('los canales de acelerador, freno y volante solo salen si TODAS las vueltas los tienen', () => {
    const withTel = (lap: ReturnType<typeof straight>, gas: number) => ({
      ...lap,
      trace: { ...lap.trace, gas: lap.trace.t.map(() => gas), brake: lap.trace.t.map((_, i) => (i < 5 ? 1 : 0)), steer: lap.trace.t.map(() => -0.5) },
    });
    const a = withTel(straight(() => 150), 0.8), b = withTel(straight(() => 140), 0.4);
    const c = compareLaps([a, b]);
    expect(c.gas).toHaveLength(2);
    expect(c.gas![0]!.every((v) => Math.abs(v - 0.8) < 1e-9)).toBe(true);
    expect(c.gas![1]![200]).toBeCloseTo(0.4, 6);
    expect(c.brake![0]![0]).toBe(1); // frenando al principio
    expect(c.brake![0]!.at(-1)).toBe(0);
    expect(c.steer![0]![100]).toBeCloseTo(-0.5, 6);
    expect(compareLaps([a, straight(() => 140)]).gas).toBeUndefined(); // una de las dos no tiene canales
  });

  it('smooth conserva los extremos y suaviza un pico', () => {
    const s = smooth([0, 0, 10, 0, 0], 3);
    expect(s[2]).toBeCloseTo(10 / 3, 5);
    expect(s).toHaveLength(5);
  });

  it('winnerRuns agrupa tramos consecutivos del mismo ganador', () => {
    expect(winnerRuns([0, 0, 1, 1, 1, 0])).toEqual([{ from: 0, to: 1, lap: 0 }, { from: 2, to: 4, lap: 1 }, { from: 5, to: 5, lap: 0 }]);
  });
});

import { approxAcceleration, driveStates, stateRuns } from './compare-math';

describe('estado de pedales y aceleración aproximada', () => {
  it('clasifica y agrupa', () => {
    const s = driveStates([1, 1, 0, 0, 0], [0, 0, 0, 1, 1]);
    expect(s).toEqual(['throttle', 'throttle', 'coast', 'brake', 'brake']);
    expect(stateRuns(s)).toEqual([{ from: 0, to: 1, state: 'throttle' }, { from: 2, to: 2, state: 'coast' }, { from: 3, to: 4, state: 'brake' }]);
  });
  it('un círculo a 72 km/h con radio 50 m da ~0,82 g laterales; una recta que acelera da g longitudinales', () => {
    const n = 200, R = 50, v = 20; // m/s
    const t = Array.from({ length: n }, (_, k) => k * 100);
    const circle = { t, v: t.map(() => v * 3.6), x: t.map((_, k) => R * Math.cos((v * k * 0.1) / R)), z: t.map((_, k) => R * Math.sin((v * k * 0.1) / R)) };
    const a = approxAcceleration(circle);
    expect(Math.abs(a.lat[100]!)).toBeGreaterThan(0.7);
    expect(Math.abs(a.lat[100]!)).toBeLessThan(0.95);
    const line = { t, v: t.map((_, k) => 50 + k * 0.5), x: t.map((_, k) => k), z: t.map(() => 0) };
    const b = approxAcceleration(line);
    expect(b.lon[100]!).toBeGreaterThan(0.1);
    expect(Math.abs(b.lat[100]!)).toBeLessThan(0.05);
  });
});

describe('delta sin pico falso al inicio', () => {
  it('las primeras muestras se enlazan con 0 y el final sigue siendo la diferencia exacta', () => {
    const slow = straight(() => 100), fast = straight(() => 120);
    const c = compareLaps([fast, slow]);
    const d = c.deltaMs[1]!;
    expect(d[0]).toBe(0);
    for (let k = 1; k < 5; k++) expect(Math.abs(d[k]!)).toBeLessThanOrEqual(Math.abs(d[4]!) + 1e-9);
    expect(d.at(-1)).toBeCloseTo(slow.lapMs - fast.lapMs, 5);
  });
});

describe('indexAtTime', () => {
  const t = [0, 100, 250, 400, 1000];
  it('devuelve el último punto que no supera el tiempo y se queda en los extremos', () => {
    expect(indexAtTime(t, -5)).toBe(0);
    expect(indexAtTime(t, 0)).toBe(0);
    expect(indexAtTime(t, 99)).toBe(0);
    expect(indexAtTime(t, 100)).toBe(1);
    expect(indexAtTime(t, 260)).toBe(2);
    expect(indexAtTime(t, 999)).toBe(3);
    expect(indexAtTime(t, 1000)).toBe(4);
    expect(indexAtTime(t, 99999)).toBe(4);
  });
});

describe('agarre', () => {
  it('100 % sin patinazo y baja con un bloqueo o con patinazo, sin salirse de 0-100', async () => {
    const { gripPct } = await import('./compare-math');
    expect(gripPct(0)).toBe(100);
    expect(gripPct(-1)).toBe(0);
    expect(gripPct(0.25)).toBe(75);
    expect(gripPct(-0.5)).toBe(50);
    expect(gripPct(3)).toBe(0);
  });
});
