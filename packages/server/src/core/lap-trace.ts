import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Traza de una vuelta: la posición, el rumbo y la velocidad del coche a lo largo de la vuelta (unas 10 muestras por
 * segundo, las que manda el servidor de AC). Sirve para reproducir la vuelta como un fantasma sobre el mapa.
 */
export interface TraceSamples {
  /** Milisegundos desde el inicio de la vuelta. */
  t: number[];
  x: number[];
  z: number[];
  /** Rumbo en radianes (dirección de la velocidad en el plano del mapa: atan2(vz, vx)). */
  h: number[];
  /** km/h. */
  v: number[];
  gear: number[];
  rpm: number[];
  /** Canales del plugin de Howler (si estaba activo): acelerador 0..1, freno 0/1 (luces de freno) y volante -1..1. */
  gas?: number[];
  brake?: number[];
  steer?: number[];
  /** Patinazo (-1..1): negativo = rueda bloqueada/frenando de más, positivo = rueda girando de más. Estimado con la velocidad de las ruedas. */
  slip?: number[];
  /** Con el script de CSP del cliente: el freno (`brake`) es el pedal real (0..1) y no solo las luces. */
  brakeAnalog?: boolean;
  /** Fuerzas g reales en ejes del coche (lateral: + = hacia la derecha del coche; longitudinal: + = acelera). */
  latG?: number[];
  lonG?: number[];
  /** 1 = ABS / control de tracción actuando. */
  abs?: number[];
  tc?: number[];
  /** Por rueda (FL, FR, RL, RR), cada una con su serie: temperatura (°C) y presión (psi), tal como las manda el juego (un mod sin modelo térmico las deja planas). */
  temp?: number[][];
  pres?: number[][];
}

/** Lo último que mandó el plugin de un coche: sirve para completar cada muestra de posición. */
export interface Telemetry {
  gas: number;
  brake: number;
  steer: number;
  /** Giro del coche en radianes, tal como lo manda el juego. */
  yaw: number;
  /** Velocidad angular de las 4 ruedas (FL, FR, RL, RR) en rad/s, si el plugin la mandó. */
  wheels?: number[];
}

/** Lo último que mandó el script de CSP de un cliente (ver exact-sectors.ts, mensaje `ctel`). */
export interface ClientTel {
  brake: number;
  /** g en ejes del coche: lateral y longitudinal. */
  ax: number;
  az: number;
  /** bit 0 = ABS actuando, bit 1 = control de tracción actuando. */
  flags: number;
  slip: number[];
  pres: number[];
  temp: number[];
}

export interface FinishedTrace {
  samples: TraceSamples;
  maxSpeedKmh: number;
}

/** Lo que resulta de cerrar una vuelta en el cruce de meta. */
export interface CutResult {
  /** La traza, o null si no se vio la vuelta entera o no cuadra con el tiempo oficial. */
  trace: FinishedTrace | null;
  /** La vuelta no empezó en la línea de meta (salida de boxes, reinicio o teletransporte a boxes): su tiempo no es el de una vuelta normal. */
  outLap: boolean;
}

/** Por debajo de esta velocidad (m/s) el rumbo de la velocidad no es fiable y se conserva el último. */
const MIN_HEADING_SPEED = 2;
/** Si la duración grabada y el tiempo oficial difieren más que esto (ms), la traza no es fiable (reset, boxes...). */
const MAX_DRIFT_MS = 2_000;
/** Un salto de posición mayor que esto (m) entre dos muestras seguidas es un teletransporte (volver a boxes, reiniciar). */
const TELEPORT_M = 150;
/** Una vuelta con menos muestras que esto no merece traza. */
const MIN_SAMPLES = 20;
/** Tope de muestras de una vuelta (20 minutos a ~12 Hz): más que eso es un coche parado, no una vuelta. */
const MAX_SAMPLES = 14_400;

interface Sample { t: number; x: number; z: number; h: number; v: number; gear: number; rpm: number; tel: Telemetry | null; ctel: ClientTel | null }

/**
 * Graba las muestras de un coche y las corta en cada cruce de meta. La primera vuelta tras conectar (o tras
 * `reset`) no se graba: no se vio la salida.
 */
