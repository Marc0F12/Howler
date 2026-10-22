import { closeSync, openSync, readSync } from 'node:fs';

/** La línea de referencia de un circuito (ai/fast_lane.ai): puntos x,z y distancia acumulada. */
export interface AiLine {
  x: number[];
  z: number[];
  cum: number[];
  total: number;
}

/** fast_lane.ai: 4 int32 de cabecera (versión, nº de puntos...) y 20 bytes por punto (x, y, z, distancia, id). */
export function loadAiLine(file: string): AiLine {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const n = head.readInt32LE(4);
    const body = Buffer.alloc(n * 20);
    readSync(fd, body, 0, body.length, 16);
    const x: number[] = [], z: number[] = [], cum: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      x.push(body.readFloatLE(i * 20));
      z.push(body.readFloatLE(i * 20 + 8));
      if (i > 0) acc += Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
      cum.push(acc);
    }
    acc += Math.hypot(x[0]! - x[n - 1]!, z[0]! - z[n - 1]!);
    return { x, z, cum, total: acc };
  } finally {
    closeSync(fd);
  }
}

/** Posición y dirección unitaria en la fracción f (0..1) de la vuelta. */
export function pointAt(line: AiLine, f: number) {
  const d = (((f % 1) + 1) % 1) * line.total;
  let lo = 0, hi = line.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.cum[mid]! <= d) lo = mid; else hi = mid - 1;
  }
  const j = (lo + 1) % line.x.length;
  const segLen = lo === line.cum.length - 1 ? line.total - line.cum[lo]! : line.cum[j]! - line.cum[lo]!;
  const t = segLen > 0 ? (d - line.cum[lo]!) / segLen : 0;
  const dx = line.x[j]! - line.x[lo]!, dz = line.z[j]! - line.z[lo]!;
  const len = Math.hypot(dx, dz) || 1;
  return { x: line.x[lo]! + dx * t, z: line.z[lo]! + dz * t, dirX: dx / len, dirZ: dz / len };
}
