import { describe, expect, it } from 'vitest';
import { parseCoordText } from './world-map';

describe('parseCoordText', () => {
  it('entiende lo que se copia de un mapa', () => {
    expect(parseCoordText('41.57, 2.26')).toEqual({ lat: 41.57, lon: 2.26 });
    expect(parseCoordText('41.57 N 2.26 E')).toEqual({ lat: 41.57, lon: 2.26 });
    expect(parseCoordText('-33.9; 151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(parseCoordText('41.57 2.26')).toEqual({ lat: 41.57, lon: 2.26 });
  });
  it('rechaza lo que no cabe en el planeta o no son coordenadas', () => {
    expect(parseCoordText('')).toBeNull();
    expect(parseCoordText('hola')).toBeNull();
    expect(parseCoordText('120, 300')).toBeNull();
  });
});
