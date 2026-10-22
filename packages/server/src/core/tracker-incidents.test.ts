import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@howler/shared';
import { openDatabase, OUT_LAP_BACKFILL_SQL } from '../db/database';
import { Repository } from '../db/repository';
import { Bus } from './bus';
import { Tracker } from './tracker';

const KMH = 1 / 3.6;
const session: ServerEvent = {
  kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1, serverName: 'S',
  track: 'monza', trackConfig: '', name: 'Practice', type: 1, durationMin: 0, laps: 0, waitTime: 0,
  ambientTemp: 20, roadTemp: 25, weather: 'clear', elapsedMs: 0,
};
const conn = (carId: number, name: string, guid: string): ServerEvent => ({ kind: 'newConnection', driverName: name, guid, carId, carModel: 'mx5', carSkin: 'x' });

function setup(conditionsNow?: () => import('@howler/shared').SessionConditions | null) {
  const repo = new Repository(openDatabase(':memory:'));
  let clock = 1_000;
  const tracker = new Tracker({ repo, conditionsNow, bus: new Bus(), send: () => undefined, now: () => clock, positionIntervalMs: 100 });
  const feed = (e: ServerEvent) => tracker.handle(e);
  feed(session);
  feed(conn(0, 'Ana', 'A'));
  feed(conn(1, 'Beto', 'B'));
  /** El coche `id` va por una recta a `kmh` km/h (dirección `dir`: +1 o -1 en x) y se actualiza su posición. */
  const move = (id: number, x: number, kmh: number, dir = 1) =>
    feed({ kind: 'carUpdate', carId: id, pos: { x, y: 0, z: 0 }, velocity: { x: dir * kmh * KMH, y: 0, z: 0 }, gear: 3, rpm: 5000, splinePos: 0.5 });
  const hit = (carId: number, otherCarId: number | null, speed: number): ServerEvent =>
    ({ kind: 'collision', carId, otherCarId, speed, worldPos: { x: 0, y: 0, z: 0 }, relPos: { x: 0, y: 0, z: 0 } });
  const lap = (carId: number, lapMs = 90_000) => feed({ kind: 'lapCompleted', carId, lapMs, cuts: 0, grip: 1, leaderboard: [] });
  /** Vueltas guardadas de un piloto, con los choques que llevan. */
  const lapsOf = () => { const out: ReturnType<Repository['lapAdmin']['get']>[] = []; for (let id = 1; id < 20; id++) { const l = repo.lapAdmin.get(id); if (l) out.push(l); } return out; };
  return { repo, feed, move, hit, lap, lapsOf, setClock: (t: number) => (clock = t), clock: () => clock };
}

describe('velocidad relativa en los choques entre coches', () => {
  it('dos coches que van juntos a 120 km/h y se rozan: el juego dice 120, pero la velocidad relativa es ~0', () => {
    const { move, hit, feed, lap, lapsOf } = setup();
    move(0, 0, 120); move(1, 3, 120);
    feed(hit(0, 1, 120));
    lap(0);
    const inc = lapsOf()[0]!.incidents[0]!;
    expect(inc).toMatchObject({ kind: 'car', speed: 120 });
    expect(inc.relSpeed).toBeCloseTo(0, 1);
  });

  it('de frente a 100 km/h cada uno la relativa es 200; con otro coche parado, la del propio', () => {
    const { move, hit, feed, lap, lapsOf } = setup();
    move(0, 0, 100, 1); move(1, 50, 100, -1);
    feed(hit(0, 1, 100));
    move(1, 50, 0); // el otro se detiene
    feed(hit(0, 1, 100));
    lap(0);
    const rel = lapsOf()[0]!.incidents.map((i) => i.relSpeed);
    expect(rel[0]).toBeCloseTo(200, 1);
    expect(rel[1]).toBeCloseTo(100, 1);
  });

  it('si la última velocidad del otro coche es vieja (más de 0,5 s), no se inventa: relSpeed queda vacío', () => {
    const { move, hit, feed, lap, lapsOf, setClock, clock } = setup();
    move(1, 0, 150);
    setClock(clock() + 2_000);
    move(0, 0, 150);
    feed(hit(0, 1, 150));
    lap(0);
    expect(lapsOf()[0]!.incidents[0]!.relSpeed).toBeNull();
  });

  it('un choque con el entorno no tiene velocidad relativa', () => {
    const { move, hit, feed, lap, lapsOf } = setup();
    move(0, 0, 80);
    feed(hit(0, null, 80));
    lap(0);
    expect(lapsOf()[0]!.incidents[0]).toMatchObject({ kind: 'env', speed: 80, relSpeed: null });
  });
});

