import { describe, expect, it } from 'vitest';
import { parseRoute } from './App';
import { compareHref, pickKey } from './components/links';

describe('parseRoute', () => {
  it('rutas simples y fichas', () => {
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/records')).toEqual({ name: 'records' });
    expect(parseRoute('#/rankings')).toEqual({ name: 'rankings' });
    expect(parseRoute('#/sessions')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/session/42')).toEqual({ name: 'session', id: 42 });
    expect(parseRoute('#/session/x')).toEqual({ name: 'sessions' });
    expect(parseRoute('#/driver/12')).toEqual({ name: 'driver', id: 12 });
    expect(parseRoute('#/driver/abc')).toEqual({ name: 'drivers' });
    expect(parseRoute('#/track/leroy_gandia%7C')).toEqual({ name: 'track', track: 'leroy_gandia', layout: '' });
    expect(parseRoute('#/car/ks_nissan_370z')).toEqual({ name: 'car', car: 'ks_nissan_370z' });
  });

  it('créditos', () => {
  });

  it('cara a cara entre pilotos', () => {
    expect(parseRoute('#/versus/3/7')).toEqual({ name: 'versus', a: 3, b: 7 });
    expect(parseRoute('#/versus/3/3')).toEqual({ name: 'drivers' });
    expect(parseRoute('#/versus/3')).toEqual({ name: 'drivers' });
  });

  it('campeonatos: listado y ficha, con id mal formado de vuelta al listado', () => {
    expect(parseRoute('#/championships')).toEqual({ name: 'championships' });
    expect(parseRoute('#/championship/4')).toEqual({ name: 'championship', id: 4 });
    expect(parseRoute('#/championship/x')).toEqual({ name: 'championships' });
  });

  it('el comparador ida y vuelta: lo que construye compareHref lo entiende parseRoute', () => {
    const picks = [pickKey(3, 'ks_mazda_mx5_nd'), pickKey(7, 'cky_porsche911 gt3')];
    const href = compareHref('imola', 'gp', picks);
    expect(parseRoute(href)).toEqual({ name: 'compare', track: 'imola', layout: 'gp', picks });
  });

  it('un comparador mal formado o con pocas vueltas vuelve a Tiempos en vez de romper', () => {
    expect(parseRoute('#/compare/imola%7Cgp/3~mx5')).toEqual({ name: 'records' }); // solo una
    expect(parseRoute('#/compare/sin-layout/3~a/4~b')).toEqual({ name: 'records' }); // clave sin «|»
    expect(parseRoute('#/compare/imola%7Cgp/x/y')).toEqual({ name: 'records' }); // ids no numéricos
    expect(parseRoute('#/compare/%E0%A4%A')).toEqual({ name: 'records' }); // codificación rota
  });
});
