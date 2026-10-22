import { describe, expect, it } from 'vitest';
import { addPngText, crc32, latin1Safe, readPngText } from './png-text';

/** PNG mínimo con la estructura correcta (IHDR + IDAT + IEND); no hace falta que se pueda decodificar. */
function fakePng(): Uint8Array {
  const ch = (type: string, data: number[]) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), ch('IDAT', [1, 2, 3]), ch('IEND', [])];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('texto dentro de un PNG', () => {
  it('el CRC coincide con el valor conocido de IEND', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
  it('inserta los fragmentos antes de los datos y se pueden leer', () => {
    const png = fakePng();
    const out = addPngText(png, { Comment: 'Emblem: Crown by Lorc', 'howler-badge': '{"a":1}' });
    expect(out.length).toBeGreaterThan(png.length);
    expect(readPngText(out)).toEqual({ Comment: 'Emblem: Crown by Lorc', 'howler-badge': '{"a":1}' });
    // la cola (IDAT + IEND) queda intacta al final
    expect(Array.from(out.subarray(out.length - 12 - 15))).toEqual(Array.from(png.subarray(png.length - 12 - 15)));
  });
  it('los fragmentos nuevos llevan un CRC correcto', () => {
    const out = addPngText(fakePng(), { K: 'v' });
    const dv = new DataView(out.buffer);
    let pos = 8;
    while (pos < out.length) {
      const len = dv.getUint32(pos);
      expect(dv.getUint32(pos + 8 + len)).toBe(crc32(out.subarray(pos + 4, pos + 8 + len)));
      pos += 12 + len;
    }
  });
  it('lo que no es ASCII se escapa; rechaza lo que no es un PNG o una clave rara', () => {
    expect(latin1Safe('Copa ñ')).toBe('Copa \\u00f1');
    expect(() => addPngText(new Uint8Array(40), { K: 'v' })).toThrow();
    expect(() => addPngText(fakePng(), { 'clave\u0000': 'v' })).toThrow();
  });
});
