import { describe, expect, it } from 'vitest';
import { computeStandings, roundScores, SCORING_PRESETS, type RoundResult, type ScoringConfig } from './championship';

const res = (driverId: number, finishPos: number | null, o: Partial<RoundResult> = {}): RoundResult =>
  ({ driverId, finishPos, bestLapMs: 90_000, avgLapMs: 95_000, consistencyMs: 500, laps: 10, topSpeedKmh: 200, ...o });
const cfg = (p: Partial<ScoringConfig> = {}): ScoringConfig => ({ ...SCORING_PRESETS.f1!.config, ...p });
const roster = [{ driverId: 1, teamId: null }, { driverId: 2, teamId: null }, { driverId: 3, teamId: null }];

describe('campeonato por puntos', () => {
  it('reparte puntos por puesto y la vuelta rápida da un extra', () => {
    const r = computeStandings(cfg(), roster, [[res(1, 1), res(2, 2, { bestLapMs: 88_000 }), res(3, 3)]]);
    expect(r.drivers.map((d) => [d.id, d.total])).toEqual([[1, 25], [2, 19], [3, 15]]);
  });

  it('quien no corre suma 0, las carreras sin disputar no cuentan y los descartes quitan la peor', () => {
    const c = cfg({ dropWorst: 1, bonuses: [] });
    const r = computeStandings(c, roster, [[res(1, 1), res(2, 2)], [res(2, 1), res(1, 2)], null]);
    const d1 = r.drivers.find((d) => d.id === 1)!;
    expect(d1.total).toBe(25); // 25 + 18, se descarta la de 18
    expect(d1.rounds.map((x) => x.dropped)).toEqual([false, true, false]);
    expect(r.drivers.find((d) => d.id === 3)!.total).toBe(0);
  });

  it('desempate por victorias y por mejor puesto', () => {
    const c = cfg({ bonuses: [], pointsTable: [10, 9, 8] });
    const r = computeStandings(c, roster.slice(0, 2), [[res(1, 1), res(2, 2)], [res(2, 1), res(1, 2)]]);
    expect(r.drivers.map((d) => d.position)).toEqual([1, 1]); // empate total: 19-19, 1 victoria cada uno
  });

  it('las vueltas mínimas dejan fuera a quien no las alcanza', () => {
    const r = computeStandings(cfg({ minLaps: 5, bonuses: [] }), roster, [[res(1, 1, { laps: 2 }), res(2, 2), res(3, 3)]]);
    expect(r.drivers.find((d) => d.id === 1)!.total).toBe(0);
    expect(r.drivers.find((d) => d.id === 2)!.total).toBe(25);
  });
});

describe('puntos extra', () => {
  it('la pole da un extra al mejor de la clasificación y maxFinish limita a quien acaba arriba', () => {
    const c = cfg({ pointsTable: [10, 8, 6], bonuses: [{ kind: 'pole', points: 2 }, { kind: 'bestLap', points: 1, maxFinish: 2 }] });
    const r = computeStandings(c, roster, [[res(1, 1, { qualiPos: 2 }), res(2, 2, { qualiPos: 1 }), res(3, 3, { qualiPos: 3, bestLapMs: 80_000 })]]);
    // 3 hace la vuelta rápida pero acaba 3.º: no cobra; la siguiente mejor vuelta (empate 90.000 entre 1 y 2) comparte el extra
    expect(r.drivers.map((d) => [d.id, d.total])).toEqual([[1, 11], [2, 11], [3, 6]]);
  });
});

