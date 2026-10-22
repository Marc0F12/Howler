import type { TraceDto } from '@howler/shared';
import { indexAt } from './ghost-math';

/** Puntos en los que se compara (cada vuelta se reparte en tantos tramos iguales de distancia recorrida). */
export const COMPARE_POINTS = 400;

/** Una vuelta remuestreada por distancia: el mismo número de puntos para todas, para poder compararlas punto a punto. */
/** Agarre en %: 100 = las ruedas giran justo lo que avanza el coche (no derrapa); baja con un bloqueo o con patinazo. A partir del patinazo (-1..1). */
export const gripPct = (slip: number): number => Math.max(0, Math.min(100, 100 * (1 - Math.abs(slip))));

export interface ResampledLap {
  /** ms desde el inicio de la vuelta al pasar por cada punto (el primero es 0 y el último, el tiempo de vuelta). */
  t: number[];
  /** km/h */
  v: number[];
  /** Marcha (AC: 0 = marcha atrás, 1 = punto muerto, 2 = primera...) y rpm. */
  gear: number[];
  rpm: number[];
  x: number[];
  z: number[];
  /** Acelerador (0..1), freno (0..1) y volante (-1..1), si la vuelta se grabó con el plugin de Howler. */
  gas?: number[];
  brake?: number[];
  steer?: number[];
  /** Patinazo (-1..1), si el plugin mandó la velocidad de las ruedas o el jugador tiene CSP. */
  slip?: number[];
  /** Con CSP del jugador: freno real (0..1) en `brake`, fuerzas g, ABS/TC (0/1) y neumáticos (media de las 4: °C y psi). */
  brakeAnalog?: boolean;
  latG?: number[];
  lonG?: number[];
  abs?: number[];
  tc?: number[];
  /** Por rueda (FL, FR, RL, RR): temperatura (°C) y presión (psi). */
  temp?: number[][];
  pres?: number[][];
  /** Metros recorridos en la vuelta (según la trayectoria grabada). */
  lengthM: number;
}

/** Metros recorridos hasta cada muestra de la traza. */
export function cumulativeDistance(tr: TraceDto): number[] {
  const s = [0];
  for (let i = 1; i < tr.x.length; i++) s.push(s[i - 1]! + Math.hypot(tr.x[i]! - tr.x[i - 1]!, tr.z[i]! - tr.z[i - 1]!));
  return s;
}

/**
 * Remuestrea una vuelta por distancia normalizada (0 = línea de salida, 1 = línea de meta). Se compara por fracción de
 * vuelta y no por metros absolutos porque dos pilotos nunca recorren exactamente la misma distancia (otra trazada).
 * Se ancla el primer punto en t = 0 y el último en el tiempo oficial, así la diferencia final es exactamente la de los tiempos.
 */
export function resampleByDistance(tr: TraceDto, lapMs: number, n = COMPARE_POINTS): ResampledLap {
  const last = tr.t.length - 1;
  const cum = cumulativeDistance(tr);
  // Se añaden dos puntos de anclaje: salida (t = 0) y meta (t = tiempo oficial), con la posición de la primera y la última muestra.
  const s = [0, ...cum.map((d) => d + 0), cum[last]!];
  const t = [0, ...tr.t, lapMs];
  const v = [tr.v[0]!, ...tr.v, tr.v[last]!];
  const x = [tr.x[0]!, ...tr.x, tr.x[last]!];
  const z = [tr.z[0]!, ...tr.z, tr.z[last]!];
  const total = s.at(-1)! || 1;

  const ext = (a: number[]) => [a[0]!, ...a, a[last]!];
  const channels = { gas: tr.gas && ext(tr.gas), brake: tr.brake && ext(tr.brake), steer: tr.steer && ext(tr.steer), slip: tr.slip && ext(tr.slip),
    latG: tr.latG && ext(tr.latG), lonG: tr.lonG && ext(tr.lonG), abs: tr.abs && ext(tr.abs), tc: tr.tc && ext(tr.tc), temp: tr.temp && tr.temp.map(ext), pres: tr.pres && tr.pres.map(ext) };
  const gear = ext(tr.gear), rpm = ext(tr.rpm);
  const out: ResampledLap = { t: [], v: [], gear: [], rpm: [], x: [], z: [], lengthM: s.at(-1)! };
  if (channels.gas && channels.brake && channels.steer) { out.gas = []; out.brake = []; out.steer = []; if (channels.slip) out.slip = []; if (tr.brakeAnalog) out.brakeAnalog = true; }
  if (channels.latG && channels.lonG) { out.latG = []; out.lonG = []; }
  if (channels.abs && channels.tc) { out.abs = []; out.tc = []; }
  if (channels.temp) out.temp = [[], [], [], []];
  if (channels.pres) out.pres = [[], [], [], []];
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    const i = Math.min(Math.max(0, indexAt(s, d)), s.length - 2);
    const span = s[i + 1]! - s[i]!;
    const p = span > 0 ? Math.min(1, Math.max(0, (d - s[i]!) / span)) : 0;
    const mix = (a: number[]) => a[i]! + (a[i + 1]! - a[i]!) * p;
    out.t.push(mix(t));
    out.v.push(mix(v));
    out.gear.push(p < 0.5 ? gear[i]! : gear[i + 1]!); // la marcha no se interpola: es la más cercana
    out.rpm.push(mix(rpm));
    out.x.push(mix(x));
    out.z.push(mix(z));
    if (out.gas) { out.gas.push(mix(channels.gas!)); out.brake!.push(mix(channels.brake!)); out.steer!.push(mix(channels.steer!)); if (out.slip) out.slip.push(mix(channels.slip!)); }
    if (out.latG) { out.latG.push(mix(channels.latG!)); out.lonG!.push(mix(channels.lonG!)); }
    if (out.abs) { out.abs.push(mix(channels.abs!)); out.tc!.push(mix(channels.tc!)); }
    if (out.temp) channels.temp!.forEach((w, k) => out.temp![k]!.push(mix(w)));
    if (out.pres) channels.pres!.forEach((w, k) => out.pres![k]!.push(mix(w)));
  }
  // El primer punto es la salida (t = 0) y el último la meta (el tiempo oficial): así la diferencia entre vueltas empieza en 0 y termina en la real.
  out.t[0] = 0;
  out.t[n - 1] = lapMs;
  return out;
}

