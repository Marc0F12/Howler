import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSoundStore, sniffAudio } from './sounds';

const dirs: string[] = [];
const store = () => { const d = mkdtempSync(join(tmpdir(), 'howler-snd-')); dirs.push(d); return createSoundStore(d); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** WAV PCM de 8 kHz, 8 bits, mono, de `secs` segundos. */
function wav(secs: number): Buffer {
  const data = Buffer.alloc(Math.round(8000 * secs), 128);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(8000, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('sonidos personalizados', () => {
  it('reconoce el formato por los bytes y mide un WAV', () => {
    expect(sniffAudio(wav(2))?.ext).toBe('wav');
    expect(sniffAudio(wav(2))?.seconds).toBeCloseTo(2, 2);
    expect(sniffAudio(Buffer.from('OggS....'))?.ext).toBe('ogg');
    expect(sniffAudio(Buffer.from('ID3\u0004....'))?.ext).toBe('mp3');
    expect(sniffAudio(Buffer.from('<svg></svg>'))).toBeNull();
  });
  it('guarda, lista, elige y borra', () => {
    const s = store();
    const id = s.add(wav(1.5), 'Mi sonido', 0);
    const l = s.list();
    expect(l.custom).toHaveLength(1);
    expect(l.custom[0]!.url).toMatch(/^\/api\/sound-files\/[0-9a-f]{32}\.wav$/);
    s.select(id);
    expect(s.list().record).toBe(id);
    expect(s.remove(id)).toBe(true);
    expect(s.list().record).toBe('off');
    expect(s.list().custom).toHaveLength(0);
  });
  it('rechaza lo largo, lo que no es audio y las elecciones inventadas', () => {
    const s = store();
    expect(() => s.add(wav(6), 'largo', 0)).toThrow(/dura demasiado/);
    expect(() => s.add(Buffer.from('hola mundo'), 'x', 1)).toThrow(/WAV, MP3 u OGG/);
    expect(() => s.add(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(100)]), 'x', 0)).toThrow(/cuánto dura/);
    expect(() => s.add(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(100)]), 'x', 30)).toThrow(/dura demasiado/);
    expect(() => s.select('../etc')).toThrow(/no existe/);
    s.select('off');
    expect(s.list().record).toBe('off');
  });
  it('solo sirve archivos con nombre generado por Howler', () => {
    const s = store();
    expect(s.find('../x.wav')).toBeNull();
    expect(s.find('index.json')).toBeNull();
  });
});

describe('control de volumen', () => {
  it('de serie es la banana, se puede cambiar y se rechazan los inventados', () => {
    const s = store();
    expect(s.list().volumeStyle).toBe('banana');
    s.setVolumeStyle('slider');
    expect(s.list().volumeStyle).toBe('slider');
    s.select('off');
    expect(s.list().volumeStyle).toBe('slider');
    expect(() => s.setVolumeStyle('otro')).toThrow(/no existe/);
  });
});
