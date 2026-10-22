import { mkdtempSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createImageStore, imageFileOf, sniffImage } from './championship-images';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-img-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('imágenes de campeonato', () => {
  it('reconoce el formato por los bytes, no por la extensión', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(JPG)).toBe('jpg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('webp');
    expect(sniffImage(Buffer.from('GIF89a....'))).toBe('gif');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull(); // SVG no se admite: puede llevar scripts
    expect(sniffImage(Buffer.from('<html>'))).toBeNull();
  });

  it('guarda con nombre aleatorio y la encuentra; rechaza lo que no es imagen, lo vacío y lo enorme', () => {
    const store = createImageStore(tmp());
    const ref = store.save(PNG);
    const file = imageFileOf(ref)!;
    expect(file).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(store.find(file)).toMatchObject({ type: 'image/png' });
    expect(() => store.save(Buffer.from('hola'))).toThrow(/PNG, JPG/);
    expect(() => store.save(Buffer.alloc(0))).toThrow(/vacío/);
    expect(() => store.save(Buffer.concat([PNG, Buffer.alloc(3_000_001)]))).toThrow(/pesa demasiado/);
  });

  it('no sirve nombres que se salgan de la carpeta ni inexistentes', () => {
    const store = createImageStore(tmp());
    for (const bad of ['../x.png', '..%2Fx.png', 'abc.png', `${'a'.repeat(32)}.png`, `${'a'.repeat(32)}.svg`, `${'a'.repeat(32)}.png/../../etc`]) expect(store.find(bad)).toBeNull();
    expect(imageFileOf('https://example.com/a.png')).toBeNull();
    expect(imageFileOf('/api/championship-images/../../etc/passwd')).toBeNull();
  });

  it('limpia solo las huérfanas con más de una hora', () => {
    const dir = tmp();
    const store = createImageStore(dir);
    const used = imageFileOf(store.save(PNG))!;
    const old = imageFileOf(store.save(JPG))!;
    const fresh = imageFileOf(store.save(PNG))!;
    const past = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(dir, used), past, past);
    utimesSync(join(dir, old), past, past);
    expect(store.prune(new Set([used]))).toBe(1);
    expect(existsSync(join(dir, used))).toBe(true);
    expect(existsSync(join(dir, old))).toBe(false);
    expect(existsSync(join(dir, fresh))).toBe(true);
  });
});

import { hasAlpha } from './championship-images';
describe('transparencia de las imágenes', () => {
  const png = (colorType: number, extra: Buffer = Buffer.alloc(0)) => {
    const ihdr = Buffer.alloc(13); ihdr[8] = 8; ihdr[9] = colorType;
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), extra, chunk('IDAT', Buffer.alloc(2)), chunk('IEND', Buffer.alloc(0))]);
  };
  it('un PNG con canal alfa o con tRNS tiene transparencia; uno sin ella, no', () => {
    expect(hasAlpha(png(6))).toBe(true);
    expect(hasAlpha(png(4))).toBe(true);
    expect(hasAlpha(png(2))).toBe(false);
    const trns = (() => { const len = Buffer.alloc(4); len.writeUInt32BE(1); return Buffer.concat([len, Buffer.from('tRNS'), Buffer.alloc(1), Buffer.alloc(4)]); })();
    expect(hasAlpha(png(3, trns))).toBe(true);
    expect(hasAlpha(png(3))).toBe(false);
  });
  it('un WebP con la marca de alfa tiene transparencia, y un JPG nunca', () => {
    const webp = (flags: number) => { const b = Buffer.alloc(30); b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8X', 12); b[20] = flags; return b; };
    expect(hasAlpha(webp(0x10))).toBe(true);
    expect(hasAlpha(webp(0))).toBe(false);
    expect(hasAlpha(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false);
  });
});
