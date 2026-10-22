import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { Repository } from './repository';

/** Tres pilotos, dos circuitos y dos coches con vueltas válidas, anuladas y choques. */
function seed() {
  const repo = new Repository(openDatabase(':memory:'));
  const s1 = repo.createSession({ track: 'monza', layout: '', name: 'Practice', type: 1 });
  const s2 = repo.createSession({ track: 'imola', layout: 'gp', name: 'Race', type: 3 });
  const ana = repo.upsertDriver('76561190000000001', 'Ana');
  const beto = repo.upsertDriver('76561190000000002', 'Beto');
  const cris = repo.upsertDriver('76561190000000003', 'Cris');
  const lap = (
    sessionId: number, driverId: number, track: string, layout: string, car: string, lapMs: number,
    o: { valid?: boolean; cuts?: number; vmax?: number | null; incidents?: ('car' | 'env')[] } = {},
  ) => repo.insertLap(
    { sessionId, driverId, track, layout, car, lapMs, sectorsMs: [], cuts: o.cuts ?? 0, grip: 1, valid: o.valid ?? true, invalidReason: o.valid === false ? 'corte' : null, maxSpeedKmh: o.vmax ?? null },
    (o.incidents ?? []).map((kind) => ({ kind, speed: 50, otherDriverId: null })),
  );

  // Monza con el mx5: Beto 100.000 (récord), Ana 101.000 (y 103.000), Cris 105.000
  lap(s1.id, ana, 'monza', '', 'mx5', 103_000, { vmax: 200 });
  lap(s1.id, ana, 'monza', '', 'mx5', 101_000, { vmax: 210, incidents: ['car'] });
  lap(s1.id, ana, 'monza', '', 'mx5', 95_000, { valid: false, cuts: 2, incidents: ['env', 'env'] });
  lap(s1.id, beto, 'monza', '', 'mx5', 100_000, { vmax: 220 });
  lap(s1.id, cris, 'monza', '', 'mx5', 105_000);
  // Monza con el bmw: solo Ana
  lap(s1.id, ana, 'monza', '', 'bmw', 99_000, { vmax: 250 });
  // Imola gp con el mx5: Beto 120.000, Ana 119.000
  lap(s2.id, beto, 'imola', 'gp', 'mx5', 120_000);
  lap(s2.id, ana, 'imola', 'gp', 'mx5', 119_000);
  return { repo, ana, beto, cris, s1, s2 };
}

describe('rankings', () => {
  it('vueltas, récords (solo con rivales), tiempo y circuitos', () => {
    const { repo, ana, beto } = seed();
    const r = repo.profiles.rankings();
    expect(r.laps.map((x) => [x.driverName, x.value])).toEqual([['Ana', 5], ['Beto', 2], ['Cris', 1]]);
    // Ana: Imola mx5 (récord con rival); Monza bmw lo corre solo ella (no cuenta). Beto: Monza mx5.
    expect(r.records.map((x) => [x.driverName, x.value])).toEqual([['Ana', 1], ['Beto', 1]]);
    expect(r.tracks[0]).toMatchObject({ driverId: ana, value: 2 });
    expect(r.timeMs[0]!.driverId).toBe(ana);
    expect(r.cleanPct).toEqual([]); // nadie llega a 20 vueltas
    expect(beto).toBeGreaterThan(0);
  });
  it('filtra por circuito y por periodo', () => {
    const { repo } = seed();
    const monza = repo.profiles.rankings({ track: 'monza', layout: '' });
    expect(monza.tracks.every((x) => x.value === 1)).toBe(true);
    expect(monza.laps.reduce((a, x) => a + x.value, 0)).toBeLessThan(8);
    expect(repo.profiles.rankings({ since: '2999-01-01T00:00:00Z' }).laps).toEqual([]);
    expect(repo.profiles.rankings({ since: '2000-01-01T00:00:00Z' }).laps.length).toBe(3);
  });
});

