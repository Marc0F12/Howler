import type { DatabaseSync } from 'node:sqlite';
import { DriverAdmin } from './driver-admin';
import type { LapAids, SessionConditions } from '@howler/shared';

type Row = Record<string, any>;

const aidsJson = (a: LapAids | null) => (a && Object.keys(a).length ? JSON.stringify(a) : null);

export interface ImportedLap {
  driverId: number;
  car: string;
  lapMs: number;
  cuts: number;
  grip: number | null;
  valid: boolean;
  invalidReason: string | null;
  pending: boolean;
  outLap: boolean;
  maxSpeedKmh: number | null;
  createdAt: string;
  tempAir: number | null;
  tempTrack: number | null;
  aids: LapAids | null;
  incidents: { kind: 'car' | 'env'; speed: number }[];
}

export interface ImportedSession {
  track: string;
  layout: string;
  name: string;
  type: number;
  startedAt: string;
  endedAt: string | null;
  conditions?: SessionConditions | null;
}

/** SQL de las importaciones: el registro de lo ya importado y la escritura de sesiones enteras de golpe. */
export class Imports {
  constructor(private db: DatabaseSync) {}

  /** Id local de lo que ya se importó con esa clave, o null. */
  find(source: string, kind: string, key: string): number | null {
    const r = this.db.prepare('SELECT local_id FROM imports WHERE source = ? AND kind = ? AND source_key = ?').get(source, kind, key) as Row | undefined;
    return r ? r.local_id : null;
  }

  mark(source: string, kind: string, key: string, localId: number) {
    this.db.prepare('INSERT OR REPLACE INTO imports (source, kind, source_key, local_id, imported_at) VALUES (?, ?, ?, ?, ?)').run(source, kind, key, localId, new Date().toISOString());
  }

  /** Id del piloto con ese identificador interno, o null. */
  driverBySteam(steamId: string): number | null {
    const r = this.db.prepare('SELECT id FROM drivers WHERE steam_id = ?').get(steamId) as Row | undefined;
    return r ? r.id : null;
  }

  /** Todos los pilotos con su nombre, para proponer a quién enlazar al importar. */
  allDrivers(): { id: number; name: string }[] {
    return (this.db.prepare('SELECT id, name FROM drivers ORDER BY name').all() as Row[]).map((r) => ({ id: r.id, name: r.name }));
  }

  /** Circuitos y layouts que ya hay en la base de datos. */
  knownTracks(): { track: string; layout: string }[] {
    return (this.db.prepare('SELECT DISTINCT track, layout FROM sessions').all() as Row[]).map((r) => ({ track: r.track, layout: r.layout }));
  }

