// Campeonatos: configuración de puntuación y motor de clasificación. Todo es dato (nada fijo en el código) para que cada
// organizador monte el suyo: por puntos según la posición, por media de vuelta, por número de vueltas, por equipos...
// El motor es puro (sin base de datos) para poder usarlo también en la vista previa del asistente de la web.

/** Qué se mide en cada carrera. Los tiempos y la regularidad ganan con el valor MÁS BAJO; vueltas y velocidad, con el más alto. */
export type RoundMetric = 'finish' | 'bestLap' | 'avgLap' | 'consistency' | 'laps' | 'topSpeed';
export const METRIC_LOWER_WINS: Record<RoundMetric, boolean> = { finish: true, bestLap: true, avgLap: true, consistency: true, laps: false, topSpeed: false };

export type TeamRule = 'sumAll' | 'bestN' | 'mean';
export type Tiebreak = 'wins' | 'bestFinish' | 'bestRound';

export interface Bonus {
  /** Quién lo gana: la pole (mejor de la clasificación), la mejor vuelta, la mayor velocidad, el que más vueltas dio, o todos los que corran. */
  kind: 'pole' | 'bestLap' | 'topSpeed' | 'mostLaps' | 'participation';
  points: number;
  /** Opcional: solo se cobra si se acaba la carrera en este puesto o mejor (p. ej. vuelta rápida solo dentro del top 10). */
  maxFinish?: number;
}

export interface ScoringConfig {
  /** `points`: en cada carrera se reparten puntos por puesto. `aggregate`: sin puntos, se acumula una medida entre carreras. */
  mode: 'points' | 'aggregate';
  /** Cómo se ordena a los participantes dentro de cada carrera. */
  metric: RoundMetric;
  /** Modo `points`: puntos por puesto (el primero cobra el índice 0). */
  pointsTable: number[];
  /** Puntos de quien puntúa pero queda fuera de la tabla. */
  defaultPoints: number;
  /** Vueltas mínimas para clasificar en una carrera (0 = cualquiera que haya corrido). */
  minLaps: number;
  bonuses: Bonus[];
  /** Opcional: puntos por puesto en la sesión de clasificación de la prueba (1.º, 2.º...), además de los extras. Vacío o ausente = sin puntos de clasificación. */
  qualiTable?: number[];
  /** Modo `aggregate`: medida que se acumula y cómo (`sum` suma, `best` se queda con la mejor, `mean` hace la media). */
  aggregate: { metric: RoundMetric; how: 'sum' | 'best' | 'mean' };
  /** Se descartan las N peores carreras ya disputadas (las que no se corrieron cuentan 0). */
  dropWorst: number;
  /** Cómo se junta lo de los miembros de un equipo o pareja en cada carrera. */
  team: { rule: TeamRule; n: number };
  tiebreaks: Tiebreak[];
}

/** Lo que una carrera dejó de cada participante inscrito (los no inscritos ni se pasan al motor). */
export interface RoundResult {
  driverId: number;
  finishPos: number | null;
  /** Puesto en la sesión de clasificación de esa prueba, si la hubo. */
  qualiPos?: number | null;
  bestLapMs: number | null;
  avgLapMs: number | null;
  consistencyMs: number | null;
  laps: number;
  topSpeedKmh: number | null;
  /** Tiempo total de carrera (ms) sin penalizaciones, y lo que suman las penalizaciones (manuales + automáticas). */
  totalMs?: number;
  penaltyMs?: number;
  /** Descalificado de esa carrera: no puntúa. */
  dsq?: boolean;
}

/** Puntos extra (positivos) o penalización (negativos) a un piloto en una carrera (índice desde 0). */
export interface Adjustment { driverId: number; round: number; points: number }

export interface RosterEntry { driverId: number; teamId: number | null }

export interface RoundCell { score: number | null; rank: number | null; dropped: boolean }
export interface StandingRow {
  id: number; // driverId o teamId
  position: number;
  total: number;
  rounds: RoundCell[];
  wins: number;
  bestRank: number | null;
}
export interface Standings { drivers: StandingRow[]; teams: StandingRow[] }

const F1_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const base: ScoringConfig = {
  mode: 'points', metric: 'finish', pointsTable: F1_TABLE, defaultPoints: 0, minLaps: 0, bonuses: [],
  aggregate: { metric: 'laps', how: 'sum' }, dropWorst: 0, team: { rule: 'sumAll', n: 2 }, tiebreaks: ['wins', 'bestFinish'],
};
/** Plantillas de un clic del asistente; el organizador puede cambiarlo todo después. */
export const SCORING_PRESETS: Record<string, { label: string; config: ScoringConfig }> = {
  f1: { label: 'Puntos tipo F1 (25-18-15…)', config: { ...base, bonuses: [{ kind: 'bestLap', points: 1 }] } },
  winner: { label: 'Solo cuenta ganar (1 punto por victoria)', config: { ...base, pointsTable: [1] } },
  laps: { label: 'Más vueltas en total', config: { ...base, mode: 'aggregate', metric: 'laps', aggregate: { metric: 'laps', how: 'sum' }, tiebreaks: [] } },
  avgLap: { label: 'Mejor media de vuelta', config: { ...base, mode: 'aggregate', metric: 'avgLap', aggregate: { metric: 'avgLap', how: 'mean' }, tiebreaks: [] } },
  bestLap: { label: 'Mejor vuelta rápida', config: { ...base, mode: 'aggregate', metric: 'bestLap', aggregate: { metric: 'bestLap', how: 'best' }, tiebreaks: [] } },
};

