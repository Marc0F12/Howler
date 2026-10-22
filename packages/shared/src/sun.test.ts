import { describe, expect, it } from 'vitest';
import { dayOfYear, parseGeotags, skyPhase, sunAt, sunTimes } from './sun';

const madrid = { lat: 40.4, lon: -3.7 };

describe('posición del sol', () => {
  it('en el solsticio de verano sale temprano, se pone tarde y al mediodía está alto', () => {
    const t = sunTimes(madrid, 172);
    // El reloj del modelo sigue el huso de 15° más cercano (aquí UTC): el sol sale ~4:45 y se pone ~19:30.
    expect(t.sunrise!).toBeGreaterThan(4 * 60);
    expect(t.sunrise!).toBeLessThan(5.5 * 60);
    expect(t.sunset!).toBeGreaterThan(19 * 60);
    expect(t.sunset!).toBeLessThan(20.5 * 60);
    expect(sunAt(madrid, 172, 12 * 60 + 15).elevation).toBeGreaterThan(65);
  });
  it('en invierno el día es corto y el sol bajo', () => {
    const t = sunTimes(madrid, 355);
    expect(t.sunrise!).toBeGreaterThan(7 * 60);
    expect(t.sunset!).toBeLessThan(18.5 * 60);
    expect(sunAt(madrid, 355, 12 * 60).elevation).toBeLessThan(30);
  });
  it('de noche está bajo el horizonte y en los polos puede no haber amanecer', () => {
    expect(sunAt(madrid, 172, 2 * 60).elevation).toBeLessThan(0);
    expect(sunTimes({ lat: 80, lon: 0 }, 355)).toEqual({ sunrise: null, sunset: null, polar: 'night' });
    expect(sunTimes({ lat: 80, lon: 0 }, 172).polar).toBe('day');
  });
  it('las fases siguen el día', () => {
    const phases = [2, 4.4, 5.5, 12, 19.3, 20.2].map((h) => skyPhase(sunAt(madrid, 172, Math.round(h * 60))));
    expect(phases[0]).toBe('night');
    expect(phases[3]).toBe('day');
    expect(new Set(phases).size).toBeGreaterThanOrEqual(4);
  });
  it('dayOfYear cuenta bien', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365);
  });
});

describe('geotags de ui_track.json', () => {
  it('acepta decimales, letras y grados-minutos-segundos', () => {
    expect(parseGeotags(['41.57', '2.26'])).toEqual({ lat: 41.57, lon: 2.26 });
    expect(parseGeotags(['41.57 N', '2.26 E'])).toEqual({ lat: 41.57, lon: 2.26 });
    expect(parseGeotags(['3.5° W', '40.2° N'])).toEqual({ lat: 40.2, lon: -3.5 });
    const g = parseGeotags(['46° 30\' 0" S', '170° 0\' 0" E'])!;
    expect(g.lat).toBeCloseTo(-46.5, 5);
    expect(g.lon).toBeCloseTo(170, 5);
    expect(parseGeotags(['-33.9', '151.2'])).toEqual({ lat: -33.9, lon: 151.2 });
  });
  it('rechaza lo que no es una coordenada', () => {
    expect(parseGeotags(undefined)).toBeNull();
    expect(parseGeotags(['abc', 'def'])).toBeNull();
    expect(parseGeotags(['95', '10'])).toBeNull();
    expect(parseGeotags(['10'])).toBeNull();
  });
});