/** Media móvil centrada (ventana impar), para que las gráficas y el reparto por zonas no «parpadeen» con el ruido de 10 Hz. */
export function smooth(a: number[], window = 5): number[] {
  const h = Math.floor(window / 2);
  return a.map((_, i) => {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { sum += a[j]!; cnt++; }
    return sum / cnt;
  });
}

export interface Comparison {
  laps: ResampledLap[];
  /** Índice de la vuelta más rápida (la referencia de las diferencias). */
  ref: number;
  /** Diferencia de tiempo con la referencia en cada punto (ms): positivo = va por detrás de la referencia. */
  deltaMs: number[][];
  /** Velocidad suavizada (km/h) de cada vuelta en cada punto. */
  speed: number[][];
  /** Marcha de cada vuelta (R=0, N=1, 1.ª=2...) y rpm suavizadas. */
  gear: number[][];
  rpm: number[][];
  /** Índice de la vuelta más rápida (mayor velocidad) en cada punto: para colorear el mapa por zonas. */
  winner: number[];
  /** Acelerador, freno y volante de cada vuelta; solo si TODAS las vueltas comparadas los tienen. */
  gas?: number[][];
  brake?: number[][];
  steer?: number[][];
  /** Patinazo de cada vuelta; solo si todas lo tienen. */
  slip?: number[][];
  /** Solo si TODAS las vueltas vienen de jugadores con CSP: `brake` es el pedal real y hay fuerzas g, ABS/TC y neumáticos. */
  brakeAnalog?: boolean;
  latG?: number[][];
  lonG?: number[][];
  abs?: number[][];
  tc?: number[][];
  /** [vuelta][rueda][punto]: temperatura (°C) y presión (psi) de cada neumático (FL, FR, RL, RR). */
  temp?: number[][][];
  pres?: number[][][];
}

/** Compara 2 o 3 vueltas: diferencia de tiempo con la más rápida, velocidades y quién gana cada zona. */
export function compareLaps(inputs: { trace: TraceDto; lapMs: number }[], n = COMPARE_POINTS): Comparison {
  const laps = inputs.map((i) => resampleByDistance(i.trace, i.lapMs, n));
  const ref = inputs.reduce((best, cur, i) => (cur.lapMs < inputs[best]!.lapMs ? i : best), 0);
  const deltaMs = laps.map((l) => l.t.map((tt, k) => tt - laps[ref]!.t[k]!));
  // Las primeras muestras de cada vuelta no empiezan exactamente en la línea de salida y dibujarían un pico falso al principio: se enlazan con 0 de forma gradual.
  for (const d of deltaMs) {
    const a = Math.min(4, d.length - 1);
    for (let k = 0; k < a; k++) d[k] = d[a]! * (k / a);
  }
  const speed = laps.map((l) => smooth(l.v, 9));
  const winner = Array.from({ length: n }, (_, k) => speed.reduce((best, cur, i) => (cur[k]! > speed[best]![k]! ? i : best), 0));
  const all = laps.every((l) => l.gas && l.brake && l.steer);
  return {
    laps, ref, deltaMs, speed, winner, gear: laps.map((l) => l.gear), rpm: laps.map((l) => smooth(l.rpm, 5)),
    ...(all ? { gas: laps.map((l) => smooth(l.gas!, 5)), brake: laps.map((l) => l.brake!), steer: laps.map((l) => smooth(l.steer!, 5)) } : {}),
    ...(all && laps.every((l) => l.slip) ? { slip: laps.map((l) => smooth(l.slip!, 3)) } : {}),
    ...(all && laps.every((l) => l.brakeAnalog) ? { brakeAnalog: true } : {}),
    ...(laps.every((l) => l.latG && l.lonG) ? { latG: laps.map((l) => smooth(l.latG!, 3)), lonG: laps.map((l) => smooth(l.lonG!, 3)) } : {}),
    ...(laps.every((l) => l.abs && l.tc) ? { abs: laps.map((l) => l.abs!), tc: laps.map((l) => l.tc!) } : {}),
    ...(laps.every((l) => l.temp) ? { temp: laps.map((l) => l.temp!.map((w) => smooth(w, 5))) } : {}),
    ...(laps.every((l) => l.pres) ? { pres: laps.map((l) => l.pres!.map((w) => smooth(w, 5))) } : {}),
  };
}

