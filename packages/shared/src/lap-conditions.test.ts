import { describe, expect, it } from 'vitest';
import { formatAids, sanitizeTemp } from './lap-conditions';

describe('ayudas', () => {
  it('solo enseña las activas y formatea estabilidad y rebufo', () => {
    expect(formatAids(null)).toEqual([]);
    expect(formatAids({})).toEqual([]);
    expect(formatAids({ abs: 0, tc: 0, line: 0, slip: 1 })).toEqual([]);
    expect(formatAids({ abs: 2, tc: 1, stability: 0.25, shift: 1, line: 1, slip: 0.5, blankets: 1 })).toEqual(['ABS', 'TC', 'Estabilidad 25 %', 'Cambio auto', 'Línea ideal', 'Rebufo ×0.5', 'Calentadores']);
  });
  it('temperaturas razonables o nada', () => {
    expect(sanitizeTemp(18)).toBe(18);
    expect(sanitizeTemp(Number.NaN)).toBeNull();
  });
});
