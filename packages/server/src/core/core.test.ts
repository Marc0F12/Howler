import { describe, expect, it } from 'vitest';
import type { Command, ServerEvent } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { Bus } from './bus';
import { SectorTimer } from './sector-timer';
import { Tracker } from './tracker';

/** Genera actualizaciones a 100 ms de un coche que recorre la vuelta a ritmo constante. */
function drive(timer: SectorTimer, lapMs: number, laps: number, t0 = 0, tickMs = 100) {
  let t = t0;
  const end = t0 + lapMs * laps;
  while (t <= end) {
    timer.update((((t - t0) / lapMs) % 1), t);
    t += tickMs;
  }
}

describe('SectorTimer', () => {
  it('mide sectores de una vuelta completa con error de pocos ms', () => {
    const timer = new SectorTimer();
    drive(timer, 90_000, 2, 50);
    expect(timer.takeLap(90_000)).toBeNull(); // la primera vuelta no se vio entera
    const s = timer.takeLap(90_000)!;
    expect(s).toHaveLength(3);
    for (const x of s) expect(Math.abs(x - 30_000)).toBeLessThan(10);
    expect(s.reduce((a, b) => a + b, 0)).toBe(90_000);
  });

  it('no inventa sectores en la primera vuelta si no vio la salida', () => {
    const timer = new SectorTimer();
    let t = 0;
    for (let p = 0.4; p < 1; p += 0.01) timer.update(p, (t += 100));
    timer.update(0.01, (t += 100)); // cruza meta con start desconocido
    expect(timer.takeLap(90_000)).toBeNull();
  });

  it('descarta la vuelta si el teletransporte a boxes rompe la medida', () => {
    const timer = new SectorTimer();
    timer.update(0.1, 0);
    timer.update(0.2, 100);
    timer.update(0.9, 200); // salto
    timer.update(0.95, 300);
    timer.update(0.02, 400);
    expect(timer.takeLap(90_000)).toBeNull();
  });

  it('funciona aunque LAP_COMPLETED llegue antes del cruce de meta', () => {
    const timer = new SectorTimer();
    const lapMs = 60_000;
    for (let t = 0; t <= lapMs; t += 100) timer.update((t / lapMs) % 1, t); // vuelta 1, con meta
    expect(timer.takeLap(lapMs)).toBeNull(); // no se vio su salida
    for (let t = lapMs + 100; t < lapMs * 2; t += 100) timer.update((t - lapMs) / lapMs, t); // vuelta 2 sin cruzar
    expect(timer.takeLap(lapMs)).not.toBeNull(); // el paquete de vuelta se adelanta
    timer.update(0.001, lapMs * 2 + 50); // el cruce llega tarde y no debe duplicar la vuelta
    for (let t = lapMs * 2 + 150; t < lapMs * 3; t += 100) timer.update((t - lapMs * 2) / lapMs, t);
    timer.update(0.001, lapMs * 3 + 50);
    expect(timer.takeLap(lapMs)).not.toBeNull(); // vuelta 3
  });
});