export class TraceRecorder {
  private buf: Sample[] = [];
  private startAt: number | null = null;
  private lastHeading = 0;
  private last: { x: number; z: number } | null = null;
  /** Hubo un teletransporte durante la vuelta en curso. */
  private jumped = false;

  /** Olvida lo grabado y espera al siguiente cruce de meta. */
  reset() {
    this.buf = [];
    this.startAt = null;
    this.last = null;
    this.jumped = false;
  }

  push(now: number, x: number, z: number, vx: number, vz: number, gear: number, rpm: number, tel: Telemetry | null = null, ctel: ClientTel | null = null) {
    const speed = Math.hypot(vx, vz);
    if (speed > MIN_HEADING_SPEED) this.lastHeading = Math.atan2(vz, vx);
    if (this.last && Math.hypot(x - this.last.x, z - this.last.z) > TELEPORT_M) this.jumped = true;
    this.last = { x, z };
    if (this.startAt == null) return; // aún no se ha cruzado la meta: esta vuelta no se vio entera
    // Un coche parado en boxes durante horas no acumula muestras sin fin: pasada la vuelta más larga razonable, esa vuelta se descarta.
    if (this.buf.length >= MAX_SAMPLES) { this.buf = []; this.startAt = null; return; }
    this.buf.push({ t: now - this.startAt, x, z, h: this.lastHeading, v: speed * 3.6, gear, rpm, tel, ctel });
  }

  /**
   * Cierra la vuelta en el cruce de meta (`now`) con su tiempo oficial. La traza es null si no se vio entera, si hubo un
   * teletransporte o si la grabación no cuadra con el tiempo oficial. El tiempo de las muestras se reescala para que la
   * vuelta dure exactamente lo oficial: así, al reproducir varias a la vez, la más rápida llega antes.
   */
  cut(now: number, lapMs: number): CutResult {
    const buf = this.buf;
    const startedAt = this.startAt;
    const outLap = startedAt == null || this.jumped;
    this.buf = [];
    this.startAt = now;
    this.jumped = false;
    if (outLap || buf.length < MIN_SAMPLES) return { trace: null, outLap };
    const span = now - startedAt!;
    if (Math.abs(span - lapMs) > MAX_DRIFT_MS) return { trace: null, outLap };
    const k = lapMs / span;
    const samples: TraceSamples = {
      t: buf.map((s) => Math.min(lapMs, Math.round(s.t * k))),
      x: buf.map((s) => s.x),
      z: buf.map((s) => s.z),
      h: buf.map((s) => s.h),
      v: buf.map((s) => s.v),
      gear: buf.map((s) => s.gear),
      rpm: buf.map((s) => s.rpm),
    };
    // Con el plugin activo en la mayor parte de la vuelta: canales de acelerador/freno/volante y orientación real del coche.
    if (buf.filter((s) => s.tel).length >= buf.length / 2) {
      let last: Telemetry = buf.find((s) => s.tel)!.tel!;
      const tel = buf.map((s) => (last = s.tel ?? last));
      samples.gas = tel.map((t) => t.gas);
      samples.brake = tel.map((t) => t.brake);
      samples.steer = tel.map((t) => t.steer);
      if (tel.every((t) => t.wheels)) samples.slip = computeSlip(samples.v, samples.gas, samples.brake, tel.map((t) => t.wheels!));
      const toHeading = calibrateYaw(samples.h.map((h, i) => ({ heading: h, yaw: tel[i]!.yaw, kmh: samples.v[i]! })));
      if (toHeading) samples.h = tel.map((t) => wrapAngle(toHeading(t.yaw)));
    }
    // Con el script de CSP del cliente (si el jugador tiene CSP): pedal de freno real, g reales, deslizamiento real, ABS/TC y neumáticos.
    if (buf.filter((s) => s.ctel).length >= buf.length / 2) {
      let last: ClientTel = buf.find((s) => s.ctel)!.ctel!;
      const ct = buf.map((s) => (last = s.ctel ?? last));
      if (samples.brake) { samples.brake = ct.map((c) => c.brake); samples.brakeAnalog = true; }
      samples.latG = ct.map((c) => c.ax);
      samples.lonG = ct.map((c) => c.az);
      samples.abs = ct.map((c) => c.flags & 1);
      samples.tc = ct.map((c) => (c.flags >> 1) & 1);
      samples.slip = ct.map((c, i) => realSlip(c.slip, samples.v[i]!));
      // tal como llegan: si un mod no tiene modelo térmico, las líneas salen planas
      samples.temp = [0, 1, 2, 3].map((w) => ct.map((c) => c.temp[w]!));
      samples.pres = [0, 1, 2, 3].map((w) => ct.map((c) => c.pres[w]!));
    }
    return { outLap, trace: { samples, maxSpeedKmh: buf.reduce((m, s) => Math.max(m, s.v), 0) } };
  }
}

