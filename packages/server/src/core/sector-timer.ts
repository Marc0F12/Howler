/**
 * Calcula tiempos de sector de cada coche. El protocolo de AC no los trae, así que se detectan:
 *  - Modo geométrico (preferido): se mide el cruce real de las líneas de cronometraje del circuito
 *    con la posición X/Z del coche, interpolando entre dos paquetes. Es lo que hace el propio juego.
 *  - Modo spline (respaldo, sin líneas): cruce de fronteras sobre la posición normalizada (0..1).
 * El tiempo de vuelta oficial es siempre el del servidor; el último sector es lo que sobra.
 */

interface LapMarks {
  start: number | null;
  crossings: (number | null)[];
  end: number | null;
}

/** Línea de cronometraje en el plano X/Z, con su fracción de vuelta. */
export interface CrossLine {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  fraction: number;
}

export interface Pos2 {
  x: number;
  z: number;
}

const MAX_PENDING = 3;
/** Tolerancia entre la vuelta medida por nosotros y la que informa el servidor. */
const LAP_MATCH_TOLERANCE_MS = 1500;
/** Un salto mayor entre dos paquetes (a ~10/s) es un teletransporte, no conducción. */
const TELEPORT_M = 120;
/** Una línea solo cuenta si el coche está a esta fracción de vuelta de ella (evita falsos cruces donde el trazado se cruza). */
const LINE_GATE = 0.08;

/** Instante relativo (0..1] en que el segmento p0→p1 cruza la línea, o null. Tolera un 10 % de margen en los extremos. */
function crossing(p0: Pos2, p1: Pos2, l: CrossLine): number | null {
  const rx = p1.x - p0.x, rz = p1.z - p0.z;
  const sx = l.bx - l.ax, sz = l.bz - l.az;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qx = l.ax - p0.x, qz = l.az - p0.z;
  const t = (qx * sz - qz * sx) / denom;
  const u = (qx * rz - qz * rx) / denom;
  return t > 0 && t <= 1 && u >= -0.1 && u <= 1.1 ? t : null;
}

const wrap01 = (v: number) => ((v % 1) + 1) % 1;

export class SectorTimer {
  private prev: { p: number; t: number } | null = null;
  private prevPos: Pos2 | null = null;
  private prevSpline = 0;
  private cur: LapMarks;
  private pending: LapMarks[] = [];
  /** Vueltas ya consumidas por adelantado (LAP_COMPLETED llegó antes de ver el cruce de meta). */
  private skipWraps = 0;

  /**
   * boundaries: fronteras entre sectores medidas desde la línea de meta, p.ej. [1/3, 2/3] para 3 sectores.
   * origin: posición en spline de la línea de meta (0 si coincide con el inicio de la spline).
   * lines: líneas reales del circuito, [0] = meta; si se dan, se usa el modo geométrico.
   */
  constructor(
    private boundaries: number[] = [1 / 3, 2 / 3],
    private origin = 0,
    private lines: CrossLine[] | null = null,
    /** Diagnóstico (solo con HOWLER_DEBUG): por qué se descarta una vuelta. */
    private debug?: (msg: string) => void,
  ) {
    this.cur = this.blank(null);
  }

  private blank(start: number | null): LapMarks {
    return { start, crossings: this.boundaries.map(() => null), end: null };
  }

  reset() {
    this.prev = null;
    this.prevPos = null;
    this.cur = this.blank(null);
    this.pending = [];
    this.skipWraps = 0;
  }

  /** spline = posición normalizada, t = instante (ms) de la medida, pos = posición X/Z del coche. */
  update(spline: number, t: number, pos?: Pos2) {
    if (this.lines && pos) return this.updateGeometric(spline, t, pos);
    this.updateSpline(spline, t);
  }

  private finishLap(at: number) {
    this.cur.end = at;
    if (this.skipWraps > 0) this.skipWraps--;
    else {
      this.pending.push(this.cur);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
    }
    this.cur = this.blank(at);
  }

