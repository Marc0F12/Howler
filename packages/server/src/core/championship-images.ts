import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/**
 * Imágenes de portada de los campeonatos, subidas desde el panel. Se guardan en `<dataDir>/championship-images/` con un
 * nombre aleatorio (nunca el del archivo original) y solo se aceptan PNG, JPEG, WebP y GIF, reconocidos por sus primeros
 * bytes y no por lo que diga el navegador.
 */

export const MAX_IMAGE_BYTES = 3_000_000;
const NAME = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const ORPHAN_MIN_AGE_MS = 3_600_000;

/** Tipo real de la imagen según sus bytes, o null si no es de un formato admitido. */
export function sniffImage(b: Buffer): 'png' | 'jpg' | 'webp' | 'gif' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'gif';
  return null;
}

/** ¿La imagen tiene transparencia (PNG con canal alfa o paleta transparente, WebP con alfa)? Sirve para sugerir que se vea entera (insignia, copa) en vez de recortada. */
export function hasAlpha(b: Buffer): boolean {
  const kind = sniffImage(b);
  if (kind === 'png') {
    if (b.length > 25 && (b[25] === 4 || b[25] === 6)) return true; // gris con alfa o RGBA
    for (let p = 8; p + 8 <= b.length;) { // paleta o color con tRNS
      const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
      if (type === 'tRNS') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      p += 12 + len;
    }
    return false;
  }
  if (kind === 'webp') {
    if (b.toString('ascii', 12, 16) === 'VP8X') return ((b[20] ?? 0) & 0x10) !== 0;
    return b.toString('ascii', 12, 16) === 'VP8L' && b.length > 25 && ((b[24] ?? 0) & 0x10) !== 0;
  }
  return false;
}

export interface ImageStore {
  /** Guarda la imagen y devuelve la ruta pública (`/api/championship-images/<archivo>`). Lanza si no es válida. */
  save(data: Buffer): string;
  /** Ruta en disco y tipo de una imagen guardada; null si el nombre no es válido o no existe. */
  find(file: string): { path: string; type: string } | null;
  /** Borra las imágenes que ningún campeonato usa (y que llevan más de una hora, por si hay una subida sin guardar aún). */
  prune(referenced: Set<string>): number;
}

export function createImageStore(dir: string, now: () => number = Date.now): ImageStore {
  mkdirSync(dir, { recursive: true });
  return {
    save(data) {
      if (data.length === 0) throw new Error('El archivo está vacío.');
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`La imagen pesa demasiado (máximo ${MAX_IMAGE_BYTES / 1_000_000} MB).`);
      const ext = sniffImage(data);
      if (!ext) throw new Error('Solo se admiten imágenes PNG, JPG, WebP o GIF.');
      const file = `${randomBytes(16).toString('hex')}.${ext}`;
      writeFileSync(join(dir, file), data);
      return `/api/championship-images/${file}`;
    },
    find(file) {
      if (!NAME.test(file)) return null;
      const path = join(dir, file);
      return existsSync(path) ? { path, type: TYPES[file.split('.')[1]!]! } : null;
    },
    prune(referenced) {
      let n = 0;
      for (const f of readdirSync(dir)) {
        if (!NAME.test(f) || referenced.has(f)) continue;
        const p = join(dir, f);
        if (now() - statSync(p).mtimeMs < ORPHAN_MIN_AGE_MS) continue;
        unlinkSync(p);
        n++;
      }
      return n;
    },
  };
}

/** Nombre de archivo de una ruta `/api/championship-images/<archivo>`, o null si es otra cosa (p. ej. un enlace externo). */
export function imageFileOf(ref: string | null | undefined): string | null {
  const m = /^\/api\/championship-images\/([0-9a-f]{32}\.(?:png|jpg|webp|gif))$/.exec(ref ?? '');
  return m ? m[1]! : null;
}
