import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { Bus } from './bus';
import { parsePluginMessage } from './exact-sectors';
import { calibrateYaw, computeSlip, decodeTrace, decodeWheelSpeed, encodeTrace, TraceRecorder, type Telemetry } from './lap-trace';
import { Tracker } from './tracker';

const msg = (o: Record<string, unknown>) => Buffer.from(JSON.stringify({ v: 1, ...o }));

describe('mensaje de telemetría del plugin', () => {
  const ok = { t: 'tel', car: 2, guid: '7656', gas: 255, steer: 127, brk: 1, yaw: 1.5708 };
  it('se lee con todos sus campos', () => {
    expect(parsePluginMessage(msg(ok))).toEqual({ t: 'tel', car: 2, guid: '7656', gas: 255, steer: 127, brk: 1, yaw: 1.5708 });
  });
  it('rechaza valores fuera de rango o mal tipados', () => {
    for (const bad of [{ gas: 256 }, { gas: -1 }, { steer: 300 }, { brk: 2 }, { brk: '1' }, { yaw: 'x' }, { yaw: null }, { guid: 5 }, { car: -1 }]) {
      expect(parsePluginMessage(msg({ ...ok, ...bad }))).toBeNull();
    }
  });
  it('los mensajes de antes (splits y vueltas) siguen leyéndose igual', () => {
    expect(parsePluginMessage(msg({ t: 'lap', car: 0, guid: 'g', ms: 99_000, cuts: 0 }))).toEqual({ t: 'lap', car: 0, guid: 'g', ms: 99_000, cuts: 0 });
  });
});

/** Un coche que da vueltas a un círculo de 100 m de radio con muestras cada 100 ms, con telemetría opcional. */
function drive(rec: TraceRecorder, from: number, to: number, lapMs: number, telOf?: (t: number, heading: number) => Telemetry | null) {
  const speed = (2 * Math.PI * 100) / (lapMs / 1000);
  for (let t = from; t < to; t += 100) {
    const a = ((t % lapMs) / lapMs) * 2 * Math.PI;
    const heading = Math.atan2(Math.cos(a), -Math.sin(a)); // dirección de (vx, vz) = (-sin a, cos a)
    rec.push(t, 100 * Math.cos(a), 100 * Math.sin(a), -Math.sin(a) * speed, Math.cos(a) * speed, 3, 6000, telOf ? telOf(t, heading) : null);
  }
}

