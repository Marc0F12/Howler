import { describe, expect, it } from 'vitest';
import { SCORING_PRESETS, newBadge, type ChampionshipInput } from '@howler/shared';
import { openDatabase } from './database';
import { Repository } from './repository';

function setup() {
  const repo = new Repository(openDatabase(':memory:'));
  const ids = { a: repo.upsertDriver('1', 'Ana'), b: repo.upsertDriver('2', 'Beto'), c: repo.upsertDriver('3', 'Cris'), x: repo.upsertDriver('9', 'Ajeno') };
  const lap = (sessionId: number, driverId: number, lapMs: number, o: { car?: string; valid?: boolean } = {}) =>
    repo.insertLap({ sessionId, driverId, track: 'monza', layout: '', car: o.car ?? 'mx5', lapMs, sectorsMs: [], cuts: 0, grip: 1, valid: o.valid ?? true, invalidReason: null }, []);
  /** Una carrera de 3 vueltas por piloto con los tiempos dados. */
  const race = (type: number, times: Record<number, number[]>, track = 'monza') => {
    const s = repo.createSession({ track, layout: '', name: 'S', type });
    for (const [d, ts] of Object.entries(times)) ts.forEach((t) => lap(s.id, Number(d), t));
    return s.id;
  };
  const input = (o: Partial<ChampionshipInput> = {}): ChampionshipInput => ({
    name: 'Copa', format: 'teams', status: 'active', scoring: { ...SCORING_PRESETS.f1!.config, bonuses: [{ kind: 'pole', points: 2 }] },
    teams: [{ key: 'r', name: 'Rojos', color: '#f00' }, { key: 'v', name: 'Verdes', color: '#0f0' }],
    entries: [{ driverId: ids.a, teamKey: 'r' }, { driverId: ids.b, teamKey: 'r' }, { driverId: ids.c, teamKey: 'v' }],
    rounds: [{ track: 'monza', raceAt: '2026-10-24T21:45:00Z', mods: [{ name: 'MX-5', kind: 'car', url: 'https://example.com/mx5' }] }, { track: 'imola' }],
    mods: [{ name: 'Skins', kind: 'skins', url: 'https://example.com/skins' }],
    ...o,
  });
  return { repo, ids, race, lap, input };
}

