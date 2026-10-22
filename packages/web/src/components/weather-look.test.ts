import { describe, expect, it } from 'vitest';
import { CSP_WEATHER_TYPES } from '@howler/shared';
import { overcastOf, weatherLook } from './weather-look';

describe('weatherLook', () => {
  it('cada uno de los 26 tipos de CSP se ve distinto de los demás', () => {
    const seen = new Map<string, string>();
    for (const w of CSP_WEATHER_TYPES) {
      const key = JSON.stringify(weatherLook(w.type));
      expect(seen.get(key), `${w.type} se ve igual que ${seen.get(key)}`).toBeUndefined();
      seen.set(key, w.type);
    }
    expect(seen.size).toBe(CSP_WEATHER_TYPES.length);
  });
  it('la intensidad sube de ligero a fuerte', () => {
    expect(weatherLook('LightRain').rain).toBeLessThan(weatherLook('Rain').rain);
    expect(weatherLook('Rain').rain).toBeLessThan(weatherLook('HeavyRain').rain);
    expect(weatherLook('LightThunderstorm').thunder).toBeLessThan(weatherLook('HeavyThunderstorm').thunder);
    expect(weatherLook('Drizzle').drizzle).toBe(true);
    expect(weatherLook('Rain').drizzle).toBe(false);
  });
  it('los climas clásicos y de Sol también se distinguen por sus palabras', () => {
    expect(weatherLook('3_heavy_clouds').cover).toBeGreaterThan(weatherLook('1_light_clouds').cover);
    expect(weatherLook('sol_35_rain').rain).toBeGreaterThan(0);
    expect(weatherLook('7_heavy_fog').fog).toBeGreaterThan(weatherLook('4_light_fog').fog);
    expect(weatherLook('0_clear').cover).toBe(0);
  });
  it('el cielo se tapa más con tormenta fuerte que con nubes sueltas', () => {
    expect(overcastOf(weatherLook('HeavyThunderstorm'))).toBeGreaterThan(overcastOf(weatherLook('FewClouds')));
    expect(overcastOf(weatherLook('Clear'))).toBe(0);
  });
});