const val = (r: RoundResult, m: RoundMetric): number | null =>
  m === 'finish' ? r.finishPos : m === 'bestLap' ? r.bestLapMs : m === 'avgLap' ? r.avgLapMs : m === 'consistency' ? r.consistencyMs : m === 'laps' ? r.laps : r.topSpeedKmh;

/** Puestos 1.. por la medida; empatar en valor comparte puesto. Quien no la tiene (o no llega a `minLaps`) no puntúa. */
function rankBy(results: RoundResult[], metric: RoundMetric, minLaps: number): Map<number, number> {
  const rows = results.filter((r) => r.laps >= minLaps && val(r, metric) != null).map((r) => ({ id: r.driverId, v: val(r, metric)! }));
  const dir = METRIC_LOWER_WINS[metric] ? 1 : -1;
  rows.sort((a, b) => dir * (a.v - b.v));
  const out = new Map<number, number>();
  rows.forEach((r, i) => out.set(r.id, i > 0 && r.v === rows[i - 1]!.v ? out.get(rows[i - 1]!.id)! : i + 1));
  return out;
}

/** Puntos o valor de cada participante en una carrera ya disputada. */
export function roundScores(cfg: ScoringConfig, results: RoundResult[]): Map<number, number> {
  const out = new Map<number, number>();
  if (cfg.mode === 'aggregate') {
    for (const r of results) { const v = r.laps >= cfg.minLaps ? val(r, cfg.aggregate.metric) : null; if (v != null) out.set(r.driverId, v); }
    return out;
  }
  const ranks = rankBy(results, cfg.metric, cfg.minLaps);
  for (const [id, rank] of ranks) out.set(id, cfg.pointsTable[rank - 1] ?? cfg.defaultPoints);
  const eligible = results.filter((r) => ranks.has(r.driverId));
  const add = (id: number, p: number) => out.set(id, (out.get(id) ?? 0) + p);
  for (const b of cfg.bonuses) {
    const ok = (r: RoundResult) => b.maxFinish == null || (ranks.get(r.driverId) ?? Infinity) <= b.maxFinish;
    if (b.kind === 'participation') { for (const r of eligible) if (ok(r)) add(r.driverId, b.points); continue; }
    if (b.kind === 'pole') { for (const r of eligible) if (r.qualiPos === 1 && ok(r)) add(r.driverId, b.points); continue; } // el de la pole cobra si puntúa en la carrera (no descalificado ni sin vueltas mínimas)
    const metric: RoundMetric = b.kind === 'bestLap' ? 'bestLap' : b.kind === 'topSpeed' ? 'topSpeed' : 'laps';
    const top = rankBy(eligible.filter(ok), metric, 0);
    for (const [id, rank] of top) if (rank === 1) add(id, b.points);
  }
  if (cfg.qualiTable?.length) {
    for (const r of eligible) {
      const q = r.qualiPos ? cfg.qualiTable[r.qualiPos - 1] : undefined;
      if (q) add(r.driverId, q);
    }
  }
  return out;
}

/** Junta los valores de los miembros de un equipo en una carrera. */
function combine(values: number[], rule: TeamRule, n: number, lowerWins: boolean): number | null {
  if (!values.length) return null;
  if (rule === 'mean') return values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => (lowerWins ? a - b : b - a));
  return (rule === 'bestN' ? sorted.slice(0, n) : sorted).reduce((a, b) => a + b, 0);
}

interface Entity { id: number; perRound: (number | null)[] }