describe('campeonatos', () => {
  it('crea y devuelve la definición con carreras numeradas, mods y equipos', () => {
    const { repo, input } = setup();
    const id = repo.championships.save(null, input());
    const c = repo.championships.get(id)!;
    expect(c).toMatchObject({ name: 'Copa', status: 'active', rounds: 2, played: 0, participants: 3, leader: null });
    expect(c.roundList.map((r) => [r.number, r.track, r.mods.length])).toEqual([[1, 'monza', 1], [2, 'imola', 0]]);
    expect(c.mods).toHaveLength(1);
    expect(c.next).toMatchObject({ number: 1, track: 'monza' });
    expect(c.teams.map((t) => t.name)).toEqual(['Rojos', 'Verdes']);
  });

  it('guarda el diseño de la insignia, lo devuelve y lo conserva al editar; un diseño roto se rechaza', () => {
    const { repo, input } = setup();
    const design = newBadge({ emblem: 'gi:crown', text: 'GP' });
    const id = repo.championships.save(null, input({ badgeDesign: design }));
    expect(repo.championships.get(id)!.badgeDesign).toEqual(design);
    expect(repo.championships.list(true)[0]!.badgeDesign).toEqual(design);
    expect(repo.championships.save(id, input({ badgeDesign: null })) && repo.championships.get(id)!.badgeDesign).toBeNull();
    expect(() => repo.championships.save(id, input({ badgeDesign: { ...design, shape: 'estrella' } as never }))).toThrow(/insignia/);
    expect(repo.championships.get(id)!.badgeDesign).toBeNull();
  });

  it('un JSON de insignia corrupto en la base se ignora y la lista da los colores de los equipos', () => {
    const { repo, input } = setup();
    const id = repo.championships.save(null, input());
    (repo as unknown as { db: { prepare(q: string): { run(...a: unknown[]): void } } }).db.prepare('UPDATE championships SET badge_design = ? WHERE id = ?').run('{no es json', id);
    const c = repo.championships.get(id)!;
    expect(c.badgeDesign).toBeNull();
    expect(c.teamColors).toEqual(['#f00', '#0f0']);
  });

  it('guarda la ficha del mod con su imagen y especificaciones', () => {
    const { repo, input } = setup();
    const id = repo.championships.save(null, input({ mods: [{ name: 'Singer', kind: 'car', url: 'https://example.com/d', imageUrl: 'https://example.com/i.jpg', specs: { Potencia: '500 hp', Tracción: 'RWD' } }] }));
    expect(repo.championships.get(id)!.mods[0]).toMatchObject({ kind: 'car', imageUrl: 'https://example.com/i.jpg', specs: { Potencia: '500 hp', Tracción: 'RWD' } });
    expect(repo.championships.get(id)!.roundList[0]!.mods[0]).toMatchObject({ imageUrl: null, specs: {} });
  });

  it('asigna sola la carrera que encaja, puntúa solo a los inscritos y suma las poles de la clasificación', () => {
    const { repo, ids, race, input } = setup();
    const id = repo.championships.save(null, input());
    // clasificación: gana la pole Cris; carrera: Ana 1.º, Cris 2.º, Beto 3.º; el ajeno no puntúa
    race(2, { [ids.a]: [92_000], [ids.b]: [93_000], [ids.c]: [91_000], [ids.x]: [90_000] });
    race(3, { [ids.a]: [95_000, 95_000, 95_000], [ids.c]: [96_000, 96_000, 96_000], [ids.b]: [97_000, 97_000, 97_000], [ids.x]: [80_000, 80_000, 80_000] });
    const c = repo.championships.get(id)!;
    expect(c.played).toBe(1);
    expect(c.roundList[0]).toMatchObject({ played: true });
    expect(c.roundList[0]!.results.map((r) => [r.driverId, r.finishPos, r.points])).toEqual([[ids.a, 1, 25], [ids.c, 2, 20], [ids.b, 3, 15]]); // Cris 18 + 2 de pole
    expect(c.standings.drivers.map((d) => [d.id, d.total])).toEqual([[ids.a, 25], [ids.c, 20], [ids.b, 15]]);
    expect(c.standings.teams.map((t) => t.total)).toEqual([40, 20]);
    expect(c.leader).toMatchObject({ driverId: ids.a, name: 'Ana' });
    expect(c.next).toMatchObject({ number: 2 });
  });

  it('un borrador no asigna nada; al activarlo se asigna lo que encaja y lo de otro circuito queda como candidato', () => {
    const { repo, ids, race, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft' }));
    const monza = race(3, { [ids.a]: [95_000], [ids.b]: [96_000] });
    expect(repo.championships.get(id)!.played).toBe(0);
    repo.championships.setStatus(id, 'active');
    expect(repo.championships.get(id)!.roundList[0]!.raceSessionId).toBe(monza);
    const spa = race(3, { [ids.a]: [95_000], [ids.b]: [96_000] }, 'spa'); // ningún circuito del campeonato
    const solo = race(3, { [ids.x]: [90_000] }); // nadie inscrito: ni siquiera es candidata
    const cand = repo.championships.candidates(id);
    expect(cand.map((x) => x.sessionId)).toEqual([spa]);
    expect(cand[0]).toMatchObject({ enrolledDrivers: 2, suggestedRound: null });
    expect(solo).toBeGreaterThan(0);
  });

  it('asignar a mano mueve la sesión y exige el tipo correcto', () => {
    const { repo, ids, race, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft' }));
    const practice = race(1, { [ids.a]: [95_000] });
    const raceId = race(3, { [ids.a]: [95_000], [ids.b]: [96_000] });
    const round = repo.championships.get(id)!.roundList[0]!.id;
    expect(() => repo.championships.assign(id, round, 'race', practice)).toThrow(/no es una carrera/);
    expect(repo.championships.assign(id, round, 'race', raceId)).toBe(true);
    expect(repo.championships.get(id)!.roundList[0]).toMatchObject({ raceSessionId: raceId, played: true });
    repo.championships.assign(id, round, 'race', null);
    expect(repo.championships.get(id)!.roundList[0]!.played).toBe(false);
  });

  it('los ajustes a mano suman o restan y se editan conservando las sesiones asignadas', () => {
    const { repo, ids, race, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft' }));
    const raceId = race(3, { [ids.a]: [95_000], [ids.b]: [96_000] });
    let c = repo.championships.get(id)!;
    const round = c.roundList[0]!.id;
    repo.championships.assign(id, round, 'race', raceId);
    repo.championships.addAdjustment(id, { roundId: round, driverId: ids.a, points: -10, reason: 'Penalización por choque' });
    c = repo.championships.get(id)!;
    expect(c.standings.drivers.find((d) => d.id === ids.a)!.total).toBe(15);
    expect(c.adjustments[0]).toMatchObject({ round: 0, points: -10, reason: 'Penalización por choque' });
    // editar: se cambia el nombre y se añade una carrera sin perder la sesión de la primera
    repo.championships.save(id, input({ name: 'Copa 2', status: 'draft', rounds: [{ id: round, track: 'monza' }, { track: 'imola' }, { track: 'spa' }] }));
    c = repo.championships.get(id)!;
    expect(c).toMatchObject({ name: 'Copa 2', rounds: 3 });
    expect(c.roundList[0]!.raceSessionId).toBe(raceId);
    expect(c.standings.drivers.find((d) => d.id === ids.a)!.total).toBe(15);
  });

  it('un borrador no sale en el listado público ni en get público; borrar elimina todo', () => {
    const { repo, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft' }));
    expect(repo.championships.list(false)).toHaveLength(0);
    expect(repo.championships.list(true)).toHaveLength(1);
    expect(repo.championships.get(id, true)).toBeNull();
    expect(repo.championships.remove(id)).toBe(true);
    expect(repo.championships.get(id)).toBeNull();
  });

  it('valida equipos repetidos, pilotos repetidos y equipos inexistentes', () => {
    const { repo, ids, input } = setup();
    expect(() => repo.championships.save(null, input({ teams: [{ key: 'r', name: 'A', color: '#f00' }, { key: 'r', name: 'B', color: '#0f0' }] }))).toThrow(/misma clave/);
    expect(() => repo.championships.save(null, input({ entries: [{ driverId: ids.a, teamKey: null }, { driverId: ids.a, teamKey: null }] }))).toThrow(/dos veces/);
    expect(() => repo.championships.save(null, input({ entries: [{ driverId: ids.a, teamKey: 'zzz' }] }))).toThrow(/no existe/);
  });

  it('la prueba puede limitar los coches: solo valen las vueltas con ellos', () => {
    const { repo, ids, lap, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft', rounds: [{ track: 'monza', cars: ['bmw'] }] }));
    const s = repo.createSession({ track: 'monza', layout: '', name: 'S', type: 3 });
    lap(s.id, ids.a, 95_000, { car: 'mx5' }); lap(s.id, ids.a, 95_000, { car: 'mx5' });
    lap(s.id, ids.b, 99_000, { car: 'bmw' });
    repo.championships.assign(id, repo.championships.get(id)!.roundList[0]!.id, 'race', s.id);
    expect(repo.championships.get(id)!.roundList[0]!.results.map((r) => r.driverId)).toEqual([ids.b]);
  });
});

describe('penalizaciones en las carreras del campeonato', () => {
  /** Carrera de 3 vueltas: Ana primera (270 s), Beto 2.º (272 s), Cris 3.º (274 s). */
  function raceSetup() {
    const { repo, ids, race, lap, input } = setup();
    const id = repo.championships.save(null, input({ status: 'draft', scoring: { ...SCORING_PRESETS.f1!.config, bonuses: [] } }));
    const sess = race(3, { [ids.a]: [90_000, 90_000, 90_000], [ids.b]: [90_500, 90_500, 91_000], [ids.c]: [91_000, 91_000, 92_000] });
    repo.championships.assign(id, repo.championships.get(id)!.roundList[0]!.id, 'race', sess);
    return { repo, ids, id, sess, lap };
  }
  const order = (repo: ReturnType<typeof setup>['repo'], id: number) => repo.championships.get(id)!.roundList[0]!.results.map((r) => [r.driverId, r.finishPos]);

  it('sin penalizaciones gana quien menos tarda; +segundos cambian el puesto y los puntos', () => {
    const { repo, ids, id, sess } = raceSetup();
    expect(order(repo, id)).toEqual([[ids.a, 1], [ids.b, 2], [ids.c, 3]]);
    repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'time', seconds: 5, reason: 'Salida en falso' });
    const r = repo.championships.get(id)!;
    expect(order(repo, id)).toEqual([[ids.b, 1], [ids.c, 2], [ids.a, 3]]); // 275 s: ahora tarda más que Beto (272) y que Cris (274)
    expect(r.roundList[0]!.results.find((x) => x.driverId === ids.a)).toMatchObject({ penaltyMs: 5000, totalMs: 275_000, dsq: false, points: 15, notes: ['Salida en falso'] });
    expect(r.standings.drivers.find((d) => d.id === ids.b)!.total).toBe(25);
  });

  it('los avisos solo se guardan (no cambian nada) y quitar una penalización devuelve el resultado', () => {
    const { repo, ids, id, sess } = raceSetup();
    repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'warning', reason: 'Conducción peligrosa' });
    expect(order(repo, id)[0]).toEqual([ids.a, 1]);
    const pid = repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'time', seconds: 10, reason: '' });
    expect(order(repo, id)[0]).toEqual([ids.b, 1]);
    repo.penalties.remove(pid);
    expect(order(repo, id)[0]).toEqual([ids.a, 1]);
    expect(repo.penalties.forSession(sess).map((p) => p.kind)).toEqual(['warning']);
  });

  it('una descalificación deja al piloto sin puesto ni puntos, y los demás suben', () => {
    const { repo, ids, id, sess } = raceSetup();
    repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'dsq', reason: 'Atajo' });
    expect(order(repo, id)).toEqual([[ids.b, 1], [ids.c, 2], [ids.a, null]]);
    const r = repo.championships.get(id)!;
    expect(r.roundList[0]!.results.find((x) => x.driverId === ids.a)).toMatchObject({ dsq: true, points: 0, finishPos: null });
    expect(r.standings.drivers.find((d) => d.id === ids.b)!.total).toBe(25);
  });

  it('las penalizaciones automáticas suman segundos por cada corte y por cada choque fuerte, y se pueden apagar', () => {
    const { repo, ids, id, sess } = raceSetup();
    // Ana (la más rápida) tuvo 2 cortes y un choque a 50 km/h y otro a 5 km/h
    const db = (repo as any).db;
    db.prepare('UPDATE laps SET cuts = 2 WHERE session_id = ? AND driver_id = ? AND id = (SELECT MIN(id) FROM laps WHERE session_id = ? AND driver_id = ?)').run(sess, ids.a, sess, ids.a);
    const lapId = db.prepare('SELECT MIN(id) AS id FROM laps WHERE session_id = ? AND driver_id = ?').get(sess, ids.a).id;
    db.prepare("INSERT INTO lap_incidents (lap_id, kind, speed) VALUES (?, 'car', 50), (?, 'car', 5)").run(lapId, lapId);
    expect(order(repo, id)[0]).toEqual([ids.a, 1]); // por defecto no se penaliza nada
    repo.championships.setAutoPenalties(() => ({ cutSeconds: 3, carHitSeconds: 4, carHitMinKmh: 20, envHitSeconds: 0, envHitMinKmh: 0 }));
    // 2 cortes × 3 s + 1 choque (el de 5 km/h no llega al umbral) × 4 s = 10 s: Ana pasa de 270 a 280 s y cae al último puesto
    expect(order(repo, id)).toEqual([[ids.b, 1], [ids.c, 2], [ids.a, 3]]);
    expect(repo.championships.get(id)!.roundList[0]!.results.find((x) => x.driverId === ids.a)!.penaltyMs).toBe(10_000);
    repo.championships.setAutoPenalties(() => ({ cutSeconds: 0, carHitSeconds: 0, carHitMinKmh: 0, envHitSeconds: 0, envHitMinKmh: 0 }));
    expect(order(repo, id)[0]).toEqual([ids.a, 1]);
  });

  it('valida: sesión y piloto existentes, y los segundos de una penalización de tiempo', () => {
    const { repo, ids, sess } = raceSetup();
    expect(() => repo.penalties.add({ sessionId: 999, driverId: ids.a, kind: 'warning', reason: '' })).toThrow(/sesión no existe/);
    expect(() => repo.penalties.add({ sessionId: sess, driverId: 999, kind: 'warning', reason: '' })).toThrow(/piloto no existe/);
    expect(() => repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'time', reason: '' })).toThrow(/segundos/);
    expect(() => repo.penalties.add({ sessionId: sess, driverId: ids.a, kind: 'time', seconds: 0, reason: '' })).toThrow(/segundos/);
  });

  it('la lista de sesiones recientes dice quién corrió en cada una', () => {
    const { repo, ids, sess } = raceSetup();
    const s = repo.penalties.recentSessions(5)[0]!;
    expect(s).toMatchObject({ id: sess, type: 3 });
    expect(s.drivers.map((d) => d.id).sort()).toEqual([ids.a, ids.b, ids.c].sort());
  });

  it('guarda clima, calendario completo, skin de cada inscrito y el ajuste de la imagen', () => {
    const { repo, ids, input } = setup();
    const schedule = [
      { kind: 'practice' as const, at: '2026-10-24T20:00:00Z', duration: '15 minutos' },
      { kind: 'race' as const, at: '2026-10-24T21:00:00Z', text: 'Coorre cooorre' },
      { kind: 'post' as const, at: null, title: 'Post carrera', duration: '5 - 15 minutos', text: 'Reclamaciones' },
    ];
    const id = repo.championships.save(null, input({
      imageFit: 'contain',
      entries: [{ driverId: ids.a, teamKey: 'r', car: 'bmw_m3_e30', skin: 'rojo' }, { driverId: ids.b, teamKey: 'r' }],
      rounds: [{ track: 'monza', weather: '3_clear', schedule }, { track: 'imola' }],
    }));
    const c = repo.championships.get(id)!;
    expect(c.imageFit).toBe('contain');
    expect(c.entries.find((e) => e.driverId === ids.a)).toMatchObject({ car: 'bmw_m3_e30', skin: 'rojo' });
    expect(c.entries.find((e) => e.driverId === ids.b)).toMatchObject({ car: null, skin: null });
    expect(c.roundList[0]).toMatchObject({ weather: '3_clear', schedule, practiceAt: '2026-10-24T20:00:00Z', qualiAt: null, raceAt: '2026-10-24T21:00:00Z' });
    expect(c.roundList[1]).toMatchObject({ weather: null, schedule: null });
    // al reeditar con las mismas pruebas se conservan (y se pueden quitar)
    repo.championships.save(id, input({ rounds: [{ id: c.roundList[0]!.id, track: 'monza' }, { id: c.roundList[1]!.id, track: 'imola', weather: '8_lightrain' }] }));
    const d = repo.championships.get(id)!;
    expect(d.roundList.map((r) => [r.weather, r.schedule])).toEqual([[null, null], ['8_lightrain', null]]);
    expect(d.imageFit).toBeNull();
  });

  it('un inscrito sin skin asignada usa la de la lista de coches del servidor, y la asignada manda', () => {
    const { repo, ids, input } = setup();
    repo.championships.setSkinSource((driverId) => (driverId === ids.a ? { car: 'mx5', skin: 'azul' } : driverId === ids.b ? { car: 'mx5', skin: 'verde' } : null));
    const id = repo.championships.save(null, input({ entries: [{ driverId: ids.a, teamKey: null }, { driverId: ids.b, teamKey: null, car: 'bmw', skin: 'rojo' }, { driverId: ids.c, teamKey: null }] }));
    const e = repo.championships.get(id)!.entries;
    expect(e.find((x) => x.driverId === ids.a)).toMatchObject({ car: 'mx5', skin: 'azul' });
    expect(e.find((x) => x.driverId === ids.b)).toMatchObject({ car: 'bmw', skin: 'rojo' });
    expect(e.find((x) => x.driverId === ids.c)).toMatchObject({ car: null, skin: null });
  });
});