/** Trozos consecutivos de puntos donde gana la misma vuelta (para pintar el mapa con pocos segmentos). */
export function winnerRuns(winner: number[]): { from: number; to: number; lap: number }[] {
  const runs: { from: number; to: number; lap: number }[] = [];
  winner.forEach((w, k) => {
    const cur = runs.at(-1);
    if (cur && cur.lap === w) cur.to = k;
    else runs.push({ from: k, to: k, lap: w });
  });
  return runs;
}

/** Estado de los pedales en cada punto: acelerando, rodando (ni acelerador ni freno) o frenando. */
export type DriveState = 'throttle' | 'coast' | 'brake';
export function driveStates(gas: number[], brake: number[]): DriveState[] {
  return gas.map((g, k) => (brake[k]! >= 0.5 ? 'brake' : g >= 0.08 ? 'throttle' : 'coast'));
}

/** Trozos consecutivos con el mismo estado de pedales (para dibujar la trazada con pocos segmentos). */
export function stateRuns(states: DriveState[]): { from: number; to: number; state: DriveState }[] {
  const runs: { from: number; to: number; state: DriveState }[] = [];
  states.forEach((s, k) => {
    const cur = runs.at(-1);
    if (cur && cur.state === s) cur.to = k;
    else runs.push({ from: k, to: k, state: s });
  });
  return runs;
}

const G = 9.80665;

/**
 * Aceleración APROXIMADA en g, estimada solo con posición y tiempo (el servidor no recibe los g reales):
 * lateral = velocidad × velocidad de giro de la trayectoria; longitudinal = cambio de velocidad en el tiempo.
 * Con ~10 muestras por segundo derivar amplifica el ruido, así que se suaviza mucho: sirve para comparar vueltas de
 * Howler entre sí, no para medir ni para compararlas con otros juegos. `lat` positivo = curva a la derecha.
 */
export function approxAcceleration(lap: Pick<ResampledLap, 't' | 'v' | 'x' | 'z'>): { lat: number[]; lon: number[] } {
  const n = lap.t.length;
  const x = smooth(lap.x, 5), z = smooth(lap.z, 5), v = smooth(lap.v, 9);
  const heading = (k: number) => {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    return Math.atan2(z[b]! - z[a]!, x[b]! - x[a]!);
  };
  const lat: number[] = [], lon: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
    const dt = (lap.t[b]! - lap.t[a]!) / 1000;
    if (dt <= 0) { lat.push(0); lon.push(0); continue; }
    let dh = heading(b) - heading(a);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    lat.push(((v[k]! / 3.6) * (dh / dt)) / G);
    lon.push((((v[b]! - v[a]!) / 3.6) / dt) / G);
  }
  return { lat: smooth(lat, 7), lon: smooth(lon, 7) };
}

/** Puntos de un tramo desplazados a un lado y a otro de la trazada (zigzag de las frenadas); `amp` en las mismas unidades que los puntos. */
export function zigzagPoints(pts: { px: number; py: number }[], amp: number): string {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)]!, b = pts[Math.min(pts.length - 1, k + 1)]!;
    const dx = b.px - a.px, dy = b.py - a.py, len = Math.hypot(dx, dy) || 1;
    const side = k % 2 ? 1 : -1;
    return `${(p.px + (-dy / len) * amp * side).toFixed(1)},${(p.py + (dx / len) * amp * side).toFixed(1)}`;
  }).join(' ');
}

/**
 * Índice de punto que ha alcanzado una vuelta al cabo de `ms` milisegundos de reproducción (el último punto cuyo tiempo no supera `ms`;
 * pasado el final de la vuelta se queda en el último). `t` son los tiempos de cada punto remuestreado y crecen siempre.
 */
export function indexAtTime(t: number[], ms: number): number {
  if (ms <= (t[0] ?? 0)) return 0;
  let lo = 0, hi = t.length - 1;
  if (ms >= t[hi]!) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= ms) lo = mid; else hi = mid;
  }
  return lo;
}