describe('ficha de piloto', () => {
  it('evolución del mejor tiempo: solo las mejoras, sin vueltas anuladas', () => {
    const { repo, ana } = seed();
    const pr = repo.profiles.driverProfile(ana)!.progress;
    expect(pr.find((x) => x.track === 'monza' && x.car === 'mx5')!.points.map((x) => x.ms)).toEqual([103_000, 101_000]);
    expect(pr.find((x) => x.car === 'bmw')!.points).toHaveLength(1);
    expect(pr[0]!.points.length).toBeGreaterThanOrEqual(pr[1]!.points.length); // las combinaciones con más mejoras, primero
  });

  it('totales, choques, favoritos y récords/podios', () => {
    const { repo, ana } = seed();
    const p = repo.profiles.driverProfile(ana)!;
    expect(p.name).toBe('Ana');
    expect(p.totals).toMatchObject({ laps: 5, validLaps: 4, cuts: 2, sessions: 2, tracks: 2, cars: 2, drivers: 1, maxSpeedKmh: 250 });
    expect(p.totals.timeMs).toBe(103_000 + 101_000 + 95_000 + 99_000 + 119_000);
    expect(p.carCollisions).toBe(1);
    expect(p.envCollisions).toBe(2);
    expect(p.favoriteTrack).toEqual({ track: 'monza', layout: '', laps: 4 });
    expect(p.favoriteCar).toEqual({ car: 'mx5', laps: 4 });
    // Récord: Monza bmw (la única) e Imola mx5 (119.000 < 120.000). En Monza mx5 es 2.ª.
    expect(p.records).toBe(2);
    expect(p.podiums).toBe(3);
  });

  it('por combinación: mejor vuelta, media de las válidas, puesto entre pilotos y récord', () => {
    const { repo, ana } = seed();
    const c = repo.profiles.driverProfile(ana)!.combos.find((x) => x.track === 'monza' && x.car === 'mx5')!;
    expect(c).toMatchObject({ laps: 3, validLaps: 2, bestMs: 101_000, avgMs: 102_000, rank: 2, drivers: 3, recordMs: 100_000, maxSpeedKmh: 210 });
    expect(c.stdMs).toBeCloseTo(1_000, 5); // valores 101.000 y 103.000: desviación típica 1.000
  });

  it('una combinación con todas las vueltas anuladas no tiene mejor vuelta ni puesto', () => {
    const { repo, s1 } = seed();
    const dani = repo.upsertDriver('76561190000000009', 'Dani');
    repo.insertLap({ sessionId: s1.id, driverId: dani, track: 'monza', layout: '', car: 'mx5', lapMs: 90_000, sectorsMs: [], cuts: 1, grip: 1, valid: false, invalidReason: 'corte' }, []);
    const c = repo.profiles.driverProfile(dani)!.combos[0]!;
    expect([c.bestMs, c.rank, c.avgMs, c.stdMs]).toEqual([null, null, null, null]);
    expect(repo.profiles.driverProfile(dani)!.records).toBe(0);
  });

  it('sesiones recientes con su puesto en cada una', () => {
    const { repo, ana } = seed();
    const s = repo.profiles.driverProfile(ana)!.sessions;
    const monza = s.find((x) => x.track === 'monza')!;
    expect(monza).toMatchObject({ laps: 4, validLaps: 3, bestMs: 99_000, position: 1, drivers: 3 });
    expect(monza.cars.sort()).toEqual(['bmw', 'mx5']);
    expect(s.find((x) => x.track === 'imola')).toMatchObject({ position: 1, drivers: 2 });
  });

  it('un piloto que no existe da null; la actividad cuenta las vueltas de hoy', () => {
    const { repo, ana } = seed();
    expect(repo.profiles.driverProfile(9999)).toBeNull();
    const act = repo.profiles.driverProfile(ana)!.activity;
    expect(act.reduce((a, d) => a + d.laps, 0)).toBe(5);
    expect(act).toHaveLength(1);
  });

  it('la lista de pilotos ordena por vueltas y no incluye a quien no ha dado ninguna', () => {
    const { repo } = seed();
    repo.upsertDriver('76561190000000008', 'Sin vueltas');
    expect(repo.profiles.driverList().map((d) => [d.name, d.laps])).toEqual([['Ana', 5], ['Beto', 2], ['Cris', 1]]);
  });
});

