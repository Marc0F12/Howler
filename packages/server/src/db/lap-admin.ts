import type { DatabaseSync } from 'node:sqlite';
import type { AdminLapDto } from '@howler/shared';

type Row = Record<string, any>;

/** Una vuelta con lo necesario para volver a juzgarla con otras reglas. */
export interface LapForRevalidation {
  id: number;
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  cuts: number;
  valid: boolean;
  reason: string | null;
  override: 'valid' | 'void' | null;
  incidents: { kind: 'car' | 'env'; speed: number; relSpeed: number | null }[];
  outLap: boolean;
  pending: boolean;
}

/** Acceso a datos para gestionar la validez de las vueltas: recálculo con reglas nuevas y decisiones manuales. */
export class LapAdmin {
  constructor(private db: DatabaseSync) {}

  /** La siguiente tanda de vueltas (id mayor que `afterId`), con sus choques. Se lee por tandas para no cargar todo el historial. */
  batch(afterId: number, limit: number): LapForRevalidation[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, d.name AS driver_name, l.track, l.layout, l.car, l.lap_ms, l.cuts, l.valid, l.invalid_reason, l.override, l.out_lap, l.pending
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.origin IS NULL AND l.id > ? ORDER BY l.id LIMIT ?`,
      )
      .all(afterId, limit) as Row[];
    return this.withIncidents(rows);
  }

  /** Una vuelta PROPIA (las copias de otro Howler son de solo lectura: solo su dueño decide sobre ellas). */
  get(id: number): LapForRevalidation | null {
    const r = this.db
      .prepare(
        `SELECT l.id, d.name AS driver_name, l.track, l.layout, l.car, l.lap_ms, l.cuts, l.valid, l.invalid_reason, l.override, l.out_lap, l.pending
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.id = ? AND l.origin IS NULL`,
      )
      .get(id) as Row | undefined;
    return r ? this.withIncidents([r])[0]! : null;
  }

  /** Ejecuta `fn` en una sola transacción (todo o nada, y mucho más rápido que un guardado por vuelta). */
  inTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private withIncidents(rows: Row[]): LapForRevalidation[] {
    const byLap = new Map<number, { kind: 'car' | 'env'; speed: number; relSpeed: number | null }[]>();
    for (let i = 0; i < rows.length; i += 500) {
      const ids = rows.slice(i, i + 500).map((r) => r.id);
      const inc = this.db
        .prepare(`SELECT lap_id, kind, speed, rel_speed FROM lap_incidents WHERE lap_id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids) as Row[];
      for (const x of inc) (byLap.get(x.lap_id) ?? byLap.set(x.lap_id, []).get(x.lap_id)!).push({ kind: x.kind, speed: x.speed, relSpeed: x.rel_speed ?? null });
    }
    return rows.map((r) => ({
      id: r.id, driverName: r.driver_name, track: r.track, layout: r.layout, car: r.car, lapMs: r.lap_ms, cuts: r.cuts,
      valid: r.valid === 1, reason: r.invalid_reason ?? null, override: (r.override as 'valid' | 'void' | null) ?? null,
      incidents: byLap.get(r.id) ?? [], outLap: r.out_lap === 1, pending: r.pending === 1,
    }));
  }

  setValidity(id: number, valid: boolean, reason: string | null, pending = false) {
    this.db.prepare('UPDATE laps SET valid = ?, invalid_reason = ?, pending = ? WHERE id = ?').run(valid ? 1 : 0, reason, pending ? 1 : 0, id);
  }

  /** Decisión manual: `valid`, `void` o null (volver a las reglas). El recálculo de reglas no toca las vueltas con decisión manual. */
  setOverride(id: number, override: 'valid' | 'void' | null, note: string | null) {
    this.db.prepare('UPDATE laps SET override = ?, override_note = ? WHERE id = ?').run(override, note, id);
  }

  /** Las últimas vueltas, para revisarlas y anularlas o restaurarlas a mano. Con `pendingOnly`, solo las pendientes de revisión. */
  recent(limit: number, pendingOnly = false): AdminLapDto[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, d.name AS driver_name, l.track, l.layout, l.car, l.lap_ms, l.valid, l.invalid_reason, l.cuts, l.override, l.out_lap, l.pending, l.created_at,
                (SELECT COUNT(*) FROM lap_incidents i WHERE i.lap_id = l.id) AS collisions
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.origin IS NULL ${pendingOnly ? 'AND l.pending = 1' : ''} ORDER BY l.id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id, driverName: r.driver_name, track: r.track, layout: r.layout, car: r.car, lapMs: r.lap_ms, valid: r.valid === 1,
      reason: r.invalid_reason ?? null, cuts: r.cuts, collisions: r.collisions, outLap: r.out_lap === 1, pending: r.pending === 1, override: (r.override as 'valid' | 'void' | null) ?? null, at: r.created_at,
    }));
  }
}
