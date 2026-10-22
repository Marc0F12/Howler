import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { Repository } from './repository';

function seed() {
  const repo = new Repository(openDatabase(':memory:'));
  const ana = repo.upsertDriver('1', 'Ana');
  const beto = repo.upsertDriver('2', 'Beto');
  const lap = (sessionId: number, driverId: number, track: string, car: string, lapMs: number, valid = true) =>
    repo.insertLap({ sessionId, driverId, track, layout: '', car, lapMs, sectorsMs: [], cuts: 0, grip: 1, valid, invalidReason: null, sectorsExact: true }, []);
  // Dos sesiones distintas con el MISMO circuito y coche (el caso que se mezclaba), una carrera en otro circuito y una vacía
  const s1 = repo.createSession({ track: 'monza', layout: '', name: 'Practice', type: 1 });
  const s2 = repo.createSession({ track: 'monza', layout: '', name: 'Race', type: 3 });
  const s3 = repo.createSession({ track: 'imola', layout: '', name: 'Race', type: 3 });
  repo.createSession({ track: 'imola', layout: '', name: 'Vacía', type: 1 });
  lap(s1.id, ana, 'monza', 'mx5', 100_000); lap(s1.id, ana, 'monza', 'mx5', 99_000); lap(s1.id, beto, 'monza', 'mx5', 101_000);
  lap(s2.id, beto, 'monza', 'mx5', 98_000); lap(s2.id, ana, 'monza', 'mx5', 97_000, false);
  lap(s3.id, ana, 'imola', 'bmw', 120_000);
  return { repo, ana, beto, s1, s2, s3 };
}

describe('historial de sesiones', () => {
  it('lista solo las sesiones con vueltas, la más reciente primero, con sus datos propios', () => {
    const { repo, s1, s2 } = seed();
    const page = repo.sessionHistory.list({ limit: 10, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.id)).toEqual([...page.items.map((i) => i.id)].sort((a, b) => b - a));
    const a = page.items.find((i) => i.id === s1.id)!;
    expect(a).toMatchObject({ laps: 3, validLaps: 3, drivers: 2, bestMs: 99_000, bestDriverName: 'Ana', cars: ['mx5'] });
    expect(a.driverNames.map((d) => d.name)).toEqual(['Ana', 'Beto']); // Ana dio más vueltas
    const b = page.items.find((i) => i.id === s2.id)!;
    expect(b).toMatchObject({ laps: 2, validLaps: 1, bestMs: 98_000, bestDriverName: 'Beto' }); // la vuelta anulada de Ana no cuenta
  });
  it('filtra por circuito, coche, tipo y piloto, y pagina', () => {
    const { repo, ana } = seed();
    expect(repo.sessionHistory.list({ track: 'monza', limit: 10, offset: 0 }).total).toBe(2);
    expect(repo.sessionHistory.list({ car: 'bmw', limit: 10, offset: 0 }).total).toBe(1);
    expect(repo.sessionHistory.list({ type: 3, limit: 10, offset: 0 }).total).toBe(2);
    expect(repo.sessionHistory.list({ driverId: ana, type: 1, limit: 10, offset: 0 }).total).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(repo.sessionHistory.list({ from: today, to: today, limit: 10, offset: 0 }).total).toBe(3);
    expect(repo.sessionHistory.list({ to: '2000-01-01', limit: 10, offset: 0 }).total).toBe(0);
    expect(repo.sessionHistory.list({ from: '2999-01-01', limit: 10, offset: 0 }).total).toBe(0);
    const p = repo.sessionHistory.list({ limit: 1, offset: 1 });
    expect(p.total).toBe(3);
    expect(p.items).toHaveLength(1);
  });
  it('sessionById y la clasificación de una sesión concreta no mezclan las demás', () => {
    const { repo, s1, s2 } = seed();
    expect(repo.sessionById(99999)).toBeNull();
    const t1 = repo.sessionTiming(repo.sessionById(s1.id), []);
    const t2 = repo.sessionTiming(repo.sessionById(s2.id), []);
    expect(t1.rows.map((r) => [r.driverName, r.bestMs])).toEqual([['Ana', 99_000], ['Beto', 101_000]]);
    expect(t2.rows.map((r) => [r.driverName, r.bestMs]).slice(0, 1)).toEqual([['Beto', 98_000]]);
  });
});
