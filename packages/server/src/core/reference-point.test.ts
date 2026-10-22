import { describe, expect, it } from 'vitest';
import type { Command, ServerEvent } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { Bus } from './bus';
import type { CrossLine } from './sector-timer';
import { Tracker } from './tracker';

// Circuito circular de radio 200 m recorrido a 40 m/s. Meta en el ángulo 0 y una división a media vuelta.
const R = 200;
const V = 40;
const LAP_MS = Math.round(((2 * Math.PI * R) / V) * 1000);
const lineAt = (f: number): CrossLine => {
  const a = 2 * Math.PI * f, c = Math.cos(a), s = Math.sin(a);
  return { ax: (R - 8) * c, az: (R - 8) * s, bx: (R + 8) * c, bz: (R + 8) * s, fraction: f };
};

/** Conduce 3 vueltas con paquetes cada ~100 ms y devuelve los sectores de la última vuelta guardada. */
function sectorsWithOffset(offset: number) {
  const repo = new Repository(openDatabase(':memory:'));
  let clock = 0;
  const tracker = new Tracker({
    repo, bus: new Bus(), send: (_: Command) => {}, now: () => clock, positionIntervalMs: 100,
    referenceOffsetM: offset, sectorsFor: () => ({ bounds: [0.5], origin: 0, lines: [lineAt(0), lineAt(0.5)] }),
  });
  const feed = (e: ServerEvent) => tracker.handle(e);
  feed({ kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1, serverName: 's', track: 't', trackConfig: '', name: 'P', type: 1, durationMin: 0, laps: 0, waitTime: 0, ambientTemp: 0, roadTemp: 0, weather: '', elapsedMs: 0 });
  feed({ kind: 'newConnection', driverName: 'M', guid: 'A', carId: 0, carModel: 'c', carSkin: 's' });
  let lapsDone = 0;
  for (let t = 37; t <= LAP_MS * 3 + 500; t += 100) {
    clock = t;
    const f = (((t - 37) / LAP_MS) % 1);
    const a = 2 * Math.PI * f;
    feed({
      kind: 'carUpdate', carId: 0, gear: 3, rpm: 1, splinePos: f,
      pos: { x: R * Math.cos(a), y: 0, z: R * Math.sin(a) },
      velocity: { x: -V * Math.sin(a), y: 0, z: V * Math.cos(a) },
    });
    if (Math.floor((t - 37) / LAP_MS) > lapsDone) {
      lapsDone++;
      feed({ kind: 'lapCompleted', carId: 0, lapMs: LAP_MS, cuts: 0, leaderboard: [], grip: 1 });
    }
  }
  return repo.recentLaps(5).find((l) => l.sectorsMs.length === 2)?.sectorsMs;
}

describe('punto de medida adelantado', () => {
  it('sin offset, media vuelta a velocidad constante dura media vuelta', () => {
    const s = sectorsWithOffset(0);
    expect(s).toBeDefined();
    expect(Math.abs(s![0]! - LAP_MS / 2)).toBeLessThan(10);
  });
  it('un offset constante no altera los sectores a velocidad constante', () => {
    expect(Math.abs(sectorsWithOffset(1)![0]! - sectorsWithOffset(0)![0]!)).toBeLessThan(10);
  });
});
