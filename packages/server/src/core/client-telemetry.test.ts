import { describe, expect, it } from 'vitest';
import { parsePluginMessage } from './exact-sectors';
import { decodeTrace, encodeTrace, realSlip, TraceRecorder, type ClientTel, type Telemetry } from './lap-trace';

const msg = (o: Record<string, unknown>) => Buffer.from(JSON.stringify({ v: 1, ...o }));

const ok = {
  t: 'ctel', car: 1, guid: '7656', brake: 0.42, gas: 0.1, ax: 0.5, ay: 0.02, az: -1.2, flags: 1,
  slip: [-0.1, -0.1, -0.05, -0.05], load: [3000, 3000, 4000, 4000], pres: [24, 24, 25, 25], temp: [80, 80, 82, 82],
};

describe('mensaje ctel del script de CSP', () => {
  it('se lee completo', () => {
    expect(parsePluginMessage(msg(ok))).toMatchObject({ t: 'ctel', car: 1, brake: 0.42, az: -1.2, flags: 1, temp: [80, 80, 82, 82] });
  });
  it('limita el pedal a 0..1 y rechaza lo mal formado', () => {
    expect(parsePluginMessage(msg({ ...ok, brake: 5 }))).toMatchObject({ brake: 1 });
    for (const bad of [{ guid: 5 }, { flags: 4 }, { flags: -1 }, { slip: [1, 2, 3] }, { temp: [1, 2, 3, 'x'] }, { az: null }, { car: -1 }, { pres: 'x' }]) {
      expect(parsePluginMessage(msg({ ...ok, ...bad }))).toBeNull();
    }
  });
});

describe('deslizamiento real', () => {
  it('toma la rueda que más desliza, limita a ±1 y por debajo de 20 km/h vale 0', () => {
    expect(realSlip([-0.05, -1, -0.2, 0.1], 100)).toBe(-1);
    expect(realSlip([0.1, 0.2, 3.5, 0.3], 100)).toBe(1);
    expect(realSlip([-0.5, -0.5, -0.5, -0.5], 10)).toBe(0);
    expect(realSlip([0.02, -0.03, 0, 0.01], 120)).toBeCloseTo(-0.03, 6);
  });
});

/** Un coche que da una vuelta rectilínea de 100 muestras (cada 100 ms) con telemetría del plugin y, opcionalmente, del cliente. */
function lap(rec: TraceRecorder, withClient: boolean, temp = 80) {
  rec.cut(0, 10_000); // arranca la grabación en meta
  const tel: Telemetry = { gas: 0.5, brake: 0, steer: 0, yaw: 0 };
  for (let i = 0; i < 100; i++) {
    const ct: ClientTel | null = withClient ? {
      brake: i > 50 ? 0.6 : 0, ax: 0.3, az: i > 50 ? -1.4 : 0.4, flags: i % 20 === 0 ? 1 : 2, slip: [i > 70 ? -1 : -0.05, -0.05, -0.04, -0.04],
      pres: [24, 24, 25, 25], temp: [temp + i / 10, temp + i / 10, temp + i / 10, temp + i / 10],
    } : null;
    rec.push(i * 100, i * 10, 0, 40, 0, 3, 6000, tel, ct);
  }
  return rec.cut(10_000, 10_000);
}

describe('traza con la telemetría del cliente', () => {
  it('guarda freno real, g, deslizamiento, ABS/TC y neumáticos y los recupera', () => {
    const r = lap(new TraceRecorder(), true);
    const s = r.trace!.samples;
    expect(s.brakeAnalog).toBe(true);
    expect(s.brake![70]).toBeCloseTo(0.6, 6);
    expect(s.slip![80]).toBe(-1);
    expect(s.slip![10]).toBeCloseTo(-0.05, 6);
    expect(s.lonG![70]).toBeCloseTo(-1.4, 6);
    const back = decodeTrace(encodeTrace(s));
    expect(back.brakeAnalog).toBe(true);
    expect(back.brake![70]).toBeCloseTo(0.6, 1);
    expect(back.slip![80]).toBeCloseTo(-1, 1);
    expect(back.latG![5]).toBeCloseTo(0.3, 1);
    expect(back.lonG![70]).toBeCloseTo(-1.4, 1);
    expect(back.abs![20]).toBe(1);
    expect(back.tc![5]).toBe(1);
    expect(back.temp).toHaveLength(4);
    expect(back.temp![0]![50]).toBeCloseTo(s.temp![0]![50]!, 1);
    expect(back.temp![3]![99]).toBeCloseTo(s.temp![3]![99]!, 1);
    expect(back.pres![0]![5]).toBeCloseTo(24, 1);
    expect(back.pres![2]![5]).toBeCloseTo(25, 1);
  });
  it('las temperaturas planas se guardan igual (un mod sin modelo térmico sale como línea plana)', () => {
    const rec = new TraceRecorder();
    rec.cut(0, 10_000);
    const tel: Telemetry = { gas: 0.5, brake: 0, steer: 0, yaw: 0 };
    for (let i = 0; i < 100; i++) rec.push(i * 100, i * 10, 0, 40, 0, 3, 6000, tel, { brake: 0, ax: 0, az: 0, flags: 0, slip: [0, 0, 0, 0], pres: [32.64, 32.64, 32.64, 32.64], temp: [80, 80, 80, 80] });
    const s = rec.cut(10_000, 10_000).trace!.samples;
    expect(s.temp!.every((w) => w.every((t) => t === 80))).toBe(true);
    expect(decodeTrace(encodeTrace(s)).pres![1]![0]).toBeCloseTo(32.64, 1);
  });
  it('sin el script del cliente no hay canales de cliente y el freno sigue siendo encendido/apagado', () => {
    const s = lap(new TraceRecorder(), false).trace!.samples;
    expect(s.brakeAnalog).toBeUndefined();
    expect(s.latG).toBeUndefined();
    expect(s.temp).toBeUndefined();
    const back = decodeTrace(encodeTrace(s));
    expect(back.gas).toBeDefined();
    expect(back.latG).toBeUndefined();
    expect(back.brakeAnalog).toBeUndefined();
  });
});
