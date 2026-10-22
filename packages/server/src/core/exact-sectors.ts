/**
 * Sectores exactos: los manda el plugin HowlerPlugin (dentro de AssettoServer) por UDP local, tal como los
 * midió el juego de cada piloto. Ver plugin/HowlerPlugin/HowlerForwarder.cs para el formato.
 */

export type PluginMessage =
  | { t: 'hello' }
  | { t: 'split'; car: number; guid: string; i: number; ms: number; cuts: number }
  | { t: 'lap'; car: number; guid: string; ms: number; cuts: number }
  /** Acelerador (0..255), volante (0..254, 127 = recto), luces de freno (0/1), giro del coche (rad) y, opcional, velocidad angular de las 4 ruedas (un byte por rueda en escala logarítmica). */
  | { t: 'tel'; car: number; guid: string; gas: number; steer: number; brk: 0 | 1; yaw: number; tyre?: number[] }
  /**
   * Telemetría extra del script de CSP que reparte el plugin (experimental, solo clientes con CSP): pedal de freno real (0..1), g en
   * ejes del coche (ax lateral, ay vertical, az longitudinal), avisos de ABS (bit 0) y control de tracción (bit 1) y, por rueda (FL FR RL RR),
   * deslizamiento, carga (N), presión (psi) y temperatura (°C).
   */
  | { t: 'ctel'; car: number; guid: string; brake: number; gas: number; ax: number; ay: number; az: number; flags: number; slip: number[]; load: number[]; pres: number[]; temp: number[] };

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Valida un datagrama del plugin; null si no es un mensaje válido de la versión 1. */
export function parsePluginMessage(buf: Buffer): PluginMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  if (!m || m.v !== 1) return null;
  if (m.t === 'hello') return { t: 'hello' };
  if (m.t === 'tel') {
    if (typeof m.guid !== 'string' || !int(m.car) || !int(m.gas) || m.gas > 255 || !int(m.steer) || m.steer > 255) return null;
    if ((m.brk !== 0 && m.brk !== 1) || typeof m.yaw !== 'number' || !Number.isFinite(m.yaw)) return null;
    const tyre = Array.isArray(m.tyre) && m.tyre.length === 4 && m.tyre.every((b) => int(b) && b <= 254) ? (m.tyre as number[]) : undefined;
    return { t: 'tel', car: m.car, guid: m.guid, gas: m.gas, steer: m.steer, brk: m.brk, yaw: m.yaw, ...(tyre ? { tyre } : {}) };
  }
  if (m.t === 'ctel') {
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const four = (v: unknown): v is number[] => Array.isArray(v) && v.length === 4 && v.every(num);
    if (typeof m.guid !== 'string' || !int(m.car) || !num(m.brake) || !num(m.gas) || !num(m.ax) || !num(m.ay) || !num(m.az) || !int(m.flags) || m.flags > 3) return null;
    if (!four(m.slip) || !four(m.load) || !four(m.pres) || !four(m.temp)) return null;
    const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    return { t: 'ctel', car: m.car, guid: m.guid, brake: clamp(m.brake, 0, 1), gas: clamp(m.gas, 0, 1), ax: m.ax, ay: m.ay, az: m.az, flags: m.flags, slip: m.slip, load: m.load, pres: m.pres, temp: m.temp };
  }
  if (typeof m.guid !== 'string' || !int(m.car) || !int(m.ms)) return null;
  const cuts = int(m.cuts) ? m.cuts : 0;
  if (m.t === 'split' && int(m.i)) return { t: 'split', car: m.car, guid: m.guid, i: m.i, ms: m.ms, cuts };
  if (m.t === 'lap') return { t: 'lap', car: m.car, guid: m.guid, ms: m.ms, cuts };
  return null;
}

/**
 * Convierte los splits recibidos (índice → tiempo) en la duración de cada sector, o null si no tienen sentido.
 * Acepta que el juego mande duraciones o tiempos acumulados, y que el último sector llegue o no
 * (si falta, es lo que sobra hasta el tiempo de vuelta).
 */
export function interpretSplits(splits: Map<number, number>, lapMs: number, sectorCount: number): number[] | null {
  const idx = [...splits.keys()].sort((a, b) => a - b);
  if (idx.length === 0 || idx.some((k, n) => k !== n)) return null; // debe ser 0,1,2... sin huecos
  const vals = idx.map((k) => splits.get(k)!);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const positive = (a: number[]) => a.every((x) => x > 0);

  if (vals.length === sectorCount) {
    if (sum(vals) === lapMs && positive(vals)) return vals; // duraciones de todos los sectores
    if (vals[vals.length - 1] === lapMs && vals.every((v, n) => n === 0 || v > vals[n - 1]!)) {
      const d = vals.map((v, n) => v - (vals[n - 1] ?? 0)); // acumulados
      return positive(d) ? d : null;
    }
    return null;
  }
  if (vals.length === sectorCount - 1) {
    const asDurations = [...vals, lapMs - sum(vals)];
    if (positive(asDurations)) return asDurations; // falta el último sector: es lo que sobra
  }
  return null;
}
