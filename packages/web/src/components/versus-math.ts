import type { DriverComboStatDto } from '@howler/shared';

export interface VersusRow {
  track: string;
  layout: string;
  car: string;
  a: DriverComboStatDto;
  b: DriverComboStatDto;
  /** Diferencia de mejor vuelta b − a (ms, negativa = gana b); null si alguno no tiene vuelta válida. */
  deltaMs: number | null;
  winner: 'a' | 'b' | 'tie' | null;
}

export interface VersusSummary {
  rows: VersusRow[];
  winsA: number;
  winsB: number;
  ties: number;
}

const key = (c: { track: string; layout: string; car: string }) => `${c.track}|${c.layout}|${c.car}`;

/** Cara a cara: solo las combinaciones circuito+coche que han corrido los dos; gana quien tiene la mejor vuelta válida más rápida. */
export function versus(a: DriverComboStatDto[], b: DriverComboStatDto[]): VersusSummary {
  const mine = new Map(a.map((c) => [key(c), c]));
  const rows: VersusRow[] = [];
  for (const cb of b) {
    const ca = mine.get(key(cb));
    if (!ca) continue;
    const both = ca.bestMs != null && cb.bestMs != null;
    const deltaMs = both ? cb.bestMs! - ca.bestMs! : null;
    rows.push({ track: ca.track, layout: ca.layout, car: ca.car, a: ca, b: cb, deltaMs, winner: deltaMs == null ? null : deltaMs > 0 ? 'a' : deltaMs < 0 ? 'b' : 'tie' });
  }
  rows.sort((x, y) => Math.abs(y.deltaMs ?? 0) - Math.abs(x.deltaMs ?? 0));
  return {
    rows,
    winsA: rows.filter((r) => r.winner === 'a').length,
    winsB: rows.filter((r) => r.winner === 'b').length,
    ties: rows.filter((r) => r.winner === 'tie').length,
  };
}
