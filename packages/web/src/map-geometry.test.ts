import { describe, expect, it } from 'vitest';
import type { MapInfoDto } from '@howler/shared';
import { headingOnMap } from './map-geometry';

const base = { track: 't', layout: '', width: 100, height: 100, xOffset: 0, zOffset: 0, scale: 1, margin: 0 } as MapInfoDto;
const norm = (d: number) => ((d % 360) + 540) % 360 - 180;

describe('headingOnMap: la flecha sigue la orientación del mapa', () => {
  it('con el map.ini normal el rumbo del mundo es el de la imagen', () => {
    expect(headingOnMap(base, 10, 10, 0)).toBeCloseTo(0, 6);            // +x: hacia la derecha
    expect(headingOnMap(base, 10, 10, Math.PI / 2)).toBeCloseTo(90, 6); // +z: hacia abajo
  });
  it('si el mapa está girado 180° la flecha también (antes salía al revés)', () => {
    const rot180 = { ...base, affine: [-1, 0, 100, 0, -1, 100] } as MapInfoDto;
    expect(Math.abs(norm(headingOnMap(rot180, 10, 10, 0) - 180))).toBeLessThan(1e-6);
    expect(Math.abs(norm(headingOnMap(rot180, 10, 10, Math.PI / 2) - -90))).toBeLessThan(1e-6);
  });
  it('si el mapa está espejado, el giro se invierte; si está girado 90°, el rumbo se desplaza 90°', () => {
    const mirror = { ...base, affine: [-1, 0, 100, 0, 1, 0] } as MapInfoDto;
    expect(Math.abs(norm(headingOnMap(mirror, 0, 0, Math.PI / 4) - 135))).toBeLessThan(1e-6);
    const rot90 = { ...base, affine: [0, -1, 100, 1, 0, 0] } as MapInfoDto;
    expect(Math.abs(norm(headingOnMap(rot90, 0, 0, 0) - 90))).toBeLessThan(1e-6);
  });
});