/**
 * Deslizamiento real de la rueda que más desliza (-1..1): negativo = bloqueada, positivo = girando de más. `slipRatio` se dispara a
 * baja velocidad (divide por una velocidad casi nula), así que por debajo de 20 km/h vale 0 y se limita a ±1.
 */
export function realSlip(slips: number[], kmh: number): number {
  if (kmh < 20) return 0;
  let worst = 0;
  for (const s of slips) if (Math.abs(s) > Math.abs(worst)) worst = s;
  return Math.max(-1, Math.min(1, worst));
}

/** Deshace la escala logarítmica con que el juego manda la velocidad angular de una rueda (un byte; 100 = parada). Devuelve rad/s. */
export function decodeWheelSpeed(b: number): number {
  const e = (b - 100) / 20;
  return e >= 0 ? 10 ** e - 1 : -(10 ** -e - 1);
}

/**
 * Patinazo estimado de cada muestra (-1..1): compara la velocidad de cada rueda con la que tendría rodando sin deslizar.
 * El radio de la rueda no se conoce, así que se estima con la propia vuelta: velocidad / velocidad angular media en los
 * tramos sin freno (mediana, robusta a los patinazos). Con el valor más alejado de 0 entre las 4 ruedas; negativo = bloqueo,
 * positivo = rueda girando de más. Es aproximado: en curva la rueda exterior gira más sin que haya patinazo, y por debajo
 * de 20 km/h no se estima (0). La velocidad de rueda llega con ~±6 % de error, así que el patinazo leve (< 10 %) se descarta.
 */
const SLIP_DEADBAND = 0.1;
export function computeSlip(kmh: number[], gas: number[], brake: number[], wheels: number[][]): number[] {
  const ms = kmh.map((v) => v / 3.6);
  const mean = (w: number[]) => (w[0]! + w[1]! + w[2]! + w[3]!) / 4;
  const ratios: number[] = [];
  const coast: number[] = [];
  for (let i = 0; i < ms.length; i++) {
    const w = mean(wheels[i]!);
    if (ms[i]! < 8 || w < 1 || brake[i]! > 0.5) continue;
    const r = ms[i]! / w;
    ratios.push(r);
    if (gas[i]! < 0.2) coast.push(r);
  }
  const pool = coast.length >= 10 ? coast : ratios;
  if (pool.length < 10) return ms.map(() => 0);
  pool.sort((a, b) => a - b);
  const radius = pool[pool.length >> 1]!;
  return ms.map((v, i) => {
    if (v < 20 / 3.6) return 0;
    let worst = 0;
    for (const w of wheels[i]!) {
      const s = (Math.max(0, w) * radius) / v - 1;
      if (Math.abs(s) > Math.abs(worst)) worst = s;
    }
    // La escala del juego solo da ~±6 % de precisión por rueda: por debajo de un 10 % es ruido, no patinazo.
    return Math.abs(worst) < SLIP_DEADBAND ? 0 : Math.max(-1, Math.min(1, worst));
  });
}