describe('calibrateYaw: el juego manda el giro en una convención desconocida', () => {
  const heading = (i: number) => (i / 40) * 2 * Math.PI - Math.PI;
  /** Muestras rápidas cuyo giro es sign·heading + offset (la convención del juego, al revés de lo que se busca). */
  const sampleSet = (sign: number, offset: number, noise = 0) =>
    Array.from({ length: 40 }, (_, i) => ({ heading: heading(i), yaw: (heading(i) - offset) / sign + noise * Math.sin(i), kmh: 150 }));

  it.each([[1, 0], [1, Math.PI / 2], [1, Math.PI], [1, -Math.PI / 2], [-1, 0], [-1, Math.PI / 2], [-1, Math.PI], [-1, -Math.PI / 2]])(
    'reconoce la convención signo %i, desfase %f',
    (sign, offset) => {
      const f = calibrateYaw(sampleSet(sign, offset))!;
      expect(f).not.toBeNull();
      for (const s of sampleSet(sign, offset)) {
        const d = Math.abs(((f(s.yaw) - s.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        expect(d).toBeLessThan(1e-6);
      }
    },
  );

  it('tolera un poco de derrape (ruido) pero no se fía de datos que no encajan con ninguna convención', () => {
    expect(calibrateYaw(sampleSet(1, 0, 0.2))).not.toBeNull();
    const random = Array.from({ length: 40 }, (_, i) => ({ heading: heading(i), yaw: Math.sin(i * 7.3) * 3, kmh: 150 }));
    expect(calibrateYaw(random)).toBeNull();
  });

  it('sin muestras rápidas suficientes no calibra (parado o en boxes)', () => {
    expect(calibrateYaw(sampleSet(1, 0).map((s) => ({ ...s, kmh: 10 })))).toBeNull();
    expect(calibrateYaw(sampleSet(1, 0).slice(0, 5))).toBeNull();
  });
});

describe('traza con acelerador, freno y volante', () => {
  const lapMs = 12_000;
  const tel = (t: number, h: number): Telemetry => ({ gas: (t % 2_000) / 2_000, brake: t % 4_000 < 500 ? 1 : 0, steer: Math.sin(t / 1_000), yaw: h + 0.4 });

  it('una vuelta con plugin guarda los canales y corrige el rumbo con el giro real del coche', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, lapMs, lapMs, tel);
    rec.cut(lapMs, lapMs);
    drive(rec, lapMs, 2 * lapMs, lapMs, tel);
    const s = rec.cut(2 * lapMs, lapMs).trace!.samples;
    expect(s.gas).toHaveLength(s.t.length);
    expect(s.brake!.some((b) => b === 1)).toBe(true);
    // el giro del juego iba desplazado 0,4 rad respecto a la velocidad: tras calibrar, el rumbo es el del morro (yaw con su convención)
    const a0 = 0;
    const velHeading = Math.atan2(Math.cos(a0), -Math.sin(a0));
    expect(s.h[0]).toBeCloseTo(velHeading + 0.4, 1);
  });

  it('los canales sobreviven al empaquetado y las trazas antiguas (sin canales) se siguen leyendo', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, lapMs, lapMs, tel);
    rec.cut(lapMs, lapMs);
    drive(rec, lapMs, 2 * lapMs, lapMs, tel);
    const withTel = rec.cut(2 * lapMs, lapMs).trace!.samples;
    const back = decodeTrace(encodeTrace(withTel));
    back.gas!.forEach((v, i) => expect(v).toBeCloseTo(withTel.gas![i]!, 2));
    back.steer!.forEach((v, i) => expect(v).toBeCloseTo(withTel.steer![i]!, 1));
    expect(back.brake).toEqual(withTel.brake!.map((b) => Math.round(b * 255) / 255));

    const { gas, brake, steer, ...plain } = withTel;
    void gas; void brake; void steer;
    const old = decodeTrace(encodeTrace(plain));
    expect(old.gas).toBeUndefined();
    expect(old.t).toEqual(plain.t);
  });

  it('sin plugin no hay canales (y el rumbo es el de la velocidad); con el plugin solo la mitad de la vuelta se rellena hacia atrás', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, lapMs, lapMs);
    rec.cut(lapMs, lapMs);
    drive(rec, lapMs, 2 * lapMs, lapMs);
    expect(rec.cut(2 * lapMs, lapMs).trace!.samples.gas).toBeUndefined();

    const partial = new TraceRecorder();
    drive(partial, 0, lapMs, lapMs);
    partial.cut(lapMs, lapMs);
    drive(partial, lapMs, 2 * lapMs, lapMs, (t, h) => (t >= lapMs + lapMs * 0.3 ? tel(t, h) : null)); // el plugin llega al 30 % de la vuelta
    const s = partial.cut(2 * lapMs, lapMs).trace!.samples;
    expect(s.gas).toHaveLength(s.t.length); // 70 % con datos: se mantienen y se rellenan los primeros
  });
});

describe('Tracker: la telemetría del plugin llega a la traza guardada', () => {
  it('mensaje del plugin → canales en la traza de la mejor vuelta', () => {
    const repo = new Repository(openDatabase(':memory:'));
    let clock = 1_000;
    const tracker = new Tracker({ repo, bus: new Bus(), send: () => undefined, now: () => clock, positionIntervalMs: 100 });
    const feed = (e: ServerEvent) => tracker.handle(e);
    feed({ kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1, serverName: 'S', track: 'monza', trackConfig: '', name: 'P', type: 1, durationMin: 0, laps: 0, waitTime: 0, ambientTemp: 20, roadTemp: 25, weather: 'clear', elapsedMs: 0 });
    feed({ kind: 'newConnection', driverName: 'Ana', guid: 'A', carId: 0, carModel: 'mx5', carSkin: 'x' });
    const lap = (ms: number) => feed({ kind: 'lapCompleted', carId: 0, lapMs: ms, cuts: 0, grip: 1, leaderboard: [] });
    const run = (lapMs: number, withTel: boolean) => {
      for (let t = 0; t < lapMs; t += 100) {
        clock += 100;
        const a = (t / lapMs) * 2 * Math.PI;
        const speed = (2 * Math.PI * 100) / (lapMs / 1000);
        if (withTel) tracker.handlePlugin({ t: 'tel', car: 0, guid: 'A', gas: 200, steer: 127 + Math.round(60 * Math.sin(a)), brk: t < 1_000 ? 1 : 0, yaw: Math.atan2(Math.cos(a), -Math.sin(a)) });
        feed({ kind: 'carUpdate', carId: 0, pos: { x: 100 * Math.cos(a), y: 0, z: 100 * Math.sin(a) }, velocity: { x: -Math.sin(a) * speed, y: 0, z: Math.cos(a) * speed }, gear: 3, rpm: 5000, splinePos: a / (2 * Math.PI) });
      }
      lap(lapMs);
    };
    run(8_000, true); // salida de boxes: no se graba
    run(8_000, true);
    const best = repo.bestLapsWithTraces('monza', '', [{ driverId: 1, car: 'mx5' }])[0]!;
    const trace = decodeTrace(best.data!);
    expect(trace.gas!.every((g) => Math.abs(g - 200 / 255) < 0.01)).toBe(true);
    expect(trace.brake![0]).toBe(1);
    expect(trace.brake!.at(-1)).toBe(0);
    expect(Math.max(...trace.steer!)).toBeGreaterThan(0.3);
  });

  it('un mensaje de un coche que ya es de otro piloto (guid distinto) se ignora', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const tracker = new Tracker({ repo, bus: new Bus(), send: () => undefined, now: () => 1, positionIntervalMs: 100 });
    tracker.handle({ kind: 'newConnection', driverName: 'Ana', guid: 'A', carId: 0, carModel: 'mx5', carSkin: 'x' });
    expect(() => tracker.handlePlugin({ t: 'tel', car: 0, guid: 'OTRO', gas: 1, steer: 1, brk: 0, yaw: 0 })).not.toThrow();
    expect(() => tracker.handlePlugin({ t: 'tel', car: 9, guid: 'A', gas: 1, steer: 1, brk: 0, yaw: 0 })).not.toThrow();
  });
});

