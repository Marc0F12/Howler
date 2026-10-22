import { describe, expect, it } from 'vitest';
import { driverKm } from './app';

describe('driverKm', () => {
  const lens: Record<string, number> = { monza: 5.793 };
  it('suma vueltas por longitud y ignora circuitos sin longitud', () => {
    const km = driverKm([{ track: 'monza', layout: '', laps: 10 }, { track: 'x', layout: '', laps: 99 }], (t) => lens[t] ?? null);
    expect(km).toBe(57.9);
  });
  it('es null si no se conoce ninguna longitud', () => {
    expect(driverKm([{ track: 'x', layout: '', laps: 3 }], () => null)).toBeNull();
  });
});