describe('salidas de boxes en las estadísticas', () => {
  it('no cuentan en la media, la regularidad ni el tiempo dando vueltas, pero siguen en el número de vueltas', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const s = repo.createSession({ track: 't', layout: '', name: 'P', type: 1 });
    const ana = repo.upsertDriver('A', 'Ana');
    const add = (ms: number, outLap = false) =>
      repo.insertLap({ sessionId: s.id, driverId: ana, track: 't', layout: '', car: 'mx5', lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: !outLap, pending: outLap, invalidReason: null, outLap }, []);
    add(698_000, true); // salida de boxes de 11:38 (pendiente de revisión)
    add(100_000);
    add(102_000);
    const p = repo.profiles.driverProfile(ana)!;
    const c = p.combos[0]!;
    expect(c).toMatchObject({ laps: 3, validLaps: 2, outLaps: 1, bestMs: 100_000, avgMs: 101_000 });
    expect(c.stdMs).toBeCloseTo(1_000, 5);
    expect(p.totals.timeMs).toBe(202_000);
    expect(p.totals.laps).toBe(3);
    expect(p.totals.pendingLaps).toBe(1);
  });
});

describe('ficha de circuito', () => {
  it('top por piloto (su mejor coche), con diferencia con el primero', () => {
    const { repo } = seed();
    const t = repo.profiles.trackProfile('monza', '')!;
    // Ana con el bmw 99.000 le gana a su mx5 de 101.000: sale una sola vez, con el bmw.
    expect(t.top.map((x) => [x.position, x.driverName, x.car, x.lapMs, x.gapMs])).toEqual([
      [1, 'Ana', 'bmw', 99_000, 0], [2, 'Beto', 'mx5', 100_000, 1_000], [3, 'Cris', 'mx5', 105_000, 6_000],
    ]);
    expect(t.record).toMatchObject({ driverName: 'Ana', lapMs: 99_000 });
    expect(t.top[1]!.maxSpeedKmh).toBe(220);
  });

  it('récord por coche, pilotos más activos y totales', () => {
    const { repo } = seed();
    const t = repo.profiles.trackProfile('monza', '')!;
    expect(t.cars.map((c) => [c.car, c.bestMs, c.driverName, c.drivers])).toEqual([['bmw', 99_000, 'Ana', 1], ['mx5', 100_000, 'Beto', 3]]);
    expect(t.busiest[0]).toMatchObject({ driverName: 'Ana', laps: 4 });
    expect(t.totals).toMatchObject({ laps: 6, validLaps: 5, drivers: 3, cars: 2 });
  });

  it('un circuito sin vueltas da null y el layout cuenta como circuito distinto', () => {
    const { repo } = seed();
    expect(repo.profiles.trackProfile('monza', 'gp')).toBeNull();
    expect(repo.profiles.trackProfile('imola', 'gp')!.totals.laps).toBe(2);
  });

  it('la lista de circuitos trae el récord y quién lo tiene', () => {
    const { repo } = seed();
    const l = repo.profiles.trackList();
    expect(l.find((t) => t.track === 'monza')).toMatchObject({ laps: 6, drivers: 3, cars: 2, recordMs: 99_000, recordDriverName: 'Ana', recordCar: 'bmw' });
    expect(l.find((t) => t.track === 'imola')).toMatchObject({ layout: 'gp', recordMs: 119_000, recordDriverName: 'Ana' });
  });
});