describe('velocidad de las ruedas y patinazo', () => {
  const enc = (w: number) => Math.round(Math.log10(w + 1) * 20) + 100;
  it('el mensaje admite las 4 ruedas (opcional) y rechaza lo mal formado', () => {
    const ok = { t: 'tel', car: 1, guid: 'g', gas: 10, steer: 127, brk: 0, yaw: 0 };
    expect(parsePluginMessage(msg({ ...ok, tyre: [120, 121, 122, 123] }))).toMatchObject({ tyre: [120, 121, 122, 123] });
    expect(parsePluginMessage(msg(ok))).not.toHaveProperty('tyre');
    expect(parsePluginMessage(msg({ ...ok, tyre: [1, 2, 3] })) && (parsePluginMessage(msg({ ...ok, tyre: [1, 2, 3] })) as { tyre?: number[] }).tyre).toBeUndefined();
    expect((parsePluginMessage(msg({ ...ok, tyre: [1, 2, 3, 999] })) as { tyre?: number[] }).tyre).toBeUndefined();
  });
  it('deshace la escala logarítmica del juego', () => {
    expect(decodeWheelSpeed(100)).toBeCloseTo(0, 6);
    for (const w of [5, 40, 120]) expect(Math.abs(decodeWheelSpeed(enc(w)) / w - 1)).toBeLessThan(0.14); // resolución de la escala: ~12 % por escalón
  });
  it('detecta bloqueo (negativo) y rueda girando de más (positivo), y 0 rodando libre', () => {
    const n = 60;
    const kmh = Array.from({ length: n }, () => 108); // 30 m/s
    const gas = Array.from({ length: n }, () => 0.5);
    const brake = Array.from({ length: n }, () => 0);
    const free = 30 / 0.3; // radio 0,3 m → 100 rad/s
    const wheels = Array.from({ length: n }, (_, i) => (i === 20 ? [free * 0.3, free, free, free] : i === 40 ? [free, free, free * 1.4, free] : [free, free, free, free]));
    const slip = computeSlip(kmh, gas, brake, wheels);
    expect(slip[5]).toBeCloseTo(0, 2);
    expect(slip[20]).toBeCloseTo(-0.7, 2);
    expect(slip[40]).toBeCloseTo(0.4, 2);
  });
  it('sin datos suficientes o a poca velocidad no inventa nada', () => {
    expect(computeSlip([100, 100], [0, 0], [0, 0], [[50, 50, 50, 50], [50, 50, 50, 50]])).toEqual([0, 0]);
  });
  it('el formato v3 guarda y recupera el patinazo, y las trazas antiguas se siguen leyendo', () => {
    const base = { t: [0, 100], x: [0, 1], z: [0, 1], h: [0, 0.1], v: [100, 101], gear: [3, 3], rpm: [6000, 6100] };
    const withSlip = decodeTrace(encodeTrace({ ...base, gas: [1, 1], brake: [0, 0], steer: [0, 0.1], slip: [-0.5, 0.25] }));
    expect(withSlip.slip![0]).toBeCloseTo(-0.5, 1);
    expect(withSlip.slip![1]).toBeCloseTo(0.25, 1);
    const old = decodeTrace(encodeTrace({ ...base, gas: [1, 1], brake: [0, 0], steer: [0, 0.1] }));
    expect(old.slip).toBeUndefined();
    expect(old.steer![1]).toBeCloseTo(0.1, 1);
  });
});
