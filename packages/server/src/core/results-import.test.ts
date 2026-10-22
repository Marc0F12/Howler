import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { parseResults, reconcile } from './results-import';

const lap = (guid: string, name: string, lapTime: number, sectors: number[], cuts = 0) => ({
  DriverName: name, DriverGuid: guid, CarId: 0, CarModel: 'ks_nissan_370z', Timestamp: 1, LapTime: lapTime,
  Sectors: sectors, Cuts: cuts, BallastKG: 0, Tyre: 'SM', Restrictor: 0,
});

function setup() {
  const repo = new Repository(openDatabase(':memory:'));
  const session = repo.createSession({ track: 'leroy_gandia', layout: '', name: 'Practice', type: 1 });
  const driverId = repo.upsertDriver('A', 'LordPatata');
  const live = (lapMs: number, sectors: number[]) =>
    repo.insertLap(
      { sessionId: session.id, driverId, track: 'leroy_gandia', layout: '', car: 'ks_nissan_370z', lapMs, sectorsMs: sectors, cuts: 0, grip: 1, valid: true, invalidReason: null },
      [],
    );
  return { repo, session, driverId, live };
}

describe('resultados del servidor', () => {
  it('parsea el formato de AC y descarta sectores que no suman la vuelta', () => {
    const raw = JSON.stringify({
      Laps: [
        lap('A', 'LordPatata', 123218, [16982, 28828, 26973, 28840, 21595]),
        lap('A', 'LordPatata', 100000, [1, 2, 3]), // no suma
        { DriverGuid: 'B', LapTime: 0 }, // basura
      ],
    });
    const laps = parseResults(raw);
    expect(laps).toHaveLength(2);
    expect(laps[0]!.sectorsMs).toEqual([16982, 28828, 26973, 28840, 21595]);
    expect(laps[1]!.sectorsMs).toEqual([]);
  });

  it('sustituye los sectores estimados por los del juego y marca la vuelta como confirmada', () => {
    const { repo, session, live } = setup();
    live(123218, [16986, 28840, 26983, 28837, 21572]); // estimación en directo
    const r = reconcile(repo, session, parseResults(JSON.stringify({ Laps: [lap('A', 'LordPatata', 123218, [16982, 28828, 26973, 28840, 21595])] })));
    expect(r).toEqual({ fixed: 1, added: 0 });
    const rec = repo.records('leroy_gandia', '', ['ks_nissan_370z']).entries[0]!;
    expect(rec.sectorsMs).toEqual([16982, 28828, 26973, 28840, 21595]);
    expect(rec.sectorsExact).toBe(true);
  });

  it('añade las vueltas que Howler no vio y no duplica si se importa dos veces', () => {
    const { repo, session } = setup();
    const raw = JSON.stringify({ Laps: [lap('A', 'LordPatata', 120000, [20000, 20000, 20000, 20000, 40000]), lap('Z', 'Nuevo', 130000, [], 2)] });
    expect(reconcile(repo, session, parseResults(raw))).toEqual({ fixed: 0, added: 2 });
    expect(reconcile(repo, session, parseResults(raw))).toEqual({ fixed: 0, added: 0 });
    const recent = repo.recentLaps(10);
    expect(recent).toHaveLength(2);
    expect(recent.find((l) => l.driverName === 'Nuevo')).toMatchObject({ valid: false, invalidReason: 'Anulada por corte', sectorsExact: false });
  });

  it('vueltas con el mismo tiempo exacto se casan una a una', () => {
    const { repo, session, live } = setup();
    live(100000, [1, 2]);
    live(100000, [3, 4]);
    const raw = JSON.stringify({ Laps: [lap('A', 'LordPatata', 100000, [50000, 50000]), lap('A', 'LordPatata', 100000, [40000, 60000])] });
    expect(reconcile(repo, session, parseResults(raw))).toEqual({ fixed: 2, added: 0 });
  });
});