describe('puntos por clasificación', () => {
  it('suma puntos según el puesto en la clasificación, solo a quien puntúa en la carrera', () => {
    const cfg: ScoringConfig = { ...SCORING_PRESETS.f1!.config, bonuses: [], qualiTable: [3, 2, 1] };
    const res = (id: number, pos: number, q: number | null): RoundResult => ({ driverId: id, finishPos: pos, qualiPos: q, bestLapMs: 1, avgLapMs: 1, consistencyMs: 1, laps: 5, topSpeedKmh: 1 });
    const base = roundScores({ ...cfg, qualiTable: undefined }, [res(1, 1, 2), res(2, 2, 1), res(3, 3, null)]);
    const withQ = roundScores(cfg, [res(1, 1, 2), res(2, 2, 1), res(3, 3, null)]);
    expect(withQ.get(1)! - base.get(1)!).toBe(2);
    expect(withQ.get(2)! - base.get(2)!).toBe(3);
    expect(withQ.get(3)).toBe(base.get(3));
  });
});

describe('bonus de pole', () => {
  it('no lo cobra un descalificado', () => {
    const cfg: ScoringConfig = { ...SCORING_PRESETS.f1!.config, bonuses: [{ kind: 'pole', points: 5 }], qualiTable: undefined };
    const r = (id: number, pos: number | null, q: number | null, dsq = false): RoundResult => ({ driverId: id, finishPos: pos, qualiPos: q, bestLapMs: 1, avgLapMs: 1, consistencyMs: 1, laps: 5, topSpeedKmh: 1, dsq });
    const pts = roundScores(cfg, [r(1, null, 1, true), r(2, 1, 2)]);
    expect(pts.get(1)).toBeUndefined();
    expect(pts.get(2)).toBe(25);
    const ok = roundScores(cfg, [r(1, 1, 1), r(2, 2, 2)]);
    expect(ok.get(1)).toBe(30);
  });
});

describe('campeonato sin puntos (agregado)', () => {
  it('por número de vueltas en total', () => {
    const r = computeStandings(SCORING_PRESETS.laps!.config, roster, [[res(1, 1, { laps: 10 }), res(2, 2, { laps: 12 })], [res(1, 1, { laps: 10 }), res(2, 2, { laps: 5 })]]);
    expect(r.drivers.map((d) => [d.id, d.total])).toEqual([[1, 20], [2, 17], [3, 0]]);
  });

  it('por media de vuelta: gana la más baja', () => {
    const r = computeStandings(SCORING_PRESETS.avgLap!.config, roster, [[res(1, 1, { avgLapMs: 96_000 }), res(2, 2, { avgLapMs: 94_000 })]]);
    expect(r.drivers.map((d) => d.id)).toEqual([2, 1, 3]);
  });

  it('por mejor vuelta de todas', () => {
    const r = computeStandings(SCORING_PRESETS.bestLap!.config, roster, [[res(1, 1, { bestLapMs: 91_000 }), res(2, 2, { bestLapMs: 92_000 })], [res(2, 1, { bestLapMs: 89_000 }), res(1, 2)]]);
    expect(r.drivers[0]).toMatchObject({ id: 2, total: 89_000 });
  });
});

describe('equipos y parejas', () => {
  const teamRoster = [{ driverId: 1, teamId: 10 }, { driverId: 2, teamId: 10 }, { driverId: 3, teamId: 20 }, { driverId: 4, teamId: 20 }];
  const round = [res(1, 1), res(3, 2), res(2, 3), res(4, 4)];

  it('sumAll suma todos los miembros', () => {
    const t = computeStandings(cfg({ bonuses: [] }), teamRoster, [round]).teams;
    expect(t.map((x) => [x.id, x.total])).toEqual([[10, 40], [20, 30]]);
  });

  it('bestN solo cuenta los mejores N de cada equipo y se mantiene la clasificación de pilotos', () => {
    const s = computeStandings(cfg({ bonuses: [], team: { rule: 'bestN', n: 1 } }), teamRoster, [round]);
    expect(s.teams.map((x) => [x.id, x.total])).toEqual([[10, 25], [20, 18]]);
    expect(s.drivers).toHaveLength(4);
  });

  it('sin equipos no hay clasificación de equipos', () => {
    expect(computeStandings(cfg(), roster, [[res(1, 1)]]).teams).toEqual([]);
  });
});
