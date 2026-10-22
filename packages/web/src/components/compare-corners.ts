import type { compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;

/** Una curva detectada en la vuelta de referencia: índices de punto (entrada, punto más lento y salida). */
export interface Corner { n: number; i0: number; im: number; i1: number }

/**
 * Detecta las curvas como los mínimos de velocidad de la vuelta de referencia: un mínimo cuenta si la velocidad sube
 * claramente a ambos lados (prominencia de al menos 12 km/h o el 10 % del rango). La ventana de cada curva va desde que
 * se empieza a frenar hasta que se recupera el 70 % de la velocidad perdida. Es aproximado: con ~10 muestras por segundo
 * las chicanes rápidas pueden salir como una sola curva.
 */
export function detectCorners(speed: number[], lengthM: number): Corner[] {
  const n = speed.length;
  if (n < 10) return [];
  const lo = Math.min(...speed), hi = Math.max(...speed);
  const minProm = Math.max(12, (hi - lo) * 0.1);
  const w = Math.max(4, Math.round((n * 40) / Math.max(200, lengthM)));
  const found: { im: number; prom: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    let isMin = true;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (speed[j]! < speed[i]!) { isMin = false; break; }
    if (!isMin || speed[i - 1] === speed[i]) continue;
    let left = speed[i]!;
    for (let k = i - 1; k >= 0 && speed[k]! >= speed[i]!; k--) left = Math.max(left, speed[k]!);
    let right = speed[i]!;
    for (let k = i + 1; k < n && speed[k]! >= speed[i]!; k++) right = Math.max(right, speed[k]!);
    const prom = Math.min(left, right) - speed[i]!;
    if (prom >= minProm) found.push({ im: i, prom });
  }
  const corners: Corner[] = found.map((f, k) => {
    const target = speed[f.im]! + 0.7 * f.prom;
    let i0 = f.im; while (i0 > 0 && speed[i0]! < target) i0--;
    let i1 = f.im; while (i1 < n - 1 && speed[i1]! < target) i1++;
    return { n: k + 1, i0, im: f.im, i1 };
  });
  // Las ventanas no se pisan: en una chicane cada curva llega como mucho hasta el punto más lento de la vecina.
  corners.forEach((c, k) => {
    const prev = corners[k - 1], next = corners[k + 1];
    if (prev) c.i0 = Math.max(c.i0, prev.im + 1);
    if (next) c.i1 = Math.min(c.i1, next.im - 1);
  });
  return corners;
}

/** Lo que hizo cada vuelta en una curva. Los arrays van en el orden de las vueltas; la referencia es `cmp.ref`. */
export interface CornerStat {
  corner: Corner;
  /** km/h al entrar, en el punto más lento y al salir. */
  entry: number[];
  min: number[];
  exit: number[];
  /** Tiempo que pierde cada vuelta frente a la referencia dentro de la curva (ms; negativo = gana). 0 para la referencia. */
  loseMs: number[];
  /** Metros en que frena después (+) o antes (−) que la referencia; null si no hay datos de freno o alguna no frena en la curva. */
  brakeM: (number | null)[];
}

export function cornerStats(cmp: Comparison, corners: Corner[]): CornerStat[] {
  const n = cmp.speed[0]!.length;
  const lengthM = cmp.laps[cmp.ref]!.lengthM;
  const brakePoint = (lap: number, c: Corner): number | null => {
    const brake = cmp.brake?.[lap];
    if (!brake) return null;
    for (let k = Math.max(0, c.i0 - Math.round(n * 0.01)); k <= c.im; k++) if (brake[k]! >= 0.5) return (k / Math.max(1, n - 1)) * lengthM;
    return null;
  };
  return corners.map((c) => {
    const ref = brakePoint(cmp.ref, c);
    return {
      corner: c,
      entry: cmp.speed.map((s) => s[c.i0]!),
      min: cmp.speed.map((s) => Math.min(...s.slice(c.i0, c.i1 + 1))),
      exit: cmp.speed.map((s) => s[c.i1]!),
      loseMs: cmp.deltaMs.map((d) => d[c.i1]! - d[c.i0]!),
      brakeM: cmp.speed.map((_, i) => {
        if (i === cmp.ref || ref == null) return null;
        const bp = brakePoint(i, c);
        return bp == null ? null : bp - ref;
      }),
    };
  });
}

/** La curva donde más pierde (o más gana, con `gain`) la vuelta `lap` frente a la referencia, o null si no hay curvas. */
export function extremeCorner(stats: CornerStat[], lap: number, gain = false): CornerStat | null {
  if (stats.length === 0) return null;
  return stats.reduce((a, b) => ((gain ? b.loseMs[lap]! < a.loseMs[lap]! : b.loseMs[lap]! > a.loseMs[lap]!) ? b : a));
}