describe('Tracker', () => {
  function setup() {
    const repo = new Repository(openDatabase(':memory:'));
    const bus = new Bus();
    const sent: Command[] = [];
    let clock = 0;
    const tracker = new Tracker({ repo, bus, send: (c) => sent.push(c), now: () => clock, positionIntervalMs: 100 });
    const feed = (e: ServerEvent) => tracker.handle(e);
    return { repo, bus, tracker, sent, feed, setClock: (t: number) => (clock = t), clock: () => clock };
  }
  const session: ServerEvent = {
    kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1, serverName: 'S',
    track: 'ks_vallelunga', trackConfig: 'club', name: 'Practice', type: 1, durationMin: 0, laps: 0, waitTime: 0,
    ambientTemp: 20, roadTemp: 25, weather: 'clear', elapsedMs: 0,
  };
  const conn = (carId: number, name: string, guid: string): ServerEvent => ({
    kind: 'newConnection', driverName: name, guid, carId, carModel: 'mx5', carSkin: 'x',
  });
  const lap = (carId: number, lapMs: number, cuts = 0): ServerEvent => ({
    kind: 'lapCompleted', carId, lapMs, cuts, grip: 1, leaderboard: [],
  });

  it('guarda vueltas válidas con sectores y las ordena en records; los cortes quedan anulados', () => {
    const { repo, tracker, feed, setClock } = setup();
    feed(session);
    feed(conn(0, 'Marc', 'A'));
    feed(conn(1, 'Sapo', 'B'));
    // Marc: vuelta con sectores medidos
    let t = 1000;
    const timer = (id: number, lapMs: number) => {
      for (let u = 0; u <= lapMs * 2; u += 100) {
        setClock(t + u);
        feed({ kind: 'carUpdate', carId: id, pos: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, gear: 1, rpm: 1, splinePos: (u / lapMs) % 1 });
        if (u === lapMs) feed(lap(id, lapMs + 500)); // vuelta 1: sin sectores
        if (u === lapMs * 2) feed(lap(id, lapMs));
      }
    };
    timer(0, 80_000);
    feed(lap(1, 82_000, 1)); // corte -> anulada
    feed(lap(1, 85_000));
    const rec = repo.records('ks_vallelunga', 'club', ['mx5']);
    expect(rec.entries.map((e) => [e.driverName, e.lapMs])).toEqual([['Marc', 80_000], ['Sapo', 85_000]]);
    expect(rec.entries[1]!.gapMs).toBe(5_000);
    expect(rec.entries[0]!.sectorsMs.every((s) => s != null)).toBe(true);
    const recent = repo.recentLaps(10);
    expect(recent.find((l) => l.lapMs === 82_000)).toMatchObject({ valid: false, invalidReason: 'Anulada por corte' });
    expect(tracker.status().online.map((o) => o.name).sort()).toEqual(['Marc', 'Sapo']);
  });

  it('un piloto que cambia de nombre conserva su identidad por Steam ID', () => {
    const { repo, feed } = setup();
    feed(session);
    feed(conn(0, 'Marc', 'A'));
    feed(lap(0, 300_000)); // salida de boxes: la primera vuelta tras conectar no cuenta como mejor vuelta
    feed(lap(0, 80_000));
    feed({ kind: 'connectionClosed', driverName: 'Marc', guid: 'A', carId: 0, carModel: 'mx5', carSkin: 'x' });
    feed(conn(0, 'Marc el Veloz', 'A'));
    feed(lap(0, 300_000)); // al reconectar vuelve a haber salida de boxes
    feed(lap(0, 79_000));
    const rec = repo.records('ks_vallelunga', 'club', ['mx5']);
    expect(rec.entries).toHaveLength(1);
    expect(rec.entries[0]).toMatchObject({ driverName: 'Marc el Veloz', lapMs: 79_000 });
  });

  it('si el servidor desaparece sin avisar, limpia pilotos y sesión', () => {
    const { tracker, feed, setClock, repo } = setup();
    setClock(1000);
    feed(session);
    feed(conn(0, 'Marc', 'A'));
    expect(tracker.status().online).toHaveLength(1);
    setClock(30_000);
    tracker.tick();
    expect(tracker.status()).toMatchObject({ acConnected: false, session: null, online: [] });
    expect(repo.combos()).toEqual([]);
    setClock(31_000);
    feed(session); // el servidor vuelve
    feed(conn(0, 'Marc', 'A'));
    expect(tracker.status()).toMatchObject({ acConnected: true, online: [{ name: 'Marc' }] });
  });

  it('pregunta por la sesión cada pocos segundos para no dar por caído a un servidor vacío', () => {
    const { tracker, sent, setClock } = setup();
    setClock(10_000);
    tracker.tick();
    expect(sent.filter((c) => c.kind === 'getSessionInfo')).toHaveLength(1);
    setClock(12_000);
    tracker.tick();
    expect(sent.filter((c) => c.kind === 'getSessionInfo')).toHaveLength(1); // aún no toca
    setClock(15_500);
    tracker.tick();
    expect(sent.filter((c) => c.kind === 'getSessionInfo')).toHaveLength(2);
  });

  it('sync pide sesión y coches; el estado conectado caduca sin paquetes', () => {
    const { tracker, sent, feed, setClock } = setup();
    tracker.sync();
    expect(sent.filter((c) => c.kind === 'getCarInfo')).toHaveLength(32);
    setClock(1000);
    feed({ kind: 'version', version: 4 });
    expect(tracker.status().acConnected).toBe(true);
    setClock(30_000);
    expect(tracker.status().acConnected).toBe(false);
  });
});