  private updateGeometric(spline: number, t: number, pos: Pos2) {
    const prevT = this.prev?.t ?? 0;
    const prevPos = this.prevPos;
    const prevSpline = this.prevSpline;
    this.prev = { p: spline, t };
    this.prevPos = pos;
    this.prevSpline = spline;
    if (!prevPos || t <= prevT) return;

    if (Math.hypot(pos.x - prevPos.x, pos.z - prevPos.z) > TELEPORT_M) {
      this.cur = this.blank(null);
      return;
    }
    if (wrap01(spline - prevSpline) >= 0.5) return; // marcha atrás

    const hits: { k: number; u: number }[] = [];
    this.lines!.forEach((l, k) => {
      if (Math.abs(wrap01(spline - l.fraction + 0.5) - 0.5) > LINE_GATE) return;
      const u = crossing(prevPos, pos, l);
      if (u != null) hits.push({ k, u });
    });
    hits.sort((a, b) => a.u - b.u);

    for (const { k, u } of hits) {
      const at = prevT + u * (t - prevT);
      if (k === 0) this.finishLap(at);
      else if (
        this.cur.start != null &&
        this.cur.crossings[k - 1] == null &&
        this.cur.crossings.slice(0, k - 1).every((c) => c != null) // las divisiones solo cuentan en orden
      ) {
        this.cur.crossings[k - 1] = at;
      }
    }
  }

  private updateSpline(spline: number, t: number) {
    const p = wrap01(spline - this.origin);
    let prev = this.prev;
    this.prev = { p, t };
    if (!prev || t <= prev.t) return;

    const dp = p - prev.p;
    const forward = (dp + 1) % 1;
    if (dp < 0 && forward < 0.5) {
      // Cruce de la línea de meta.
      this.finishLap(prev.t + ((1 - prev.p) / (1 - prev.p + p)) * (t - prev.t));
      prev = { p: 0, t: this.cur.start! };
    } else if (dp > 0.5) {
      // Salto (teletransporte a boxes, marcha atrás por la meta...): la vuelta en curso no es medible.
      this.cur = this.blank(null);
      return;
    } else if (dp < 0) {
      return; // retroceso pequeño: se ignora
    }

    for (let i = 0; i < this.boundaries.length; i++) {
      const b = this.boundaries[i]!;
      if (this.cur.crossings[i] == null && prev.p < b && b <= p) {
        this.cur.crossings[i] = prev.t + ((b - prev.p) / (p - prev.p)) * (t - prev.t);
      }
    }
  }

  /** Llamar al recibir LAP_COMPLETED. Devuelve los sectores en ms, o null si no se pudieron medir. */
  takeLap(lapMs: number): number[] | null {
    let marks = this.pending.shift();
    if (!marks) {
      // El paquete de vuelta llegó antes que la actualización que cruza la meta.
      marks = this.cur;
      this.cur = this.blank(null);
      this.skipWraps++;
    }
    return this.sectorsOf(marks, lapMs);
  }

  private sectorsOf(m: LapMarks, lapMs: number): number[] | null {
    if (m.start == null) return this.fail('no se vio la salida de la vuelta');
    if (m.crossings.some((c) => c == null)) return this.fail(`faltan cruces de línea: ${JSON.stringify(m.crossings.map((c) => c != null))}`);
    if (m.end != null && Math.abs(m.end - m.start - lapMs) > LAP_MATCH_TOLERANCE_MS) {
      return this.fail(`la vuelta medida (${Math.round(m.end - m.start)} ms) no cuadra con la del servidor (${lapMs} ms)`);
    }
    const out: number[] = [];
    let last = m.start;
    for (const c of m.crossings as number[]) {
      out.push(Math.round(c - last));
      last = c;
    }
    const sum = out.reduce((a, b) => a + b, 0);
    out.push(lapMs - sum);
    return out.every((s) => s > 0) ? out : this.fail(`sector no positivo: ${JSON.stringify(out)}`);
  }

  private fail(reason: string): null {
    this.debug?.(reason);
    return null;
  }
}