describe('ficha de coche', () => {
  it('mejor tiempo en cada circuito, con quién lo tiene', () => {
    const { repo } = seed();
    const c = repo.profiles.carProfile('mx5')!;
    expect(c.totals).toMatchObject({ laps: 7, drivers: 3, tracks: 2 });
    const monza = c.tracks.find((t) => t.track === 'monza')!;
    expect(monza).toMatchObject({ bestMs: 100_000, driverName: 'Beto', laps: 5, drivers: 3 });
    expect(c.tracks.find((t) => t.track === 'imola')).toMatchObject({ layout: 'gp', bestMs: 119_000, driverName: 'Ana' });
    expect(c.busiest[0]).toMatchObject({ driverName: 'Ana', laps: 4 });
  });

  it('un coche que no existe da null y la lista ordena por vueltas', () => {
    const { repo } = seed();
    expect(repo.profiles.carProfile('nada')).toBeNull();
    expect(repo.profiles.carList().map((c) => [c.car, c.laps])).toEqual([['mx5', 7], ['bmw', 1]]);
  });
});

describe('Steam ID', () => {
  it('solo se lee con driverSteamId (uso interno) y no aparece en ninguna ficha', () => {
    const { repo, ana } = seed();
    expect(repo.driverSteamId(ana)).toBe('76561190000000001');
    const dump = JSON.stringify([repo.profiles.driverProfile(ana), repo.profiles.driverList(), repo.profiles.trackProfile('monza', ''), repo.profiles.carProfile('mx5')]);
    expect(dump).not.toContain('7656119');
  });
});

describe('pilotos ocultos', () => {
  it('no cuentan en puestos, récords, totales ni listados, y no salen conectados en la torre', () => {
    const { repo, ana, beto, s1 } = seed();
    repo.driverAdmin.setHidden(beto, true);
    const p = repo.profiles.driverProfile(ana)!;
    const monza = p.combos.find((c) => c.track === 'monza' && c.car === 'mx5')!;
    expect(monza).toMatchObject({ rank: 1, recordMs: 101_000 }); // Beto (más rápido) está oculto
    expect(p.records).toBeGreaterThanOrEqual(1);
    expect(repo.profiles.carProfile('mx5')!.totals.drivers).toBe(2);
    expect(repo.profiles.trackProfile('monza', '')!.totals.drivers).toBe(2);
    expect(repo.profiles.carList().find((c) => c.car === 'mx5')!.drivers).toBe(2);
    const row = repo.sessionTiming(repo.sessionById(s1.id), [{ carId: 1, driverId: beto, name: 'Beto', car: 'mx5' } as never]);
    expect(row.rows.some((r) => r.driverId === beto)).toBe(false);
  });
  it('la evolución sale en orden de fecha aunque los ids no lo estén (vueltas importadas)', () => {
    const { repo, ana, s1 } = seed();
    const db = (repo as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    const id = repo.insertLap({ sessionId: s1.id, driverId: ana, track: 'monza', layout: '', car: 'mx5', lapMs: 90_000, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    db.prepare('UPDATE laps SET created_at = ? WHERE id = ?').run('2001-01-01T00:00:00.000Z', id);
    const pr = repo.profiles.driverProfile(ana)!.progress.filter((x) => x.car === 'mx5' && x.track === 'monza');
    expect(pr[0]!.points[0]!.ms).toBe(90_000);
  });
});

describe('mejor vuelta personal (para guardar solo esa traza)', () => {
  it('solo la mejor válida de cada piloto con cada coche; una anulada no cuenta', () => {
    const { repo } = seed();
    const rows = (repo as any).db.prepare("SELECT id, lap_ms, valid FROM laps WHERE driver_id = (SELECT id FROM drivers WHERE name = 'Ana') AND track = 'monza' AND car = 'mx5' ORDER BY id").all() as { id: number; lap_ms: number; valid: number }[];
    const [slow, best, voided] = rows;
    expect(repo.isPersonalBest(slow!.id)).toBe(false);
    expect(repo.isPersonalBest(best!.id)).toBe(true);
    expect(repo.isPersonalBest(voided!.id)).toBe(true); // la comprobación es del tiempo; el tracker solo la usa con vueltas válidas
    expect(repo.isPersonalBest(99999)).toBe(false);
  });
});
