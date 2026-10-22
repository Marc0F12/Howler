import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MapAffine } from '@howler/shared';
import { fitMap, pngMask } from './map-fit';

/** PNG RGBA de 8 bits sin filtro: carretera blanca opaca sobre fondo transparente. */
function png(w: number, h: number, road: (x: number, y: number) => boolean): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    if (road(x, y)) raw.fill(255, o, o + 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    return b; // el CRC no se comprueba
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Circuito de prueba: un anillo rectangular de 12 px de ancho, y su línea central en metros del mundo (escala 2 m/px).
const W = 400, H = 300, RX0 = 80, RX1 = 320, RY0 = 60, RY1 = 240, HALF = 6;
const onRing = (x: number, y: number) => {
  const inOuter = x >= RX0 - HALF && x <= RX1 + HALF && y >= RY0 - HALF && y <= RY1 + HALF;
  const inInner = x > RX0 + HALF && x < RX1 - HALF && y > RY0 + HALF && y < RY1 - HALF;
  return inOuter && !inInner;
};
const ring: [number, number][] = [];
for (let x = RX0; x <= RX1; x += 2) ring.push([x, RY0]);
for (let y = RY0; y <= RY1; y += 2) ring.push([RX1, y]);
for (let x = RX1; x >= RX0; x -= 2) ring.push([x, RY1]);
for (let y = RY1; y >= RY0; y -= 2) ring.push([RX0, y]);
const SCALE = 2; // m/px
// El mundo es el píxel girado/espejado: (x, z) = M · (px, py) · SCALE + t
const world = (m: [number, number, number, number], tx: number, tz: number) => ({
  x: ring.map(([px, py]) => (m[0] * px + m[1] * py) * SCALE + tx),
  z: ring.map(([px, py]) => (m[2] * px + m[3] * py) * SCALE + tz),
});

describe('decodificación del mapa', () => {
  it('saca la carretera de un PNG con alfa', () => {
    const m = pngMask(png(W, H, onRing))!;
    expect(m).toMatchObject({ w: W, h: H, f: 1 });
    expect(m.inside[150 * W + 80]).toBe(1);
    expect(m.inside[150 * W + 200]).toBe(0);
  });
  it('rechaza lo que no es un PNG', () => {
    expect(pngMask(Buffer.from('no soy un png de verdad, pero largo'.repeat(3)))).toBeNull();
  });
});

describe('autocalibrado del mapa', () => {
  const mask = pngMask(png(W, H, onRing))!;
  const nearRing = (af: MapAffine, x: number, z: number) => {
    const px = af[0] * x + af[1] * z + af[2], py = af[3] * x + af[4] * z + af[5];
    return onRing(Math.round(px), Math.round(py));
  };

  it('deja el map.ini si ya encaja', () => {
    const w = world([1, 0, 0, 1], -100, -50);
    const ini: MapAffine = [1 / SCALE, 0, 50, 0, 1 / SCALE, 25];
    const r = fitMap(mask, w, ini)!;
    expect(r.source).toBe('ini');
    expect(r.affine).toEqual(ini);
  });

  it('corrige un map.ini desplazado y con otra escala', () => {
    const w = world([1, 0, 0, 1], -100, -50);
    const r = fitMap(mask, w, [1 / 3, 0, 20, 0, 1 / 3, 200])!;
    expect(r.source).toBe('fitted');
    expect(w.x.every((x, i) => nearRing(r.affine, x, w.z[i]!))).toBe(true);
  });

  it.each([
    ['girado 90°', [0, 1, -1, 0]],
    ['espejo horizontal', [-1, 0, 0, 1]],
    ['espejo vertical', [1, 0, 0, -1]],
    ['traspuesto', [0, 1, 1, 0]],
  ] as [string, [number, number, number, number]][])('encuentra la orientación (%s) sin map.ini', (_n, m) => {
    const w = world(m, 300, -200);
    const r = fitMap(mask, w, null)!;
    expect(r.source).toBe('fitted');
    const inside = w.x.filter((x, i) => nearRing(r.affine, x, w.z[i]!)).length;
    expect(inside / w.x.length).toBeGreaterThan(0.97);
  });
});
