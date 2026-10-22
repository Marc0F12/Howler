import { describe, expect, it } from 'vitest';
import { SectorTimer, type CrossLine } from './sector-timer';

// Circuito circular de radio 200 m; meta en el ángulo 0 y divisiones al 30 % y 70 % de la vuelta.
const R = 200;
const lineAt = (f: number): CrossLine => {
  const a = 2 * Math.PI * f;
  const c = Math.cos(a), s = Math.sin(a);
  return { ax: (R - 8) * c, az: (R - 8) * s, bx: (R + 8) * c, bz: (R + 8) * s, fraction: f };
};
const posAt = (f: number) => ({ x: R * Math.cos(2 * Math.PI * f), z: R * Math.sin(2 * Math.PI * f) });

describe('cruce geométrico de líneas', () => {
  it('mide los sectores exactos aunque los paquetes lleguen cada 100 ms', () => {
    const lapMs = 90_000;
    const timer = new SectorTimer([0.3, 0.7], 0, [lineAt(0), lineAt(0.3), lineAt(0.7)]);
    // Fase de 37 ms respecto a la rejilla de paquetes para que ningún cruce coincida con un paquete.
    for (let t = 37; t <= lapMs * 2 + 1000; t += 100) {
      const f = ((t - 37) / lapMs) % 1;
      timer.update(f, t, posAt(f));
    }
    expect(timer.takeLap(lapMs)).toBeNull(); // primera vuelta: salida no vista
    const s = timer.takeLap(lapMs)!;
    expect(s).toHaveLength(3);
    expect(Math.abs(s[0]! - 27_000)).toBeLessThan(5);
    expect(Math.abs(s[1]! - 36_000)).toBeLessThan(5);
    expect(s[0]! + s[1]! + s[2]!).toBe(lapMs);
  });

  it('ignora un teletransporte a boxes', () => {
    const timer = new SectorTimer([0.3], 0, [lineAt(0), lineAt(0.3)]);
    timer.update(0.1, 0, posAt(0.1));
    timer.update(0.12, 100, posAt(0.12));
    timer.update(0.6, 200, posAt(0.6)); // salto de cientos de metros
    timer.update(0.99, 300, posAt(0.99));
    timer.update(0.01, 400, posAt(0.01));
    expect(timer.takeLap(90_000)).toBeNull();
  });

  it('una división solo cuenta si se cruza en orden', () => {
    const timer = new SectorTimer([0.3, 0.7], 0, [lineAt(0), lineAt(0.3), lineAt(0.7)]);
    // Empieza en 0.6 (salto de boxes sin ver la meta): cruza la división 2 sin haber cruzado la 1.
    let t = 0;
    for (let f = 0.6; f < 1; f += 0.005) timer.update(f, (t += 100), posAt(f));
    timer.update(0.001, (t += 100), posAt(0.001));
    expect(timer.takeLap(90_000)).toBeNull();
  });
});
