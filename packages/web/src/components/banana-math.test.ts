import { describe, expect, it } from 'vitest';
import { flightMs, flightPoint, FULL_CHARGE_MS, powerFromHold, stepVolume, volumeFromPower } from './banana-math';

describe('lanzamiento de banana', () => {
  it('la fuerza crece con el tiempo y se queda en 1', () => {
    expect(powerFromHold(0)).toBe(0);
    expect(powerFromHold(FULL_CHARGE_MS / 2)).toBeCloseTo(0.5);
    expect(powerFromHold(10_000)).toBe(1);
    expect(powerFromHold(-5)).toBe(0);
  });
  it('el volumen va de 5 % en 5 % y queda dentro de 0..1', () => {
    expect(volumeFromPower(0.52)).toBe(0.5);
    expect(volumeFromPower(0.98)).toBe(1);
    expect(volumeFromPower(2)).toBe(1);
    expect(volumeFromPower(-1)).toBe(0);
  });
  it('el vuelo dura menos de un segundo y acaba donde se pide', () => {
    expect(flightMs(1)).toBeLessThan(1000);
    const a = { x: 0, y: 0 }, b = { x: 100, y: 10 };
    expect(flightPoint(a, b, 30, 0)).toEqual(a);
    expect(flightPoint(a, b, 30, 1)).toEqual(b);
    expect(flightPoint(a, b, 30, 0.5).y).toBeLessThan(5);
  });
  it('las flechas mueven de 5 en 5 sin salirse', () => {
    expect(stepVolume(0.7, 1)).toBe(0.75);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
  });
});

import { ROULETTE_SLOTS, rouletteSlot, slotAt, slotOfVolume, slotVolume, spinTarget } from './banana-math';
describe('ruleta de volumen', () => {
  it('reparte las casillas de 0 % a 100 % y se elige una por número aleatorio', () => {
    expect(slotVolume(0)).toBe(0);
    expect(slotVolume(ROULETTE_SLOTS - 1)).toBe(1);
    expect(slotOfVolume(0.5)).toBe(5);
    expect(rouletteSlot(0)).toBe(0);
    expect(rouletteSlot(0.9999999)).toBe(ROULETTE_SLOTS - 1);
  });
  it('la rueda para con el puntero en la casilla elegida, tras varias vueltas', () => {
    for (let k = 0; k < ROULETTE_SLOTS; k++) {
      for (const start of [0, 123.4, 1000, -200]) {
        const end = spinTarget(start, k);
        expect(slotAt(end)).toBe(k);
        expect(end - start).toBeGreaterThanOrEqual(3 * 360);
      }
    }
  });
});
