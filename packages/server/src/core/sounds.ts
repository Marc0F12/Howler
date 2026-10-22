import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_SOUND, isBuiltinSound, isVolumeStyle, MAX_CUSTOM_SOUNDS, MAX_SOUND_BYTES, MAX_SOUND_SECONDS, NO_SOUND, type SoundsDto, type VolumeStyle } from '@howler/shared';

/**
 * Sonidos personalizados subidos desde el panel. Se guardan en `<dataDir>/sounds/` con nombre aleatorio; solo se aceptan
 * WAV, MP3 y OGG reconocidos por sus primeros bytes, con tamaño y duración máximos. La web además corta la reproducción
 * a la duración máxima, así que un archivo que mienta sobre su duración no suena más de la cuenta.
 */

const NAME = /^[0-9a-f]{32}\.(wav|mp3|ogg)$/;
const TYPES: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };

interface Entry { id: string; name: string; file: string; seconds: number }
interface Index { record: string; custom: Entry[]; volumeStyle: VolumeStyle }

/** Formato real según los bytes, y duración si el formato la da en la cabecera (WAV PCM). */
export function sniffAudio(b: Buffer): { ext: 'wav' | 'mp3' | 'ogg'; seconds: number | null } | null {
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return { ext: 'wav', seconds: wavSeconds(b) };
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return { ext: 'ogg', seconds: null };
  if (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') return { ext: 'mp3', seconds: null };
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return { ext: 'mp3', seconds: null };
  return null;
}

function wavSeconds(b: Buffer): number | null {
  let byteRate = 0, dataLen = 0;
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ' && p + 20 <= b.length) byteRate = b.readUInt32LE(p + 16);
    if (id === 'data') { dataLen = Math.min(len, b.length - p - 8); break; }
    p += 8 + len + (len % 2);
  }
  return byteRate > 0 && dataLen > 0 ? dataLen / byteRate : null;
}

export interface SoundStore {
  list(): SoundsDto;
  /** Guarda un sonido. `seconds` es la duración que midió el navegador (para MP3/OGG). Lanza si no es válido. */
  add(data: Buffer, name: string, seconds: number): string;
  remove(id: string): boolean;
  select(record: string): void;
  setVolumeStyle(style: string): void;
  find(file: string): { path: string; type: string } | null;
}

export function createSoundStore(dir: string): SoundStore {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, 'index.json');
  const load = (): Index => {
    try {
      const j = JSON.parse(readFileSync(indexPath, 'utf8')) as Partial<Index>;
      const custom = (j.custom ?? []).filter((e) => e && NAME.test(e.file) && typeof e.id === 'string' && typeof e.name === 'string');
      return { record: typeof j.record === 'string' ? j.record : DEFAULT_SOUND, custom, volumeStyle: isVolumeStyle(j.volumeStyle) ? j.volumeStyle : 'banana' };
    } catch { return { record: DEFAULT_SOUND, custom: [], volumeStyle: 'banana' }; }
  };
  const save = (i: Index) => writeFileSync(indexPath, JSON.stringify(i));
  const valid = (i: Index, id: string) => id === NO_SOUND || isBuiltinSound(id) || i.custom.some((e) => e.id === id);
  return {
    list() {
      const i = load();
      return {
        record: valid(i, i.record) ? i.record : DEFAULT_SOUND,
        maxSeconds: MAX_SOUND_SECONDS,
        volumeStyle: i.volumeStyle,
        custom: i.custom.map((e) => ({ id: e.id, name: e.name, url: `/api/sound-files/${e.file}`, seconds: e.seconds })),
      };
    },
    add(data, name, seconds) {
      if (data.length === 0) throw new Error('El archivo está vacío.');
      if (data.length > MAX_SOUND_BYTES) throw new Error(`El sonido pesa demasiado (máximo ${Math.round(MAX_SOUND_BYTES / 1000)} KB).`);
      const kind = sniffAudio(data);
      if (!kind) throw new Error('Solo se admiten sonidos WAV, MP3 u OGG.');
      const secs = kind.seconds ?? seconds;
      if (!Number.isFinite(secs) || secs <= 0) throw new Error('No se pudo saber cuánto dura el sonido.');
      if (secs > MAX_SOUND_SECONDS + 0.05) throw new Error(`El sonido dura demasiado (máximo ${MAX_SOUND_SECONDS} s).`);
      const i = load();
      if (i.custom.length >= MAX_CUSTOM_SOUNDS) throw new Error(`Ya hay ${MAX_CUSTOM_SOUNDS} sonidos propios: borra alguno antes.`);
      const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Sonido';
      const id = randomBytes(6).toString('hex');
      const file = `${randomBytes(16).toString('hex')}.${kind.ext}`;
      writeFileSync(join(dir, file), data);
      save({ ...i, custom: [...i.custom, { id, name: clean, file, seconds: Math.round(secs * 10) / 10 }] });
      return id;
    },
    remove(id) {
      const i = load();
      const e = i.custom.find((x) => x.id === id);
      if (!e) return false;
      try { unlinkSync(join(dir, e.file)); } catch { /* ya no estaba */ }
      save({ ...i, record: i.record === id ? DEFAULT_SOUND : i.record, custom: i.custom.filter((x) => x.id !== id) });
      return true;
    },
    select(record) {
      const i = load();
      if (!valid(i, record)) throw new Error('Ese sonido no existe.');
      save({ ...i, record });
    },
    setVolumeStyle(style) {
      if (!isVolumeStyle(style)) throw new Error('Ese control de volumen no existe.');
      save({ ...load(), volumeStyle: style });
    },
    find(file) {
      if (!NAME.test(file)) return null;
      const path = join(dir, file);
      return existsSync(path) ? { path, type: TYPES[file.split('.')[1]!]! } : null;
    },
  };
}
