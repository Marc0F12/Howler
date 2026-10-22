import { describe, expect, it } from 'vitest';
import { TICKER_MS, tickerStart } from './RecordTicker';

const NOW = 1_000_000;

describe('tickerStart: cuándo se enseña la tira de nuevo récord', () => {
  it('al abrir la página solo sale si el récord es de hace menos de 20 s, y cuenta desde que ocurrió', () => {
    expect(tickerStart(true, false, 5_000, true, NOW)).toBe(NOW - 5_000);
    expect(tickerStart(true, false, TICKER_MS - 1, true, NOW)).toBe(NOW - (TICKER_MS - 1));
    expect(tickerStart(true, false, TICKER_MS, true, NOW)).toBeNull();
    expect(tickerStart(true, false, 3 * 3600_000, true, NOW)).toBeNull();   // antes salía con récords de hasta 3 horas
    expect(tickerStart(true, false, -2_000, true, NOW)).toBeNull();         // reloj del navegador atrasado: no se inventa nada
  });
  it('con la página abierta, un récord nuevo empieza a contar ahora aunque los relojes no coincidan', () => {
    expect(tickerStart(false, true, 999_999, true, NOW)).toBe(NOW);
    expect(tickerStart(false, true, -999_999, true, NOW)).toBe(NOW);
  });
  it('si no cambia el récord no se vuelve a enseñar', () => {
    expect(tickerStart(false, false, 1_000, true, NOW)).toBeNull();
  });
  it('la primera vuelta de una combinación (sin tiempo anterior) no es un récord que anunciar', () => {
    expect(tickerStart(true, false, 1_000, false, NOW)).toBeNull();
    expect(tickerStart(false, true, 1_000, false, NOW)).toBeNull();
  });
});