describe('salida de boxes al guardar las vueltas', () => {
  /** El coche 0 da una vuelta a un circuito de 100 m de largo (sin saltos) con muestras cada 100 ms y la cierra con el aviso del servidor. */
  function driveLap(h: ReturnType<typeof setup>, lapMs: number, teleportAt?: number) {
    for (let t = 0; t < lapMs; t += 100) {
      h.setClock(h.clock() + 100);
      h.move(0, teleportAt === t ? 5_000 : (t / 10) % 100, 150); // un salto de 5 km es volver a boxes
    }
    h.lap(0, lapMs);
  }

  it('la primera vuelta de un piloto es salida de boxes (no empezó en la meta); las siguientes no', () => {
    const h = setup();
    driveLap(h, 6_000);
    driveLap(h, 6_000);
    expect(h.lapsOf().map((l) => l!.outLap)).toEqual([true, false]);
  });

  it('un teletransporte a boxes durante una vuelta la marca como salida, y la siguiente vuelve a ser normal', () => {
    const h = setup();
    driveLap(h, 6_000);
    driveLap(h, 6_000, 3_000);
    driveLap(h, 6_000);
    expect(h.lapsOf().map((l) => l!.outLap)).toEqual([true, true, false]);
  });
});

describe('relleno del historial anterior (migración)', () => {
  it('marca la primera vuelta de cada piloto y sesión si es mucho más lenta que la mejor de la combinación', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const s = repo.createSession({ track: 't', layout: '', name: 'P', type: 1 });
    const ana = repo.upsertDriver('A', 'Ana');
    const beto = repo.upsertDriver('B', 'Beto');
    const add = (driverId: number, ms: number, car = 'mx5') =>
      repo.insertLap({ sessionId: s.id, driverId, track: 't', layout: '', car, lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    const slowFirst = add(ana, 698_000);   // 11:38 de salida de boxes
    const normal = add(ana, 100_000);
    const okFirst = add(beto, 105_000);    // primera vuelta normal (1,05× el mejor): no se marca
    const alone = add(ana, 500_000, 'bmw'); // única vuelta de su combinación: sin con qué comparar, no se marca
    const db = (repo as unknown as { db: { exec: (q: string) => void } }).db;
    db.exec(OUT_LAP_BACKFILL_SQL);
    const flagged = (id: number) => repo.lapAdmin.get(id)!.outLap;
    expect([flagged(slowFirst), flagged(normal), flagged(okFirst), flagged(alone)]).toEqual([true, false, false, false]);
  });
});

describe('las salidas de boxes no cuentan como mejor vuelta', () => {
  function driveLap(h: ReturnType<typeof setup>, lapMs: number) {
    for (let t = 0; t < lapMs; t += 100) { h.setClock(h.clock() + 100); h.move(0, (t / 10) % 100, 150); }
    h.lap(0, lapMs);
  }

  it('una salida de boxes rapidísima (aparece detrás de la meta) no es récord, aunque sea válida', () => {
    const h = setup();
    driveLap(h, 6_000); // primera vuelta tras conectar: salida de boxes, mucho más corta que una vuelta normal
    driveLap(h, 90_000);
    const entries = h.repo.records('monza', '', ['mx5']).entries;
    expect(entries.map((e) => e.lapMs)).toEqual([90_000]);
    expect(h.repo.combos()[0]!.bestMs).toBe(90_000);
  });

  it('si Howler se reinicia a mitad de sesión, la primera vuelta que ve es normal cuando su tiempo es razonable', () => {
    const h = setup();
    driveLap(h, 6_000);
    driveLap(h, 60_000); // vuelta normal: ya hay un mejor tiempo de referencia (60 s)
    // el piloto sigue conectado, pero Howler se reinicia: se pierde el recorrido de la vuelta en curso
    (h as unknown as { feed: (e: ServerEvent) => void }).feed({ kind: 'connectionClosed', driverName: 'Ana', guid: 'A', carId: 0, carModel: 'mx5', carSkin: 'x' });
    (h as unknown as { feed: (e: ServerEvent) => void }).feed({ kind: 'newConnection', driverName: 'Ana', guid: 'A', carId: 0, carModel: 'mx5', carSkin: 'x' });
    driveLap(h, 61_000); // primera vuelta tras reconectar con un tiempo normal (1,02× el mejor): vuelta de pista, no salida
    driveLap(h, 200_000); // otra vuelta rarísima justo después ya no es «primera»
    const laps = h.lapsOf().map((l) => [l!.lapMs, l!.outLap]);
    expect(laps).toEqual([[6_000, true], [60_000, false], [61_000, false], [200_000, false]]);
  });
});

describe('tres estados de vuelta: salida de boxes pendiente de revisión', () => {
  it('la primera vuelta tras conectar queda pendiente; la siguiente es válida', () => {
    const { lap, lapsOf } = setup();
    lap(0, 150_000);
    lap(0, 90_000);
    const [first, second] = lapsOf();
    expect(first).toMatchObject({ valid: false, pending: true, outLap: true });
    expect(second).toMatchObject({ valid: true, pending: false, outLap: false });
  });

  it('una salida de boxes con corte es nula, no pendiente', () => {
    const { feed, lapsOf } = setup();
    feed({ kind: 'lapCompleted', carId: 0, lapMs: 150_000, cuts: 1, grip: 1, leaderboard: [] });
    expect(lapsOf()[0]).toMatchObject({ valid: false, pending: false });
  });
});

describe('temperaturas en directo', () => {
  it('cada vuelta guarda la temperatura del aire y de la pista que mandó el servidor', () => {
    const { feed, lap, repo } = setup();
    lap(0);
    feed({ ...session, kind: 'sessionInfo', ambientTemp: 26, roadTemp: 41 } as ServerEvent); // el servidor actualiza el clima
    lap(0);
    const laps = repo.driverSessionLaps(1, 1);
    expect(laps.map((l) => [l.tempAir, l.tempTrack])).toEqual([[20, 25], [26, 41]]);
    expect(laps.every((l) => l.aids === null)).toBe(true); // las ayudas no se pueden medir en directo
  });

  it('un servidor que manda 0 y 0 no informa del clima: no se guarda como medida', () => {
    const { feed, lap, repo } = setup();
    feed({ ...session, kind: 'sessionInfo', ambientTemp: 0, roadTemp: 0 } as ServerEvent);
    lap(0);
    expect(repo.driverSessionLaps(1, 1)[0]).toMatchObject({ tempAir: null, tempTrack: null });
  });
});

describe('ajustes de sesión en directo', () => {
  it('cada sesión anota el combustible, daños y desgaste que tenía el servidor al empezar', () => {
    const { repo } = setup(() => ({ fuelPct: 0, damagePct: 200, tyreWearPct: 30, tyresOut: 2 }));
    expect(repo.latestSessionWithLaps()).toBeNull(); // aún sin vueltas
    const s = (repo as any).db.prepare('SELECT fuel_pct, damage_pct, tyre_wear_pct, tyres_out FROM sessions WHERE id = 1').get();
    expect({ ...s }).toEqual({ fuel_pct: 0, damage_pct: 200, tyre_wear_pct: 30, tyres_out: 2 });
  });
  it('sin saber los ajustes del servidor, la sesión queda sin condiciones', () => {
    const { repo, lap } = setup(() => null);
    lap(0);
    expect(repo.latestSessionWithLaps()!.conditions).toBeNull();
  });
});
