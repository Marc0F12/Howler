import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';

/**
 * tar (formato ustar) + gzip mínimos y sin dependencias, para las copias de seguridad. Solo archivos normales con nombre
 * de hasta 100 caracteres: es lo único que necesita Howler. Al leer, cada nombre pasa por `accept` antes de escribir nada
 * en disco (nada de «..», rutas absolutas ni carpetas inesperadas).
 */

export interface TarEntry {
  /** Nombre dentro del archivo (con «/»). */
  name: string;
  /** Archivo del disco que se copia dentro… */
  file?: string;
  /** …o contenido en memoria. */
  data?: Buffer;
}

const BLOCK = 512;

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  if (Buffer.byteLength(name) > 100) throw new Error(`Nombre demasiado largo para la copia: ${name}`);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100, 'ascii');
  h.write('0000000\0', 108, 'ascii');
  h.write('0000000\0', 116, 'ascii');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  h.write(`${Math.floor(mtime / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii');
  h.write('        ', 148, 'ascii'); // la suma de control se calcula con este campo en blanco
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}

async function* tarChunks(entries: TarEntry[]): AsyncGenerator<Buffer> {
  const now = Date.now();
  for (const e of entries) {
    if (e.file) {
      const size = statSync(e.file).size;
      yield header(e.name, size, now);
      let written = 0;
      for await (const chunk of createReadStream(e.file)) { written += (chunk as Buffer).length; yield chunk as Buffer; }
      if (written !== size) throw new Error(`El archivo cambió mientras se copiaba: ${e.name}`);
      if (size % BLOCK) yield Buffer.alloc(BLOCK - (size % BLOCK));
    } else {
      const data = e.data ?? Buffer.alloc(0);
      yield header(e.name, data.length, now);
      yield data;
      if (data.length % BLOCK) yield Buffer.alloc(BLOCK - (data.length % BLOCK));
    }
  }
  yield Buffer.alloc(BLOCK * 2);
}

/** Escribe un `.tar.gz` con las entradas dadas. */
export async function writeTarGz(out: string, entries: TarEntry[]): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  await pipeline(Readable.from(tarChunks(entries)), createGzip({ level: 6 }), createWriteStream(out));
}

export interface ExtractResult { files: { name: string; size: number }[]; skipped: string[] }

/**
 * Extrae un `.tar.gz` a `dest`. `accept(name)` decide qué entradas se escriben (las demás se saltan y se cuentan en `skipped`).
 * Lanza si el archivo no es un tar válido o si una entrada aceptada se saldría de `dest`.
 */
export async function extractTarGz(file: string, dest: string, accept: (name: string) => boolean): Promise<ExtractResult> {
  const root = resolve(dest);
  mkdirSync(root, { recursive: true });
  const files: ExtractResult['files'] = [];
  const skipped: string[] = [];
  let buf: Buffer = Buffer.alloc(0);
  let cur: { name: string; remaining: number; pad: number; out: ReturnType<typeof createWriteStream> | null; size: number } | null = null;
  let ended = false;
  const closeOut = (o: ReturnType<typeof createWriteStream> | null) => new Promise<void>((ok, bad) => { if (!o) return ok(); o.end(() => ok()); o.on('error', bad); });

  for await (const chunk of createReadStream(file).pipe(createGunzip())) {
    buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
    for (;;) {
      if (ended) { buf = Buffer.alloc(0); break; }
      if (cur) {
        if (cur.remaining > 0) {
          if (buf.length === 0) break;
          const take = Math.min(cur.remaining, buf.length);
          if (cur.out && !cur.out.write(buf.subarray(0, take))) await new Promise<void>((r) => cur!.out!.once('drain', () => r()));
          buf = buf.subarray(take);
          cur.remaining -= take;
          continue;
        }
        if (buf.length < cur.pad) break;
        buf = buf.subarray(cur.pad);
        await closeOut(cur.out);
        if (cur.out) files.push({ name: cur.name, size: cur.size });
        cur = null;
        continue;
      }
      if (buf.length < BLOCK) break;
      const h = buf.subarray(0, BLOCK);
      buf = buf.subarray(BLOCK);
      if (h.every((b) => b === 0)) { ended = true; continue; }
      if (h.toString('ascii', 257, 262) !== 'ustar') throw new Error('El archivo no es una copia de seguridad de Howler (formato desconocido).');
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
      if (sum !== parseInt(h.toString('ascii', 148, 154), 8)) throw new Error('La copia de seguridad está dañada (suma de control incorrecta).');
      const nul = h.indexOf(0);
      const name = h.toString('utf8', 0, nul < 0 || nul > 100 ? 100 : nul);
      const size = parseInt(h.toString('ascii', 124, 135), 8);
      const type = String.fromCharCode(h[156] === 0 ? 48 : h[156]!);
      if (!Number.isFinite(size) || size < 0) throw new Error('La copia de seguridad está dañada.');
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (type !== '0') { // carpetas, enlaces...: no se extraen
        cur = { name, remaining: size, pad, out: null, size };
        skipped.push(name);
        continue;
      }
      let out: ReturnType<typeof createWriteStream> | null = null;
      if (accept(name)) {
        const target = resolve(join(root, name));
        if (target !== root && !target.startsWith(root + sep)) throw new Error(`Entrada sospechosa en la copia: ${name}`);
        mkdirSync(dirname(target), { recursive: true });
        out = createWriteStream(target);
      } else skipped.push(name);
      cur = { name, remaining: size, pad, out, size };
    }
  }
  if (cur) { await closeOut(cur.out); throw new Error('La copia de seguridad está incompleta (se cortó el archivo).'); }
  if (!ended) throw new Error('La copia de seguridad está incompleta (falta el final del archivo).');
  return { files, skipped };
}