import { parseSections, sectorBoundaries } from './track-sectors';

describe('sectores del circuito', () => {
  it('lee las fronteras de un sections.ini de AC', () => {
    const ini = '[SECTION_0]\nIN=0.0\nOUT=0.28\n[SECTION_1]\nIN=0.28\nOUT=0.61\n[SECTION_2]\nIN=0.61\nOUT=1.0\n';
    expect(parseSections(ini)).toEqual([0.28, 0.61]);
    expect(parseSections('[SECTION_0]\nIN=0\nOUT=1\n')).toBeNull(); // un solo sector: sin fronteras
    expect(parseSections('[SECTION_0]\nIN=0\n[SECTION_1]\nIN=0.5\n')).toEqual([0.5]);
  });
  it('prioriza ajuste manual y cae en tercios', () => {
    expect(sectorBoundaries('x', '', { trackDirs: [], overrides: { x: [0.6, 0.2] } })).toMatchObject({ bounds: [0.2, 0.6], source: 'config' });
    expect(sectorBoundaries('x', '', { trackDirs: [], overrides: {} }).source).toBe('tercios');
    expect(sectorBoundaries('x', '', { trackDirs: [], overrides: { x: 5 } }).bounds).toEqual([0.2, 0.4, 0.6, 0.8]);
  });
});

describe('sectores variables', () => {
  it('mide 5 sectores y los guarda por circuito', () => {
    const timer = new SectorTimer([0.2, 0.4, 0.6, 0.8]);
    drive(timer, 100_000, 2, 0);
    expect(timer.takeLap(100_000)).toBeNull();
    const s = timer.takeLap(100_000)!;
    expect(s).toHaveLength(5);
    for (const x of s) expect(Math.abs(x - 20_000)).toBeLessThan(10);
  });
});

import { projectOnSpline, type Spline } from './track-geometry';

describe('geometría del circuito', () => {
  // Cuadrado de 100 m de lado recorrido a 10 m por punto.
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) pts.push([i * 10, 0]);
  for (let i = 0; i < 10; i++) pts.push([100, i * 10]);
  for (let i = 0; i < 10; i++) pts.push([100 - i * 10, 100]);
  for (let i = 0; i < 10; i++) pts.push([0, 100 - i * 10]);
  const dist = pts.map((_, i) => i * 10);
  const spline: Spline = { x: pts.map((p) => p[0]), z: pts.map((p) => p[1]), dist, total: 400 };
  it('proyecta puntos sobre la spline', () => {
    expect(projectOnSpline(spline, 55, 3).fraction).toBeCloseTo(0.1375, 3);
    expect(projectOnSpline(spline, 103, 150 - 100).fraction).toBeCloseTo(0.25 + 0.5 * 0.25 - 0.125 + 0.125, 1);
  });
  it('un origen distinto de cero no cambia las medidas', () => {
    const t = new SectorTimer([0.5], 0.25);
    let time = 0;
    // El coche pasa por spline 0.25 (su meta) cada 100 s; a mitad de vuelta cruza 0.75.
    for (let lap = 0; lap < 3; lap++) for (let k = 0; k < 1000; k++, time += 100) t.update((0.25 + (k / 1000)) % 1, time);
    t.update(0.25, time);
    t.takeLap(100_000);
    const s = t.takeLap(100_000);
    expect(s).not.toBeNull();
    expect(Math.abs(s![0]! - 50_000)).toBeLessThan(150);
  });
});
