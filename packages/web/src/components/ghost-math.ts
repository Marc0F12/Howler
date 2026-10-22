import type { TraceDto } from '@howler/shared';

export interface GhostState {
  x: number;
  z: number;
  /** Rumbo en radianes (atan2(vz, vx) en el plano del mapa). */
  h: number;
  /** km/h */
  v: number;
  gear: number;
  rpm: number;
  /** La traza ya terminó: el coche se queda parado en la meta. */
  finished: boolean;
}

/** Interpola entre dos ángulos por el camino corto (pasar de 3.1 a -3.1 rad no da la vuelta entera). */
export function lerpAngle(a: number, b: number, p: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * p;
}

/** Índice de la última muestra con t ≤ `t` (búsqueda binaria); -1 si `t` es anterior a la primera. */
export function indexAt(ts: number[], t: number): number {
  let lo = 0, hi = ts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Estado del coche en el instante `t` (ms desde el inicio de la vuelta), interpolando entre muestras. */
export function sampleAt(trace: TraceDto, t: number, lapMs: number): GhostState {
  const n = trace.t.length;
  const last = n - 1;
  const finished = t >= lapMs;
  const i = indexAt(trace.t, Math.min(t, lapMs));
  if (i < 0) return { x: trace.x[0]!, z: trace.z[0]!, h: trace.h[0]!, v: trace.v[0]!, gear: trace.gear[0]!, rpm: trace.rpm[0]!, finished: false };
  if (i >= last) return { x: trace.x[last]!, z: trace.z[last]!, h: trace.h[last]!, v: trace.v[last]!, gear: trace.gear[last]!, rpm: trace.rpm[last]!, finished };
  const span = trace.t[i + 1]! - trace.t[i]!;
  const p = span > 0 ? Math.min(1, Math.max(0, (Math.min(t, lapMs) - trace.t[i]!) / span)) : 0;
  const mix = (a: number[]) => a[i]! + (a[i + 1]! - a[i]!) * p;
  return {
    x: mix(trace.x), z: mix(trace.z), h: lerpAngle(trace.h[i]!, trace.h[i + 1]!, p), v: mix(trace.v),
    gear: p < 0.5 ? trace.gear[i]! : trace.gear[i + 1]!, rpm: mix(trace.rpm), finished,
  };
}

/** Marcha tal como se enseña: R, N, 1... (AC manda 0 = marcha atrás, 1 = punto muerto, 2 = primera...). */
export function gearLabel(g: number): string {
  return g === 0 ? 'R' : g === 1 ? 'N' : String(g - 1);
}

export interface SectorSummary {
  count: number;
  /** Mejor tiempo de cada sector (ms) entre las vueltas que lo tienen; null si nadie. */
  best: (number | null)[];
  /** Índice (en `laps`) de quien gana cada sector; null si nadie lo tiene o hay empate exacto entre varios. */
  winner: (number | null)[];
  /** Suma de los mejores sectores; null si falta alguno. Es la vuelta que saldría juntando lo mejor de cada uno. */
  optimalMs: number | null;
}

/** Quién gana cada sector entre las vueltas dadas y cuánto sería la vuelta óptima. */
export function summarizeSectors(laps: { sectorsMs: (number | null)[] }[]): SectorSummary {
  const count = Math.max(0, ...laps.map((l) => l.sectorsMs.length));
  const best: (number | null)[] = [];
  const winner: (number | null)[] = [];
  for (let s = 0; s < count; s++) {
    let b = Infinity;
    let w: number | null = null;
    let tie = false;
    laps.forEach((l, i) => {
      const v = l.sectorsMs[s];
      if (v == null || !(v > 0)) return;
      if (v < b) { b = v; w = i; tie = false; } else if (v === b) tie = true;
    });
    best.push(Number.isFinite(b) ? b : null);
    winner.push(tie ? null : w);
  }
  return { count, best, winner, optimalMs: count > 0 && best.every((b) => b != null) ? (best as number[]).reduce((a, b) => a + b, 0) : null };
}

/**
 * Rangos de muestras [desde, hasta] de cada sector en una traza, según los tiempos acumulados de sus sectores.
 * El último sector llega hasta el final; los rangos se tocan en el punto de corte para que las líneas no dejen huecos.
 */
export function sectorRanges(traceT: number[], sectorsMs: (number | null)[]): [number, number][] {
  if (traceT.length < 2 || sectorsMs.length === 0 || sectorsMs.some((v) => v == null)) return [];
  const out: [number, number][] = [];
  let start = 0;
  let acc = 0;
  for (let s = 0; s < sectorsMs.length; s++) {
    acc += sectorsMs[s] as number;
    const end = s === sectorsMs.length - 1 ? traceT.length - 1 : Math.max(start, indexAt(traceT, acc));
    out.push([start, end]);
    start = end;
  }
  return out;
}

/** Suaviza un recorrido con una media móvil de ventana (2·win+1) sin mover el primer ni el último punto: quita el ruido de las ~10 muestras/s. */
export function smoothPath(x: number[], z: number[], win = 2): { x: number[]; z: number[] } {
  const n = x.length;
  const avg = (a: number[], i: number) => {
    if (i === 0 || i === n - 1) return a[i]!;
    const w = Math.min(win, i, n - 1 - i);
    let s = 0;
    for (let k = i - w; k <= i + w; k++) s += a[k]!;
    return s / (2 * w + 1);
  };
  return { x: x.map((_, i) => avg(x, i)), z: z.map((_, i) => avg(z, i)) };
}

export interface SectorMark {
  x: number;
  z: number;
  /** Rumbo de la trazada en el punto (radianes, en el plano del mapa) para dibujar la marca perpendicular. */
  h: number;
  /** Sector al que pertenece (0..); en una marca de sector es el sector que EMPIEZA ahí. */
  sector: number;
  /** 0 = límite de sector; 1.. = subdivisión dentro del sector. */
  sub: number;
}

export interface SectorSplits {
  marks: SectorMark[];
  /** Duración (ms) de cada subsector: `subMs[sector][parte]`. Estimado: se reparte por distancia recorrida y se normaliza al tiempo oficial del sector. */
  subMs: number[][];
}

/**
 * Límites de sector y subsectores automáticos de una vuelta. Cada sector se divide en `parts` partes iguales en DISTANCIA recorrida
 * por la traza (el servidor solo da los sectores enteros, así que los subsectores son estimados). `parts` = 1 solo da los límites.
 */
export function sectorSplits(trace: { t: number[]; x: number[]; z: number[] }, sectorsMs: (number | null)[], parts: number): SectorSplits {
  const ranges = sectorRanges(trace.t, sectorsMs);
  const marks: SectorMark[] = [];
  const subMs: number[][] = [];
  const heading = (i: number) => {
    const a = Math.max(0, i - 1), b = Math.min(trace.x.length - 1, i + 1);
    return Math.atan2(trace.z[b]! - trace.z[a]!, trace.x[b]! - trace.x[a]!);
  };
  ranges.forEach(([a, b], s) => {
    marks.push({ x: trace.x[a]!, z: trace.z[a]!, h: heading(a), sector: s, sub: 0 });
    const cum: number[] = [0];
    for (let i = a + 1; i <= b; i++) cum.push(cum[cum.length - 1]! + Math.hypot(trace.x[i]! - trace.x[i - 1]!, trace.z[i]! - trace.z[i - 1]!));
    const total = cum[cum.length - 1]!;
    const cuts: number[] = []; // tiempos de los cortes dentro del sector (ms de traza)
    for (let j = 1; j < parts && total > 0; j++) {
      const target = (total * j) / parts;
      let k = 1;
      while (k < cum.length - 1 && cum[k]! < target) k++;
      const span = cum[k]! - cum[k - 1]!;
      const p = span > 0 ? (target - cum[k - 1]!) / span : 0;
      const at = (arr: number[]) => arr[a + k - 1]! + (arr[a + k]! - arr[a + k - 1]!) * p;
      marks.push({ x: at(trace.x), z: at(trace.z), h: heading(a + k), sector: s, sub: j });
      cuts.push(at(trace.t));
    }
    const edges = [trace.t[a]!, ...cuts, trace.t[b]!];
    const raw = edges.slice(1).map((e, i) => e - edges[i]!);
    const sum = raw.reduce((u, v) => u + v, 0);
    const official = sectorsMs[s] as number;
    subMs.push(sum > 0 ? raw.map((v) => (v * official) / sum) : raw.map(() => official / Math.max(1, raw.length)));
  });
  return { marks, subMs };
}

/** Valor de un canal de la traza (`values`, uno por muestra de `t`) en el instante `ms`, interpolado entre las dos muestras vecinas. */
export function sampleChannel(t: number[], values: number[], ms: number): number {
  const last = t.length - 1;
  if (last < 0) return 0;
  const i = indexAt(t, ms);
  if (i < 0) return values[0]!;
  if (i >= last) return values[last]!;
  const span = t[i + 1]! - t[i]!;
  const p = span > 0 ? Math.min(1, Math.max(0, (ms - t[i]!) / span)) : 0;
  return values[i]! + (values[i + 1]! - values[i]!) * p;
}
