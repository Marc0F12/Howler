import type { TraceDto } from '@howler/shared';
import { cumulativeDistance } from './compare-math';
import { indexAt } from './ghost-math';

/** Una vuelta preparada para medir huecos: metros recorridos en cada muestra y el instante de cada una. */
export interface GapLap { cum: number[]; t: number[]; lapMs: number }

export const prepareGap = (trace: TraceDto, lapMs: number): GapLap => ({ cum: cumulativeDistance(trace), t: trace.t, lapMs });

/** Metros recorridos en el instante `t` (interpolando entre muestras; parado en meta después de `lapMs`). */
export function distanceAt(l: GapLap, t: number): number {
  const tt = Math.min(t, l.lapMs);
  const i = indexAt(l.t, tt);
  if (i < 0) return 0;
  if (i >= l.t.length - 1) return l.cum[l.cum.length - 1]!;
  const span = l.t[i + 1]! - l.t[i]!;
  const p = span > 0 ? (tt - l.t[i]!) / span : 0;
  return l.cum[i]! + (l.cum[i + 1]! - l.cum[i]!) * p;
}

/** Instante en el que la vuelta llegó a `d` metros (null si nunca llega). */
export function timeAtDistance(l: GapLap, d: number): number | null {
  const last = l.cum.length - 1;
  if (d > l.cum[last]!) return null;
  const i = Math.min(indexAt(l.cum, d), last - 1);
  if (i < 0) return l.t[0]!;
  const span = l.cum[i + 1]! - l.cum[i]!;
  const p = span > 0 ? (d - l.cum[i]!) / span : 0;
  return l.t[i]! + (l.t[i + 1]! - l.t[i]!) * p;
}

export interface GapState {
  /** Índice de quien va primero (más metros recorridos). */
  leader: number;
  /** Metros que lleva de menos respecto al líder. */
  distM: number[];
  /** Tiempo que tardará en llegar adonde está el líder ahora (ms); 0 para el líder; null si ya no se puede medir. */
  gapMs: (number | null)[];
}

/** Hueco entre las vueltas en el instante `t`: «a cuántos metros y cuántos segundos está cada una del líder». */
export function gapsAt(laps: GapLap[], t: number): GapState {
  const dist = laps.map((l) => distanceAt(l, t));
  const leader = dist.reduce((b, d, i) => (d > dist[b]! ? i : b), 0);
  return {
    leader,
    distM: dist.map((d) => dist[leader]! - d),
    gapMs: laps.map((l, i) => {
      if (i === leader) return 0;
      const at = timeAtDistance(l, dist[leader]!);
      return at == null ? null : Math.max(0, at - Math.min(t, l.lapMs));
    }),
  };
}
