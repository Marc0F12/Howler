import { describe, expect, it } from 'vitest';
import type { Command, ServerEvent } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { Bus } from './bus';
import { interpretSplits, parsePluginMessage } from './exact-sectors';
import { Tracker } from './tracker';

const buf = (o: unknown) => Buffer.from(JSON.stringify(o));
const splits = (...v: number[]) => new Map(v.map((x, i) => [i, x]));

describe('mensajes del plugin', () => {
  it('valida el formato', () => {
    expect(parsePluginMessage(buf({ v: 1, t: 'hello' }))).toEqual({ t: 'hello' });
    expect(parsePluginMessage(buf({ v: 1, t: 'split', car: 0, guid: 'A', i: 2, ms: 25380, cuts: 0 }))).toMatchObject({ t: 'split', i: 2, ms: 25380 });
    expect(parsePluginMessage(buf({ v: 1, t: 'lap', car: 1, guid: 'A', ms: 99541, cuts: 1 }))).toMatchObject({ t: 'lap', cuts: 1 });
    expect(parsePluginMessage(buf({ v: 2, t: 'hello' }))).toBeNull(); // otra versión
    expect(parsePluginMessage(buf({ v: 1, t: 'split', car: -1, guid: 'A', i: 0, ms: 1 }))).toBeNull();
    expect(parsePluginMessage(Buffer.from('no es json'))).toBeNull();
  });
});

describe('interpretación de splits', () => {
  it('duraciones de todos los sectores', () => {
    expect(interpretSplits(splits(14567, 25380, 24283, 24273, 11038), 99541, 5)).toEqual([14567, 25380, 24283, 24273, 11038]);
  });
  it('tiempos acumulados', () => {
    expect(interpretSplits(splits(14567, 39947, 64230, 88503, 99541), 99541, 5)).toEqual([14567, 25380, 24283, 24273, 11038]);
  });
  it('falta el último sector: es lo que sobra', () => {
    expect(interpretSplits(splits(14567, 25380, 24283, 24273), 99541, 5)).toEqual([14567, 25380, 24283, 24273, 11038]);
  });
  it('rechaza lo que no cuadra', () => {
    expect(interpretSplits(splits(14567, 25380, 24283, 24273, 99999), 99541, 5)).toBeNull(); // no suma
    expect(interpretSplits(new Map([[0, 1], [2, 3]]), 4, 3)).toBeNull(); // hueco en los índices
    expect(interpretSplits(new Map(), 1000, 3)).toBeNull();
  });
});

describe('Tracker con sectores exactos', () => {
  const setup = () => {
    const repo = new Repository(openDatabase(':memory:'));
    let clock = 1000;
    const tracker = new Tracker({ repo, bus: new Bus(), send: (_: Command) => {}, now: () => clock, positionIntervalMs: 100 });
    const feed = (e: ServerEvent) => tracker.handle(e);
    feed({ kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1, serverName: 's', track: 't', trackConfig: '', name: 'P', type: 1, durationMin: 0, laps: 0, waitTime: 0, ambientTemp: 0, roadTemp: 0, weather: '', elapsedMs: 0 });
    feed({ kind: 'newConnection', driverName: 'Marc', guid: 'A', carId: 0, carModel: 'c', carSkin: 's' });
    const lap = (ms: number): ServerEvent => ({ kind: 'lapCompleted', carId: 0, lapMs: ms, cuts: 0, leaderboard: [], grip: 1 });
    feed(lap(600_000)); // la primera vuelta tras conectar es una salida de boxes (no cuenta como mejor vuelta): se hace antes de probar
    const plugin = (...v: number[]) => {
      v.forEach((ms, i) => tracker.handlePlugin({ t: 'split', car: 0, guid: 'A', i, ms, cuts: 0 }));
      tracker.handlePlugin({ t: 'lap', car: 0, guid: 'A', ms: v.reduce((a, b) => a + b, 0), cuts: 0 });
    };
    return { repo, tracker, feed, lap, plugin, setClock: (t: number) => (clock = t) };
  };
  const best = (repo: Repository) => repo.records('t', '', ['c']).entries[0]!;

  it('el plugin avisa después de la vuelta del servidor: corrige los sectores estimados', () => {
    const { repo, feed, lap, plugin } = setup();
    feed(lap(100_000));
    expect(best(repo).sectorsExact).toBe(false);
    plugin(30_000, 40_000, 30_000);
    expect(best(repo)).toMatchObject({ sectorsExact: true, sectorsMs: [30_000, 40_000, 30_000] });
  });

  it('el plugin avisa antes que el servidor: se guardan exactos desde el principio', () => {
    const { repo, feed, lap, plugin } = setup();
    plugin(30_000, 40_000, 30_000);
    feed(lap(100_000));
    expect(best(repo)).toMatchObject({ sectorsExact: true, sectorsMs: [30_000, 40_000, 30_000] });
  });

  it('ignora mensajes de otro piloto en el mismo coche y splits que no cuadran', () => {
    const { repo, tracker, feed, lap } = setup();
    tracker.handlePlugin({ t: 'split', car: 0, guid: 'OTRO', i: 0, ms: 5, cuts: 0 });
    tracker.handlePlugin({ t: 'lap', car: 0, guid: 'OTRO', ms: 100_000, cuts: 0 });
    feed(lap(100_000));
    expect(best(repo).sectorsExact).toBe(false);
  });

  it('un nuevo índice 0 descarta los splits de una vuelta que no se cerró', () => {
    const { repo, tracker, feed, lap } = setup();
    tracker.handlePlugin({ t: 'split', car: 0, guid: 'A', i: 0, ms: 99, cuts: 0 }); // vuelta anterior incompleta
    tracker.handlePlugin({ t: 'split', car: 0, guid: 'A', i: 1, ms: 99, cuts: 0 });
    for (const [i, ms] of [30_000, 40_000, 30_000].entries()) tracker.handlePlugin({ t: 'split', car: 0, guid: 'A', i, ms, cuts: 0 });
    tracker.handlePlugin({ t: 'lap', car: 0, guid: 'A', ms: 100_000, cuts: 0 });
    feed(lap(100_000));
    expect(best(repo).sectorsMs).toEqual([30_000, 40_000, 30_000]);
  });

  it('guarda la última posición de cada coche para el mapa y la borra al desconectarse', () => {
    const { tracker, feed } = setup();
    expect(tracker.positions()).toEqual([]); // conectado pero aún sin posición
    feed({ kind: 'carUpdate', carId: 0, pos: { x: 10.5, y: 0, z: -20 }, velocity: { x: 10, y: 0, z: 0 }, gear: 1, rpm: 1, splinePos: 0.1 });
    expect(tracker.positions()).toEqual([{ carId: 0, driverId: expect.any(Number), x: 10.5, z: -20, speedKmh: 36 }]);
    feed({ kind: 'carUpdate', carId: 7, pos: { x: 1, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: 0 }, gear: 1, rpm: 1, splinePos: 0 }); // coche desconocido
    expect(tracker.positions()).toHaveLength(1);
    feed({ kind: 'connectionClosed', driverName: 'Marc', guid: 'A', carId: 0, carModel: 'c', carSkin: 's' });
    expect(tracker.positions()).toEqual([]);
  });

  it('el latido marca el plugin como activo y caduca', () => {
    const { tracker, setClock } = setup();
    expect(tracker.status().exactSectors).toBe(false);
    tracker.handlePlugin({ t: 'hello' });
    expect(tracker.status().exactSectors).toBe(true);
    setClock(40_000);
    expect(tracker.status().exactSectors).toBe(false);
  });
});
