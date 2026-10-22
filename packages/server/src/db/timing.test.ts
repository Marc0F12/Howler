import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { Repository } from './repository';

function setup() {
  const repo = new Repository(openDatabase(':memory:'));
  const session = repo.createSession({ track: 't', layout: '', name: 'Practice', type: 1 });
  const ana = repo.upsertDriver('A', 'Ana');
  const beto = repo.upsertDriver('B', 'Beto');
  const cris = repo.upsertDriver('C', 'Cris');
  const lap = (driverId: number, lapMs: number, sectors: number[], valid = true) =>
    repo.insertLap({ sessionId: session.id, driverId, track: 't', layout: '', car: 'mx5', lapMs, sectorsMs: sectors, cuts: valid ? 0 : 1, grip: 1, valid, invalidReason: valid ? null : 'corte', sectorsExact: true }, []);
  return { repo, session, ana, beto, cris, lap };
}

describe('torre de tiempos', () => {
  it('sin sesión devuelve una torre vacía', () => {
    expect(setup().repo.sessionTiming(null, [])).toEqual({ session: null, sectorCount: 0, rows: [] });
  });

  it('ordena por mejor vuelta válida y calcula el hueco con el primero', () => {
    const { repo, session, ana, beto, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    lap(beto, 98_000, [29_000, 40_000, 29_000]);
    lap(ana, 101_000, [31_000, 40_000, 30_000]);
    const t = repo.sessionTiming(session, []);
    expect(t.rows.map((r) => [r.position, r.driverName, r.bestMs, r.gapMs, r.laps])).toEqual([
      [1, 'Beto', 98_000, 0, 1],
      [2, 'Ana', 100_000, 2_000, 2],
    ]);
    expect(t.sectorCount).toBe(3);
  });

  it('colorea los sectores de la última vuelta: morado, verde y amarillo', () => {
    const { repo, session, ana, beto, lap } = setup();
    lap(beto, 98_000, [29_000, 40_000, 29_000]); // marca los mejores de la sesión
    lap(ana, 99_000, [28_000, 41_000, 30_000]); // primera de Ana
    lap(ana, 99_500, [28_000, 42_000, 29_500]); // última: S1 mejor de la sesión (morado), S2 no, S3 mejor personal que 30_000 (verde)
    const ana1 = repo.sessionTiming(session, []).rows.find((r) => r.driverName === 'Ana')!;
    expect(ana1.lastSectors.map((s) => s.kind)).toEqual(['purple', 'yellow', 'green']);
    expect(ana1.lastSectors.map((s) => s.ms)).toEqual([28_000, 42_000, 29_500]);
  });

  it('una vuelta anulada no pinta récords y no cuenta para la mejor vuelta', () => {
    const { repo, session, ana, beto, lap } = setup();
    lap(beto, 98_000, [29_000, 40_000, 29_000]);
    lap(ana, 90_000, [20_000, 35_000, 35_000], false); // más rápida pero anulada
    const t = repo.sessionTiming(session, []);
    const a = t.rows.find((r) => r.driverName === 'Ana')!;
    expect(a.bestMs).toBeNull();
    expect(a.lastMs).toBe(90_000);
    expect(a.lastValid).toBe(false);
    expect(a.lastSectors.every((s) => s.kind === 'yellow')).toBe(true);
    expect(t.rows[0]!.driverName).toBe('Beto'); // Ana queda detrás: sin vuelta válida
  });

  it('enseña a los conectados aunque no tengan vueltas, y marca quién está en pista', () => {
    const { repo, session, ana, cris, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    const t = repo.sessionTiming(session, [
      { carId: 4, driverId: cris, name: 'Cris', car: 'ks_mazda_mx5_nd' },
      { carId: 1, driverId: ana, name: 'Ana', car: 'mx5' },
    ]);
    expect(t.rows.map((r) => [r.driverName, r.online, r.carId, r.bestMs])).toEqual([
      ['Ana', true, 1, 100_000],
      ['Cris', true, 4, null],
    ]);
    expect(t.rows[1]!.gapMs).toBeNull();
    expect(t.rows[1]!.lastSectors).toEqual([
      { ms: null, kind: 'none' }, { ms: null, kind: 'none' }, { ms: null, kind: 'none' },
    ]);
  });

  it('un piloto que se fue sigue en la torre, ya sin conexión', () => {
    const { repo, session, ana, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    const r = repo.sessionTiming(session, []).rows[0]!;
    expect(r).toMatchObject({ online: false, carId: null, driverName: 'Ana' });
  });

  it('solo cuenta las vueltas de la sesión pedida', () => {
    const { repo, session, ana, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    const other = repo.createSession({ track: 't', layout: '', name: 'Race', type: 3 });
    expect(repo.sessionTiming(other, []).rows).toEqual([]);
    expect(repo.sessionTiming(session, []).rows).toHaveLength(1);
  });
});

describe('últimos récords', () => {
  it('solo hay un récord por combinación: la mejor vuelta válida vigente, con el récord al que sustituyó', () => {
    const { repo, ana, beto, lap } = setup();
    lap(ana, 100_000, [1, 2, 3]);
    lap(beto, 99_000, [1, 2, 3]);
    lap(ana, 99_500, [1, 2, 3]); // no bate a Beto
    lap(ana, 98_000, [1, 2, 3], false); // anulada: no cuenta
    lap(ana, 98_500, [1, 2, 3]); // nuevo récord
    const r = repo.recentRecords(10);
    expect(r.map((x) => [x.driverName, x.lapMs, x.previousMs, x.previousDriverName])).toEqual([
      ['Ana', 98_500, 99_000, 'Beto'],
    ]);
  });

  it('la primera vuelta válida de una combinación es su récord, sin récord anterior', () => {
    const { repo, ana, lap } = setup();
    lap(ana, 100_000, []);
    expect(repo.recentRecords(10).map((x) => [x.lapMs, x.previousMs, x.previousDriverName])).toEqual([[100_000, null, null]]);
  });

  it('cada combinación de circuito y coche tiene su propio récord, la más reciente primero', () => {
    const { repo, session, ana, beto } = setup();
    const lapCar = (d: number, ms: number, car: string) =>
      repo.insertLap({ sessionId: session.id, driverId: d, track: 't', layout: '', car, lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    lapCar(ana, 100_000, 'mx5');
    lapCar(beto, 90_000, 'porsche');
    expect(repo.recentRecords(10).map((x) => [x.car, x.lapMs])).toEqual([['porsche', 90_000], ['mx5', 100_000]]);
  });

  it('respeta el límite', () => {
    const { repo, session, ana } = setup();
    for (const car of ['a', 'b', 'c'])
      repo.insertLap({ sessionId: session.id, driverId: ana, track: 't', layout: '', car, lapMs: 100_000, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    expect(repo.recentRecords(2).map((x) => x.car)).toEqual(['c', 'b']);
  });
});

describe('combinaciones', () => {
  it('traen su récord y quién lo tiene; null si todas las vueltas están anuladas', () => {
    const { repo, ana, beto, lap } = setup();
    lap(ana, 100_000, []);
    lap(beto, 99_000, []);
    lap(beto, 90_000, [], false);
    expect(repo.combos().map((c) => [c.car, c.laps, c.bestMs, c.bestDriverName])).toEqual([['mx5', 3, 99_000, 'Beto']]);
  });
});

describe('tabla de tiempos del circuito', () => {
  it('una fila por piloto y coche, con vueltas, válidas y vuelta óptima', () => {
    const { repo, ana, beto, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    lap(ana, 101_000, [29_000, 41_000, 31_000]);
    lap(ana, 90_000, [1, 1, 1], false); // anulada: no cuenta para nada salvo el total de vueltas
    lap(beto, 99_000, [31_000, 40_000, 28_000]);
    const t = repo.records('t', '', ['mx5']);
    expect(t.entries.map((e) => [e.position, e.driverName, e.car, e.lapMs, e.gapMs, e.laps, e.validLaps, e.optimalMs])).toEqual([
      [1, 'Beto', 'mx5', 99_000, 0, 1, 1, 99_000],
      [2, 'Ana', 'mx5', 100_000, 1_000, 3, 2, 99_000], // óptima = 29+40+30
    ]);
    expect(t.sectorBestsMs).toEqual([29_000, 40_000, 28_000]);
  });

  it('con varios coches mezcla las filas; sin coches elegidos incluye todos los del circuito', () => {
    const { repo, session, ana } = setup();
    const lapCar = (car: string, ms: number) =>
      repo.insertLap({ sessionId: session.id, driverId: ana, track: 't', layout: '', car, lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    lapCar('mx5', 100_000);
    lapCar('porsche', 90_000);
    lapCar('bmw', 95_000);
    expect(repo.records('t', '', ['mx5', 'porsche']).entries.map((e) => e.car)).toEqual(['porsche', 'mx5']);
    const all = repo.records('t', '', []);
    expect(all.entries.map((e) => e.car)).toEqual(['porsche', 'bmw', 'mx5']);
    expect(all.cars).toEqual(['bmw', 'mx5', 'porsche']);
  });

  it('no hay óptima si la mejor vuelta no tiene sectores (nunca puede salir peor que el tiempo de vuelta)', () => {
    const { repo, ana, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    lap(ana, 99_000, []); // la mejor, pero sin sectores medidos
    const e = repo.records('t', '', ['mx5']).entries[0]!;
    expect([e.lapMs, e.optimalMs]).toEqual([99_000, null]);
  });

  it('un piloto con solo vueltas anuladas no sale; sin sectores completos no hay óptima', () => {
    const { repo, ana, beto, lap } = setup();
    lap(ana, 100_000, [], false);
    lap(beto, 99_000, []);
    const t = repo.records('t', '', ['mx5']);
    expect(t.entries.map((e) => [e.driverName, e.optimalMs])).toEqual([['Beto', null]]);
  });
});

describe('sesión: historial y progresión', () => {
  it('driverSessionLaps devuelve las vueltas de un piloto en orden, numeradas, con las anuladas', () => {
    const { repo, session, ana, beto, lap } = setup();
    lap(ana, 100_000, [30_000, 40_000, 30_000]);
    lap(beto, 99_000, []);
    lap(ana, 101_000, [], false);
    lap(ana, 98_000, [29_000, 40_000, 29_000]);
    const laps = repo.driverSessionLaps(session.id, ana);
    expect(laps.map((l) => [l.lapNo, l.lapMs, l.valid])).toEqual([[1, 100_000, true], [2, 101_000, false], [3, 98_000, true]]);
    expect(laps[0]!.sectorsMs).toEqual([30_000, 40_000, 30_000]);
    expect(repo.driverSessionLaps(session.id, 9999)).toEqual([]);
  });

  it('sessionProgression: solo las vueltas válidas que bajaron el mejor tiempo, con a quién superaron', () => {
    const { repo, session, ana, beto, cris, lap } = setup();
    lap(ana, 110_000, []);
    lap(beto, 112_000, []); // no mejora
    lap(cris, 100_000, [], false); // anulada: no cuenta
    lap(beto, 107_000, []);
    lap(ana, 107_000, []); // empate: no es mejora
    lap(cris, 106_000, []);
    const p = repo.sessionProgression(session.id);
    expect(p.map((s) => [s.driverName, s.lapMs, s.previousMs, s.previousDriverName])).toEqual([
      ['Ana', 110_000, null, null],
      ['Beto', 107_000, 110_000, 'Ana'],
      ['Cris', 106_000, 107_000, 'Beto'],
    ]);
  });

  it('latestSessionWithLaps ignora las sesiones sin vueltas', () => {
    const { repo, session, ana, lap } = setup();
    expect(repo.latestSessionWithLaps()).toBeNull();
    lap(ana, 100_000, []);
    const empty = repo.createSession({ track: 't', layout: '', name: 'Race', type: 3 });
    expect(empty.id).toBeGreaterThan(session.id);
    expect(repo.latestSessionWithLaps()?.id).toBe(session.id);
    expect(repo.sessionHasLaps(empty.id)).toBe(false);
  });
});

describe('trazas de vuelta (fantasmas)', () => {
  const blob = (n: number) => Buffer.from(`traza-${n}`);

  it('topLapIds da la mejor vuelta de cada piloto, de más rápida a más lenta, y respeta el límite', () => {
    const { repo, ana, beto, cris, lap } = setup();
    lap(ana, 100_000, []);
    lap(ana, 97_000, []); // su mejor
    lap(beto, 98_000, []);
    lap(cris, 99_000, []);
    lap(cris, 90_000, [], false); // anulada: no cuenta
    const ids = repo.topLapIds('t', '', [], 3);
    expect(ids).toHaveLength(3);
    const laps = repo.topLapsWithTraces('t', '', [], 3);
    expect(laps.map((l) => [l.rank, l.driverName, l.lapMs])).toEqual([[1, 'Ana', 97_000], [2, 'Beto', 98_000], [3, 'Cris', 99_000]]);
    expect(repo.topLapIds('t', '', [], 2)).toHaveLength(2);
  });

  it('pruneTraces solo conserva las trazas de las 3 mejores vueltas de la combinación', () => {
    const { repo, ana, beto, cris, lap } = setup();
    const idOf = (ms: number) => repo.topLapsWithTraces('t', '', [], 10).find((l) => l.lapMs === ms)!.lapId;
    const traced = () => (repo as unknown as { db: { prepare: (q: string) => { all: () => { n: number }[] } } }).db
      .prepare('SELECT laps.lap_ms AS n FROM lap_traces JOIN laps ON laps.id = lap_traces.lap_id ORDER BY laps.lap_ms').all().map((r) => r.n);
    lap(ana, 100_000, []);
    lap(beto, 101_000, []);
    lap(cris, 102_000, []);
    for (const ms of [100_000, 101_000, 102_000]) repo.saveTrace(idOf(ms), 1, blob(ms));
    lap(ana, 95_000, []); // nueva mejor de Ana
    lap(beto, 96_000, []); // nueva mejor de Beto
    for (const ms of [95_000, 96_000]) repo.saveTrace(idOf(ms), 1, blob(ms));
    expect(traced()).toEqual([95_000, 96_000, 100_000, 101_000, 102_000]);
    repo.pruneTraces('t', '', 'mx5');
    // Las de 100.000 (Ana) y 101.000 (Beto) ya no son su mejor vuelta: fuera.
    expect(traced()).toEqual([95_000, 96_000, 102_000]);
  });

  it('records trae la velocidad máxima de la mejor vuelta', () => {
    const { repo, session, ana } = setup();
    repo.insertLap({ sessionId: session.id, driverId: ana, track: 't', layout: '', car: 'mx5', lapMs: 99_000, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null, maxSpeedKmh: 212.5 }, []);
    repo.insertLap({ sessionId: session.id, driverId: ana, track: 't', layout: '', car: 'mx5', lapMs: 99_500, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null, maxSpeedKmh: 230 }, []);
    expect(repo.records('t', '', ['mx5']).entries[0]!.maxSpeedKmh).toBe(212.5);
    expect(repo.driverSessionLaps(session.id, ana).map((l) => l.maxSpeedKmh)).toEqual([212.5, 230]);
  });
});

describe('comparador: trazas de la mejor vuelta de cada piloto', () => {
  const blob = (n: number) => Buffer.from(`traza-${n}`);

  it('pruneTraces conserva la mejor vuelta de CADA piloto, no solo las 3 primeras', () => {
    const { repo, session, ana, beto, cris } = setup();
    const dani = repo.upsertDriver('D', 'Dani');
    const lapOf = (driverId: number, ms: number) =>
      repo.insertLap({ sessionId: session.id, driverId, track: 't', layout: '', car: 'mx5', lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    const ids = [lapOf(ana, 100_000), lapOf(beto, 101_000), lapOf(cris, 102_000), lapOf(dani, 103_000)]; // el 4.º piloto queda fuera del top 3
    const slower = lapOf(ana, 105_000); // otra vuelta de Ana, no es su mejor
    for (const id of [...ids, slower]) repo.saveTrace(id, 1, blob(id));
    repo.pruneTraces('t', '', 'mx5');
    const withData = repo.bestLapsWithTraces('t', '', [ana, beto, cris, dani].map((driverId) => ({ driverId, car: 'mx5' }))).map((l) => l.data !== null);
    expect(withData).toEqual([true, true, true, true]);
    // La vuelta lenta de Ana se podó: su traza ya no existe
    const db = (repo as unknown as { db: { prepare: (q: string) => { get: (n: number) => unknown } } }).db;
    expect(db.prepare('SELECT 1 FROM lap_traces WHERE lap_id = ?').get(slower)).toBeUndefined();
  });

  it('bestLapsWithTraces respeta el orden pedido y omite a quien no tiene vuelta válida', () => {
    const { repo, ana, beto, cris, lap } = setup();
    lap(ana, 100_000, []);
    lap(beto, 90_000, [], false); // anulada: no cuenta
    lap(cris, 99_000, []);
    const laps = repo.bestLapsWithTraces('t', '', [{ driverId: cris, car: 'mx5' }, { driverId: beto, car: 'mx5' }, { driverId: ana, car: 'mx5' }]);
    expect(laps.map((l) => [l.driverName, l.lapMs])).toEqual([['Cris', 99_000], ['Ana', 100_000]]);
    expect(laps[0]!.data).toBeNull(); // sin traza grabada
  });
});
