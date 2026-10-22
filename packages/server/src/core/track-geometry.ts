import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CrossLine } from './sector-timer';

/**
 * Lee del propio circuito dónde están las líneas de cronometraje:
 *  - AC_TIME_n_L / AC_TIME_n_R son objetos "dummy" dentro del modelo .kn5 (n=0 salida/meta, 1..N-1 divisiones).
 *  - ai/fast_lane.ai es la línea de referencia que AC usa para la posición normalizada (spline) de cada coche.
 * Cada línea se proyecta sobre la spline y se obtiene su fracción de vuelta (0..1).
 */

export interface TimingLine {
  index: number;
  left: [number, number];
  right: [number, number];
}

export interface Spline {
  /** x, z de cada punto y distancia acumulada. */
  x: number[];
  z: number[];
  dist: number[];
  total: number;
}

const CHUNK = 32 * 1024 * 1024;
const NEEDLE = 'AC_TIME_';
/** Tolerancia: una línea de tiempos a más de esto de la spline no es de este trazado (o su transformación es rara). */
const MAX_OFFSET_M = 40;

/** Busca los nodos AC_TIME_* de un .kn5 sin cargarlo entero (pueden pesar cientos de MB). */
export function readTimingLinesFromKn5(file: string): TimingLine[] {
  const fd = openSync(file, 'r');
  const size = statSync(file).size;
  const found = new Map<string, [number, number]>();
  try {
    const buf = Buffer.alloc(CHUNK + 64);
    for (let pos = 0; pos < size; pos += CHUNK) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK + 64, size - pos), pos);
      let from = 0;
      for (;;) {
        const i = buf.indexOf(NEEDLE, from);
        if (i < 0 || i >= CHUNK) break; // lo que cae en el solapamiento se ve en el chunk siguiente
        from = i + 1;
        const m = /^AC_TIME_(\d+)_([LR])/.exec(buf.toString('latin1', i, Math.min(i + 16, n)));
        if (!m) continue;
        const name = m[0];
        // Registro del nodo: int32 tipo, int32 longitud del nombre, nombre, int32 hijos, byte activo, matriz 4x4.
        const rec = Buffer.alloc(8 + name.length + 5 + 64);
        if (readSync(fd, rec, 0, rec.length, pos + i - 8) < rec.length) continue;
        if (rec.readInt32LE(0) !== 1 || rec.readInt32LE(4) !== name.length) continue; // 1 = dummy
        const m0 = 8 + name.length + 5;
        found.set(name, [rec.readFloatLE(m0 + 48), rec.readFloatLE(m0 + 56)]); // traslación x, z
      }
    }
  } finally {
    closeSync(fd);
  }
  const lines: TimingLine[] = [];
  for (let i = 0; ; i++) {
    const l = found.get(`AC_TIME_${i}_L`);
    const r = found.get(`AC_TIME_${i}_R`);
    if (!l || !r) break;
    lines.push({ index: i, left: l, right: r });
  }
  return lines;
}

/** fast_lane.ai: cabecera de 4 int32 (versión, nº de puntos, ...) y luego 20 bytes por punto (x, y, z, distancia, id). */
export function readSpline(file: string): Spline | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const n = head.readInt32LE(4);
    if (n < 10 || n > 200_000) return null;
    const body = Buffer.alloc(n * 20);
    readSync(fd, body, 0, body.length, 16);
    const x: number[] = [], z: number[] = [], dist: number[] = [];
    for (let i = 0; i < n; i++) {
      x.push(body.readFloatLE(i * 20));
      z.push(body.readFloatLE(i * 20 + 8));
      dist.push(body.readFloatLE(i * 20 + 12));
    }
    const closing = Math.hypot(x[0]! - x[n - 1]!, z[0]! - z[n - 1]!);
    return { x, z, dist, total: dist[n - 1]! + closing };
  } finally {
    closeSync(fd);
  }
}

/** Fracción de vuelta (0..1) del punto de la spline más cercano a (px, pz), y a qué distancia está. */
export function projectOnSpline(s: Spline, px: number, pz: number): { fraction: number; offset: number } {
  const n = s.x.length;
  let best = { fraction: 0, offset: Infinity };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = s.x[i]!, az = s.z[i]!;
    const dx = s.x[j]! - ax, dz = s.z[j]! - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    const off = Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    if (off < best.offset) {
      const segLen = j === 0 ? s.total - s.dist[i]! : s.dist[j]! - s.dist[i]!;
      best = { fraction: (s.dist[i]! + t * segLen) / s.total, offset: off };
    }
  }
  return best;
}

export interface TimingLayout {
  /** Líneas de cronometraje en orden: [0] = meta, [1..] = divisiones. */
  lines: CrossLine[];
  /** Fracción de vuelta donde está la línea de salida/meta (AC_TIME_0). */
  origin: number;
  /** Fronteras entre sectores, medidas desde `origin` (0..1, ordenadas). */
  bounds: number[];
}

/** Calcula los sectores de un circuito a partir de su carpeta (trackDir = .../content/tracks/<id>). */
export function timingLayout(trackDir: string, layout: string): TimingLayout | null {
  const base = layout ? join(trackDir, layout) : trackDir;
  const aiFile = join(base, 'ai', 'fast_lane.ai');
  if (!existsSync(aiFile)) return null;
  const spline = readSpline(aiFile);
  if (!spline) return null;

  const kn5s = [base, trackDir]
    .filter((d, i, a) => existsSync(d) && a.indexOf(d) === i)
    .flatMap((d) => readdirSync(d).filter((f) => f.toLowerCase().endsWith('.kn5')).map((f) => join(d, f)));
  // Los modelos de decoración (models*.kn5, trees, walls...) nunca llevan líneas de tiempos: se miran los demás primero.
  kn5s.sort((a, b) => Number(/models\d*\.kn5$|trees|walls|objects/i.test(a)) - Number(/models\d*\.kn5$|trees|walls|objects/i.test(b)));

  for (const f of kn5s) {
    const lines = readTimingLinesFromKn5(f);
    if (lines.length < 2) continue;
    const at = lines.map((l) => projectOnSpline(spline, (l.left[0] + l.right[0]) / 2, (l.left[1] + l.right[1]) / 2));
    if (at.some((p) => p.offset > MAX_OFFSET_M)) continue;
    const origin = at[0]!.fraction;
    const bounds = at.slice(1).map((p) => (p.fraction - origin + 1) % 1).sort((a, b) => a - b);
    const cross = lines.map((l, i) => ({
      ax: l.left[0], az: l.left[1], bx: l.right[0], bz: l.right[1], fraction: at[i]!.fraction,
    }));
    return { origin, bounds, lines: cross };
  }
  return null;
}