/** Lleva un ángulo al intervalo (-pi, pi]: es lo que cabe en el formato guardado. */
export const wrapAngle = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const angleDiff = (a: number, b: number) => Math.abs((((a - b + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);

/**
 * El juego manda el giro del coche («yaw»), pero no se sabe en qué convención (dónde está el cero y hacia qué lado crece).
 * Se calibra con los datos: se prueban las 8 convenciones posibles (signo y desfase) y se elige la que mejor coincide con la
 * dirección en que se mueve el coche cuando va rápido (el morro y la velocidad apuntan casi igual salvo en derrapes).
 * Devuelve la conversión yaw -> rumbo del mapa, o null si no hay datos suficientes o ninguna convención encaja.
 */
export function calibrateYaw(samples: { heading: number; yaw: number; kmh: number }[]): ((yaw: number) => number) | null {
  const moving = samples.filter((s) => s.kmh > 30);
  if (moving.length < 10) return null;
  let best: { f: (yaw: number) => number; err: number } | null = null;
  for (const sign of [1, -1]) {
    for (const offset of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = (yaw: number) => sign * yaw + offset;
      const err = moving.reduce((a, s) => a + angleDiff(f(s.yaw), s.heading), 0) / moving.length;
      if (!best || err < best.err) best = { f, err };
    }
  }
  return best && best.err < 0.6 ? best.f : null; // ~34 grados: más que eso no se fía de ninguna
}

const VERSION = 1;
/** Versión con canales de acelerador, freno y volante tras las columnas básicas. */
const VERSION_TELEMETRY = 2;
/** Como la 2, más el canal de patinazo. */
const VERSION_SLIP = 3;
/** Canales opcionales independientes, indicados por un byte de bits tras las columnas básicas. */
const VERSION_CHANNELS = 4;
const F_TEL = 1, F_SLIP = 2, F_G = 4, F_FLAGS = 8, F_TEMP = 16, F_PRES = 32, F_ANALOG = 64;

/** Empaqueta una traza: columnas binarias (tiempo, x, z, rumbo, velocidad, marcha, rpm) y los canales opcionales, comprimidas con deflate. */
export function encodeTrace(s: TraceSamples): Buffer {
  const n = s.t.length;
  const withTel = !!(s.gas && s.brake && s.steer);
  const withSlip = !!s.slip, withG = !!(s.latG && s.lonG), withFlags = !!(s.abs && s.tc), withTemp = !!s.temp, withPres = !!s.pres;
  const features = (withTel ? F_TEL : 0) | (withSlip ? F_SLIP : 0) | (withG ? F_G : 0) | (withFlags ? F_FLAGS : 0) | (withTemp ? F_TEMP : 0) | (withPres ? F_PRES : 0) | (s.brakeAnalog ? F_ANALOG : 0);
  const per = 4 + 4 + 4 + 2 + 2 + 1 + 2 + (withTel ? 3 : 0) + (withSlip ? 1 : 0) + (withG ? 2 : 0) + (withFlags ? 1 : 0) + (withTemp ? 8 : 0) + (withPres ? 8 : 0);
  const raw = Buffer.alloc(6 + n * per);
  let o = 0;
  raw.writeUInt8(VERSION_CHANNELS, o); o += 1;
  raw.writeUInt32LE(n, o); o += 4;
  for (let i = 0; i < n; i++, o += 4) raw.writeUInt32LE(s.t[i]!, o);
  for (let i = 0; i < n; i++, o += 4) raw.writeFloatLE(s.x[i]!, o);
  for (let i = 0; i < n; i++, o += 4) raw.writeFloatLE(s.z[i]!, o);
  for (let i = 0; i < n; i++, o += 2) raw.writeInt16LE(Math.round(wrapAngle(s.h[i]!) * 10_000), o); // ±π·10000 cabe en 16 bits
  for (let i = 0; i < n; i++, o += 2) raw.writeUInt16LE(Math.min(65_535, Math.round(s.v[i]! * 10)), o);
  for (let i = 0; i < n; i++, o += 1) raw.writeInt8(Math.max(-128, Math.min(127, s.gear[i]!)), o);
  for (let i = 0; i < n; i++, o += 2) raw.writeUInt16LE(Math.max(0, Math.min(65_535, Math.round(s.rpm[i]!))), o);
  raw.writeUInt8(features, o); o += 1;
  const i8 = (v: number, k: number) => Math.max(-127, Math.min(127, Math.round(v * k)));
  if (withTel) {
    for (let i = 0; i < n; i++, o += 1) raw.writeUInt8(Math.max(0, Math.min(255, Math.round(s.gas![i]! * 255))), o);
    for (let i = 0; i < n; i++, o += 1) raw.writeUInt8(Math.max(0, Math.min(255, Math.round(s.brake![i]! * 255))), o);
    for (let i = 0; i < n; i++, o += 1) raw.writeInt8(i8(s.steer![i]!, 127), o);
  }
  if (withSlip) for (let i = 0; i < n; i++, o += 1) raw.writeInt8(i8(s.slip![i]!, 127), o);
  if (withG) {
    for (let i = 0; i < n; i++, o += 1) raw.writeInt8(i8(s.latG![i]!, G_SCALE), o);
    for (let i = 0; i < n; i++, o += 1) raw.writeInt8(i8(s.lonG![i]!, G_SCALE), o);
  }
  if (withFlags) for (let i = 0; i < n; i++, o += 1) raw.writeUInt8((s.abs![i] ? 1 : 0) | (s.tc![i] ? 2 : 0), o);
  if (withTemp) for (let w = 0; w < 4; w++) for (let i = 0; i < n; i++, o += 2) raw.writeInt16LE(Math.max(-32_000, Math.min(32_000, Math.round(s.temp![w]![i]! * 10))), o);
  if (withPres) for (let w = 0; w < 4; w++) for (let i = 0; i < n; i++, o += 2) raw.writeUInt16LE(Math.max(0, Math.min(65_000, Math.round(s.pres![w]![i]! * 100))), o);
  return deflateSync(raw);
}

/** Una traza descomprimida real mide unos cientos de KB (10 muestras/s); más de esto no es una vuelta. */
export const MAX_RAW_TRACE = 6_000_000;

/** Las g se guardan en un byte con precisión de 1/30 g (hasta ±4,2 g). */
const G_SCALE = 30;

export function decodeTrace(data: Buffer): TraceSamples {
  const raw = inflateSync(data, { maxOutputLength: MAX_RAW_TRACE }); // tope: una traza que viene de otro Howler no puede ser una bomba de compresión
  const version = raw.readUInt8(0);
  if (version !== VERSION && version !== VERSION_TELEMETRY && version !== VERSION_SLIP && version !== VERSION_CHANNELS) throw new Error('Versión de traza desconocida');
  const n = raw.readUInt32LE(1);
  let o = 5;
  const col = <T>(size: number, read: (at: number) => T): T[] => {
    const out: T[] = [];
    for (let i = 0; i < n; i++, o += size) out.push(read(o));
    return out;
  };
  const out: TraceSamples = {
    t: col(4, (a) => raw.readUInt32LE(a)),
    x: col(4, (a) => raw.readFloatLE(a)),
    z: col(4, (a) => raw.readFloatLE(a)),
    h: col(2, (a) => raw.readInt16LE(a) / 10_000),
    v: col(2, (a) => raw.readUInt16LE(a) / 10),
    gear: col(1, (a) => raw.readInt8(a)),
    rpm: col(2, (a) => raw.readUInt16LE(a)),
  };
  if (version === VERSION_CHANNELS) {
    const f = raw.readUInt8(o); o += 1;
    if (f & F_TEL) {
      out.gas = col(1, (a) => raw.readUInt8(a) / 255);
      out.brake = col(1, (a) => raw.readUInt8(a) / 255);
      out.steer = col(1, (a) => raw.readInt8(a) / 127);
    }
    if (f & F_SLIP) out.slip = col(1, (a) => raw.readInt8(a) / 127);
    if (f & F_G) {
      out.latG = col(1, (a) => raw.readInt8(a) / G_SCALE);
      out.lonG = col(1, (a) => raw.readInt8(a) / G_SCALE);
    }
    if (f & F_FLAGS) {
      const flags = col(1, (a) => raw.readUInt8(a));
      out.abs = flags.map((x) => x & 1);
      out.tc = flags.map((x) => (x >> 1) & 1);
    }
    if (f & F_TEMP) out.temp = [0, 1, 2, 3].map(() => col(2, (a) => raw.readInt16LE(a) / 10));
    if (f & F_PRES) out.pres = [0, 1, 2, 3].map(() => col(2, (a) => raw.readUInt16LE(a) / 100));
    if (f & F_ANALOG) out.brakeAnalog = true;
    return out;
  }
  if (version === VERSION_TELEMETRY || version === VERSION_SLIP) {
    out.gas = col(1, (a) => raw.readUInt8(a) / 255);
    out.brake = col(1, (a) => raw.readUInt8(a) / 255);
    out.steer = col(1, (a) => raw.readInt8(a) / 127);
  }
  if (version === VERSION_SLIP) out.slip = col(1, (a) => raw.readInt8(a) / 127);
  return out;
}
