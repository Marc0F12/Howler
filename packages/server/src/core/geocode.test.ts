import { describe, expect, it } from 'vitest';
import { geocode, geocodeQueries } from './geocode';

const reply = (rows: unknown, ok = true, status = 200) => async () => ({ ok, status, json: async () => rows });

describe('geocode', () => {
  it('lee los resultados válidos y descarta los imposibles', async () => {
    const r = await geocode('Monza', 'es', reply([{ lat: '45.62', lon: '9.28', display_name: 'Autodromo di Monza, Italia' }, { lat: '999', lon: '0' }, { lat: 'x', lon: '1' }]));
    expect(r).toEqual([{ label: 'Autodromo di Monza, Italia', lat: 45.62, lon: 9.28 }]);
  });
  it('un texto vacío no consulta nada', async () => {
    let called = false;
    expect(await geocode('  ', 'es', async () => { called = true; return { ok: true, status: 200, json: async () => [] }; })).toEqual([]);
    expect(called).toBe(false);
  });
  it('avisa si el servicio falla', async () => {
    await expect(geocode('Monza', 'es', reply({}, false, 429))).rejects.toThrow('429');
  });
  it('manda un User-Agent propio y no sigue redirecciones', async () => {
    let seen: { url: string; headers: Record<string, string>; redirect: string } | undefined;
    await geocode('Monza', 'en', async (url, init) => { seen = { url, headers: init.headers, redirect: init.redirect }; return { ok: true, status: 200, json: async () => [] }; });
    expect(seen?.headers['User-Agent']).toContain('Howler');
    expect(seen?.redirect).toBe('error');
    expect(seen?.url).toContain('nominatim.openstreetmap.org');
  });
});

describe('geocodeQueries', () => {
  it('prueba lo preciso primero y la ciudad sola al final, marcada como aproximada', () => {
    expect(geocodeQueries('Vallelunga Club', 'Rome, Italy', 'ks_vallelunga')).toEqual([
      { q: 'Vallelunga Club', approx: false }, { q: 'vallelunga circuit, Rome, Italy', approx: false }, { q: 'Vallelunga Club, Rome, Italy', approx: false },
      { q: 'vallelunga', approx: true }, { q: 'Rome, Italy', approx: true },
    ]);
    expect(geocodeQueries('Mod Track', null)).toEqual([{ q: 'Mod Track', approx: false }]);
  });
});