  /**
   * Completa las temperaturas y ayudas de vueltas de una sesión ya importada antes de que se guardaran (misma sesión, piloto, tiempo y fecha).
   * Solo rellena lo que falta; devuelve cuántas vueltas cambió.
   */
  enrichLaps(sessionId: number, laps: { driverId: number; lapMs: number; createdAt: string; tempAir: number | null; tempTrack: number | null; aids: LapAids | null }[]): number {
    const upd = this.db.prepare(
      `UPDATE laps SET temp_air = COALESCE(temp_air, ?), temp_track = COALESCE(temp_track, ?), aids = COALESCE(aids, ?)
       WHERE session_id = ? AND driver_id = ? AND lap_ms = ? AND created_at = ? AND source = 'import'
         AND ((temp_air IS NULL AND ? IS NOT NULL) OR (temp_track IS NULL AND ? IS NOT NULL) OR (aids IS NULL AND ? IS NOT NULL))`,
    );
    let n = 0;
    this.db.exec('BEGIN');
    try {
      for (const l of laps) {
        const a = aidsJson(l.aids);
        n += Number(upd.run(l.tempAir, l.tempTrack, a, sessionId, l.driverId, l.lapMs, l.createdAt, l.tempAir, l.tempTrack, a).changes);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  /** Anota las condiciones de una sesión ya importada si no tenía ninguna. Devuelve si cambió algo. */
  setConditionsIfMissing(sessionId: number, c: SessionConditions): boolean {
    const r = this.db.prepare(
      `UPDATE sessions SET fuel_pct = ?, damage_pct = ?, tyre_wear_pct = ?, tyres_out = ?
       WHERE id = ? AND fuel_pct IS NULL AND damage_pct IS NULL AND tyre_wear_pct IS NULL AND tyres_out IS NULL`,
    ).run(c.fuelPct, c.damagePct, c.tyreWearPct, c.tyresOut, sessionId);
    return Number(r.changes) > 0;
  }

  driverExists(id: number): boolean {
    return this.db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(id) != null;
  }

  /** Pilotos creados por una importación (aún sin Steam real), con sus vueltas, para poder unirlos a un piloto de verdad. */
  importedDrivers(): { id: number; name: string; laps: number }[] {
    return (this.db.prepare(
      `SELECT d.id, d.name, (SELECT COUNT(*) FROM laps l WHERE l.driver_id = d.id) AS laps FROM drivers d WHERE d.steam_id LIKE 'stracker:%' ORDER BY d.name`,
    ).all() as Row[]).map((r) => ({ id: r.id, name: r.name, laps: r.laps }));
  }

  /**
   * Pasa todo lo de un piloto importado (`fromId`) a otro (`intoId`) y borra el primero: vueltas, choques con él, inscripciones
   * y ajustes de campeonatos. Solo se puede unir un piloto creado por una importación, para no mezclar pilotos reales por error.
   */
  mergeDriver(fromId: number, intoId: number): void {
    if (fromId === intoId) throw new Error('Elige otro piloto: no se puede unir con él mismo.');
    const from = this.db.prepare('SELECT steam_id FROM drivers WHERE id = ?').get(fromId) as Row | undefined;
    if (!from || !String(from.steam_id).startsWith('stracker:')) throw new Error('Solo se pueden unir pilotos creados por una importación.');
    // La unión la hace el gestor de pilotos (mueve también penalizaciones, deja alias y recalcula lo oculto): una sola implementación.
    new DriverAdmin(this.db).merge(fromId, intoId);
  }

  /** Circuito, layout y fecha de una sesión (para crear carreras de campeonato a partir de ella). */
  sessionInfo(id: number): { track: string; layout: string; startedAt: string } | null {
    const r = this.db.prepare('SELECT track, layout, started_at FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? { track: r.track, layout: r.layout, startedAt: r.started_at } : null;
  }

  /** Pilotos con vueltas en alguna de estas sesiones. */
  driversIn(sessionIds: number[]): number[] {
    if (sessionIds.length === 0) return [];
    const marks = sessionIds.map(() => '?').join(',');
    return (this.db.prepare(`SELECT DISTINCT driver_id FROM laps WHERE session_id IN (${marks})`).all(...sessionIds) as Row[]).map((r) => r.driver_id);
  }

  /** Crea una sesión con todas sus vueltas y la anota como importada, todo o nada. Devuelve el id de la sesión. */
  importSession(source: string, key: string, s: ImportedSession, laps: ImportedLap[]): number {
    this.db.exec('BEGIN');
    try {
      const sid = Number(this.db.prepare('INSERT INTO sessions (track, layout, name, type, started_at, ended_at, fuel_pct, damage_pct, tyre_wear_pct, tyres_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(s.track, s.layout, s.name, s.type, s.startedAt, s.endedAt, s.conditions?.fuelPct ?? null, s.conditions?.damagePct ?? null, s.conditions?.tyreWearPct ?? null, s.conditions?.tyresOut ?? null).lastInsertRowid);
      const insLap = this.db.prepare(
        `INSERT INTO laps (session_id, driver_id, track, layout, car, lap_ms, cuts, grip, valid, invalid_reason, created_at, sectors_exact, source, max_speed, out_lap, pending, temp_air, temp_track, aids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'import', ?, ?, ?, ?, ?, ?)`,
      );
      const insInc = this.db.prepare('INSERT INTO lap_incidents (lap_id, kind, speed, rel_speed, other_driver_id) VALUES (?, ?, ?, NULL, NULL)');
      for (const l of laps) {
        const id = Number(insLap.run(sid, l.driverId, s.track, s.layout, l.car, l.lapMs, l.cuts, l.grip, l.valid ? 1 : 0, l.invalidReason, l.createdAt, l.maxSpeedKmh, l.outLap ? 1 : 0, l.pending ? 1 : 0, l.tempAir, l.tempTrack, aidsJson(l.aids)).lastInsertRowid);
        for (const i of l.incidents) insInc.run(id, i.kind, i.speed);
      }
      this.mark(source, 'session', key, sid);
      this.db.exec('COMMIT');
      return sid;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
