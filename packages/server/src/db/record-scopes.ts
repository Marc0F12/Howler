import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, any>;

/** Qué récords bate una vuelta, en tres niveles. Cada `*Prev` es el mejor tiempo válido anterior (null = no había nada que batir). */
export interface LapRecordScopes {
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  /** Mejor vuelta de la sesión (todos los coches). */
  session: { beaten: boolean; prevMs: number | null; prevDriver: string | null };
  /** Récord de esa combinación circuito + coche. */
  combo: { beaten: boolean; prevMs: number | null; prevDriver: string | null };
  /** Récord global del circuito, con cualquier coche. */
  global: { beaten: boolean; prevMs: number | null; prevDriver: string | null };
}

/** Consulta de «¿esta vuelta ha batido algún récord?». Solo mira vueltas válidas anteriores a la suya. */
export class RecordScopes {
  constructor(private db: DatabaseSync) {}

  forLap(lapId: number): LapRecordScopes | null {
    const lap = this.db.prepare('SELECT l.*, d.name AS driver_name FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.id = ?').get(lapId) as Row | undefined;
    if (!lap || !lap.valid || lap.hidden === 1) return null; // la vuelta de un piloto oculto no se anuncia
    const prev = (where: string, ...args: (string | number)[]) =>
      this.db.prepare(`SELECT l.lap_ms AS ms, d.name AS name FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.valid = 1 AND l.hidden = 0 AND l.id < ? AND ${where} ORDER BY l.lap_ms, l.id LIMIT 1`).get(lapId, ...args) as Row | undefined;
    const scope = (p: Row | undefined) => ({ beaten: p != null && lap.lap_ms < p.ms, prevMs: (p?.ms as number | undefined) ?? null, prevDriver: (p?.name as string | undefined) ?? null });
    return {
      driverName: lap.driver_name, track: lap.track, layout: lap.layout, car: lap.car, lapMs: lap.lap_ms,
      session: scope(prev('l.session_id = ?', lap.session_id)),
      combo: scope(prev('l.track = ? AND l.layout = ? AND l.car = ?', lap.track, lap.layout, lap.car)),
      global: scope(prev('l.track = ? AND l.layout = ?', lap.track, lap.layout)),
    };
  }
}
