import { describe, expect, it } from 'vitest';
import { decodeTrace, encodeTrace, TraceRecorder } from './lap-trace';

/** Un coche que da vueltas a un círculo de radio 100 m a velocidad constante, con muestras cada 100 ms. */
function drive(rec: TraceRecorder, fromMs: number, toMs: number, lapMs: number) {
  const speed = (2 * Math.PI * 100) / (lapMs / 1000); // m/s
  for (let t = fromMs; t < toMs; t += 100) {
    const a = ((t % lapMs) / lapMs) * 2 * Math.PI;
    rec.push(t, 100 * Math.cos(a), 100 * Math.sin(a), -Math.sin(a) * speed, Math.cos(a) * speed, 3, 6000);
  }
}

describe('TraceRecorder', () => {
  it('no graba la primera vuelta (no se vio la salida) y sí las siguientes', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 30_000, 30_000);
    expect(rec.cut(30_000, 30_000).trace).toBeNull();
    drive(rec, 30_000, 60_000, 30_000);
    const lap = rec.cut(60_000, 30_000).trace!;
    expect(lap.samples.t.length).toBe(300);
    expect(lap.samples.t[0]).toBe(0);
    expect(lap.samples.t.at(-1)).toBeLessThanOrEqual(30_000);
  });

  it('un coche parado durante horas no acumula muestras sin fin', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 30_000, 30_000);
    rec.cut(30_000, 30_000);
    for (let t = 30_000; t < 30_000 + 3_000_000; t += 100) rec.push(t, 0, 0, 0, 0, 1, 1000); // ~50 min quieto
    expect((rec as unknown as { buf: unknown[] }).buf.length).toBeLessThan(14_401);
    expect(rec.cut(3_030_000, 3_000_000).trace).toBeNull();
  });

  it('el rumbo sigue la dirección de la velocidad y la velocidad máxima sale en km/h', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 20_000, 20_000);
    rec.cut(20_000, 20_000);
    drive(rec, 20_000, 40_000, 20_000);
    const lap = rec.cut(40_000, 20_000).trace!;
    // En la primera muestra el coche está en (100, 0) yendo hacia +z: rumbo = atan2(vz, vx) ≈ π/2
    expect(lap.samples.h[0]).toBeCloseTo(Math.PI / 2, 2);
    expect(lap.maxSpeedKmh).toBeCloseTo(((2 * Math.PI * 100) / 20) * 3.6, 1);
  });

  it('reescala el tiempo para que la vuelta dure exactamente lo oficial', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    rec.cut(10_000, 10_000);
    drive(rec, 10_000, 20_000, 10_000);
    const lap = rec.cut(20_100, 10_000).trace!; // el aviso llegó 100 ms tarde: la grabación dura 10.100 ms
    expect(lap.samples.t.at(-1)!).toBeLessThanOrEqual(10_000);
    expect(lap.samples.t.at(-1)!).toBeGreaterThan(9_800);
  });

  it('descarta la traza si la grabación no cuadra con el tiempo oficial (reset, boxes)', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    rec.cut(10_000, 10_000);
    drive(rec, 10_000, 40_000, 10_000);
    expect(rec.cut(40_000, 10_000).trace).toBeNull();
  });

  it('reset olvida lo grabado y exige volver a cruzar la meta', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    rec.cut(10_000, 10_000);
    drive(rec, 10_000, 15_000, 10_000);
    rec.reset();
    drive(rec, 15_000, 25_000, 10_000);
    expect(rec.cut(25_000, 10_000).trace).toBeNull();
  });
});

describe('salida de boxes (vuelta que no empieza en la meta)', () => {
  it('la primera vuelta tras conectar es una salida de boxes; las siguientes no', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    expect(rec.cut(10_000, 10_000).outLap).toBe(true);
    drive(rec, 10_000, 20_000, 10_000);
    expect(rec.cut(20_000, 10_000)).toMatchObject({ outLap: false, trace: expect.anything() });
  });

  it('un teletransporte durante la vuelta (volver a boxes) la marca como salida de boxes y no guarda su traza', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    rec.cut(10_000, 10_000);
    drive(rec, 10_000, 14_000, 10_000);
    rec.push(14_100, 5_000, 5_000, 0, 0, 1, 900); // aparece a 5 km de donde estaba: reinicio en boxes
    drive(rec, 14_200, 20_000, 10_000);
    const r = rec.cut(20_000, 10_000);
    expect(r.outLap).toBe(true);
    expect(r.trace).toBeNull();
    // la vuelta siguiente vuelve a ser normal
    drive(rec, 20_000, 30_000, 10_000);
    expect(rec.cut(30_000, 10_000).outLap).toBe(false);
  });

  it('tras reset (cambio de sesión) la siguiente vuelta también es una salida', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 10_000, 10_000);
    rec.cut(10_000, 10_000);
    drive(rec, 10_000, 15_000, 10_000);
    rec.reset();
    drive(rec, 15_000, 25_000, 10_000);
    expect(rec.cut(25_000, 10_000).outLap).toBe(true);
  });
});

describe('encodeTrace / decodeTrace', () => {
  it('ida y vuelta sin pérdida visible, y comprimido pesa poco', () => {
    const rec = new TraceRecorder();
    drive(rec, 0, 90_000, 90_000);
    rec.cut(90_000, 90_000);
    drive(rec, 90_000, 180_000, 90_000);
    const lap = rec.cut(180_000, 90_000).trace!;
    const bin = encodeTrace(lap.samples);
    const back = decodeTrace(bin);
    expect(back.t).toEqual(lap.samples.t);
    expect(back.gear).toEqual(lap.samples.gear);
    expect(back.rpm).toEqual(lap.samples.rpm);
    back.x.forEach((v, i) => expect(v).toBeCloseTo(lap.samples.x[i]!, 3));
    back.h.forEach((v, i) => expect(Math.abs(Math.sin((v - lap.samples.h[i]!) / 2))).toBeLessThan(0.001)); // +π y −π son el mismo ángulo
    back.v.forEach((v, i) => expect(v).toBeCloseTo(lap.samples.v[i]!, 1));
    expect(bin.length).toBeLessThan(900 * 19); // una vuelta de 90 s: menos de lo que ocuparía sin comprimir
  });
});