function standFor(cfg: ScoringConfig, entities: Entity[], played: boolean[]): StandingRow[] {
  const aggMetric = cfg.mode === 'points' ? null : cfg.aggregate.metric;
  const lowerWins = aggMetric ? METRIC_LOWER_WINS[aggMetric] : false;
  const rankOf = (rIdx: number) => {
    const vals = entities.map((e) => ({ id: e.id, v: e.perRound[rIdx] })).filter((x): x is { id: number; v: number } => x.v != null);
    vals.sort((a, b) => (lowerWins ? a.v - b.v : b.v - a.v));
    const m = new Map<number, number>();
    vals.forEach((x, i) => m.set(x.id, i > 0 && x.v === vals[i - 1]!.v ? m.get(vals[i - 1]!.id)! : i + 1));
    return m;
  };
  const ranks = played.map((p, i) => (p ? rankOf(i) : new Map<number, number>()));
  const rows = entities.map((e) => {
    const cells: RoundCell[] = e.perRound.map((score, i) => ({ score, rank: ranks[i]!.get(e.id) ?? null, dropped: false }));
    // Descartes: solo en modo puntos; las carreras no corridas por el participante cuentan 0.
    if (cfg.mode === 'points' && cfg.dropWorst > 0) {
      const idx = cells.map((_, i) => i).filter((i) => played[i]);
      if (idx.length > cfg.dropWorst) {
        idx.sort((a, b) => (cells[a]!.score ?? 0) - (cells[b]!.score ?? 0));
        for (const i of idx.slice(0, cfg.dropWorst)) cells[i]!.dropped = true;
      }
    }
    const counted = cells.filter((c) => c.score != null && !c.dropped).map((c) => c.score!);
    let total = 0;
    if (cfg.mode === 'points' || cfg.aggregate.how === 'sum') total = counted.reduce((a, b) => a + b, 0);
    else if (cfg.aggregate.how === 'mean') total = counted.length ? counted.reduce((a, b) => a + b, 0) / counted.length : 0;
    else total = counted.length ? (lowerWins ? Math.min(...counted) : Math.max(...counted)) : 0;
    const rs = cells.map((c) => c.rank).filter((r): r is number => r != null);
    return { id: e.id, position: 0, total, rounds: cells, wins: rs.filter((r) => r === 1).length, bestRank: rs.length ? Math.min(...rs) : null, hasData: counted.length > 0 };
  });
  const totalLower = cfg.mode === 'aggregate' && lowerWins;
  // Mejor resultado de una carrera: el más bajo si menos es mejor (tiempos), el más alto si no.
  const bestRound = (r: { rounds: { score: number | null }[] }, lower: boolean) =>
    lower ? Math.min(...r.rounds.map((c) => c.score ?? Infinity)) : Math.max(...r.rounds.map((c) => c.score ?? -Infinity));
  rows.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
    if (a.total !== b.total) return totalLower ? a.total - b.total : b.total - a.total;
    for (const t of cfg.tiebreaks) {
      const d = t === 'wins' ? b.wins - a.wins
        : t === 'bestFinish' ? (a.bestRank ?? 1e9) - (b.bestRank ?? 1e9)
        : totalLower ? bestRound(a, true) - bestRound(b, true) : bestRound(b, false) - bestRound(a, false);
      if (d !== 0 && Number.isFinite(d)) return d;
    }
    return 0;
  });
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const tied = prev && prev.total === r.total && prev.wins === r.wins && prev.bestRank === r.bestRank && prev.hasData === r.hasData;
    r.position = tied ? prev.position : i + 1;
    const { hasData: _h, ...out } = r;
    return out;
  });
}

/**
 * Clasificación de un campeonato. `rounds[i]` son los resultados de la carrera i, o `null` si aún no se ha corrido.
 * Salen siempre la de pilotos y, si hay equipos (`teamId` en el reparto), la de equipos.
 */
export function computeStandings(cfg: ScoringConfig, roster: RosterEntry[], rounds: (RoundResult[] | null)[], adjustments: Adjustment[] = []): Standings {
  const played = rounds.map((r) => r != null);
  const scores = rounds.map((r) => (r ? roundScores(cfg, r) : new Map<number, number>()));
  // Extras y penalizaciones a mano (solo en modo puntos, y solo en carreras ya disputadas).
  if (cfg.mode === 'points') for (const a of adjustments) if (played[a.round]) scores[a.round]!.set(a.driverId, (scores[a.round]!.get(a.driverId) ?? 0) + a.points);
  const drivers = roster.map((p) => ({ id: p.driverId, perRound: scores.map((s, i) => (played[i] ? (s.get(p.driverId) ?? (cfg.mode === 'points' ? 0 : null)) : null)) }));
  // En modo puntos quien está inscrito y no corrió suma 0 en esa carrera; en agregado queda sin dato.
  const teamIds = [...new Set(roster.map((p) => p.teamId).filter((t): t is number => t != null))];
  const lowerWins = cfg.mode === 'aggregate' && METRIC_LOWER_WINS[cfg.aggregate.metric];
  const teams = teamIds.map((id) => {
    const members = roster.filter((p) => p.teamId === id).map((p) => p.driverId);
    return {
      id,
      perRound: rounds.map((_, i) => {
        if (!played[i]) return null;
        const vals = members.map((m) => scores[i]!.get(m)).filter((v): v is number => v != null);
        return combine(vals, cfg.team.rule, cfg.team.n, lowerWins) ?? (cfg.mode === 'points' ? 0 : null);
      }),
    };
  });
  return { drivers: standFor(cfg, drivers, played), teams: teams.length ? standFor(cfg, teams, played) : [] };
}
