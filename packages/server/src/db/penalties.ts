import type { DatabaseSync } from 'node:sqlite';
import type { PenaltyDto, PenaltyInput, PenaltyKind, PenaltySessionDto, RacePenaltyRules } from '@howler/shared';

type Row = Record<string, any>;

/** Lo que las penalizaciones manuales de una sesión suponen para cada piloto. */
export interface ManualEffect { ms: number; dsq: boolean; notes: string[] }

/** SQL de penalizaciones: avisos, tiempo añadido y descalificaciones puestos a mano; y el cálculo de las automáticas. */
export class Penalties {
  constructor(private db: DatabaseSync) {}

  add(p: Omit<PenaltyInput, 'announce'>): number {
    if (!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(p.sessionId)) throw new Error('Esa sesión no existe.');
    if (!this.db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(p.driverId)) throw new Error('Ese piloto no existe.');
    if (p.kind === 'time' && !(p.seconds != null && p.seconds > 0)) throw new Error('Indica cuántos segundos se añaden.');
    return Number(
      this.db.prepare('INSERT INTO penalties (session_id, driver_id, kind, seconds, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.sessionId, p.driverId, p.kind, p.kind === 'time' ? p.seconds! : null, p.reason, new Date().toISOString()).lastInsertRowid,
    );
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM penalties WHERE id = ?').run(id).changes > 0;
  }

  private dto(r: Row): PenaltyDto {
    return { id: r.id, sessionId: r.session_id, driverId: r.driver_id, driverName: r.name, kind: r.kind as PenaltyKind, seconds: r.seconds ?? null, reason: r.reason, createdAt: r.created_at };
  }

  forSession(sessionId: number): PenaltyDto[] {
    return (this.db.prepare('SELECT p.*, d.name FROM penalties p JOIN drivers d ON d.id = p.driver_id WHERE p.session_id = ? ORDER BY p.id').all(sessionId) as Row[]).map((r) => this.dto(r));
  }

  recent(limit: number): PenaltyDto[] {
    return (this.db.prepare('SELECT p.*, d.name FROM penalties p JOIN drivers d ON d.id = p.driver_id ORDER BY p.id DESC LIMIT ?').all(limit) as Row[]).map((r) => this.dto(r));
  }

  /** Efecto de las penalizaciones manuales de una sesión sobre cada piloto (los avisos no cambian nada, pero dejan su nota). */
  manualFor(sessionId: number): Map<number, ManualEffect> {
    const out = new Map<number, ManualEffect>();
    for (const p of this.forSession(sessionId)) {
      const e = out.get(p.driverId) ?? { ms: 0, dsq: false, notes: [] };
      if (p.kind === 'time') e.ms += Math.round((p.seconds ?? 0) * 1000);
      if (p.kind === 'dsq') e.dsq = true;
      if (p.kind !== 'warning' && p.reason) e.notes.push(p.reason);
      out.set(p.driverId, e);
    }
    return out;
  }

  /**
   * Segundos (en ms) que las reglas automáticas añaden a cada piloto en una sesión: por cada corte y por cada choque a partir de
   * cierta velocidad. Sale de los datos guardados de las vueltas, así que cambiar las reglas cambia el resultado sin recalcular nada.
   */
  autoFor(sessionId: number, rules: RacePenaltyRules, cars: string[] = []): Map<number, number> {
    const out = new Map<number, number>();
    if (rules.cutSeconds <= 0 && rules.carHitSeconds <= 0 && rules.envHitSeconds <= 0) return out;
    const carFilter = cars.length ? `AND l.car IN (${cars.map(() => '?').join(',')})` : '';
    const add = (driverId: number, ms: number) => { if (ms > 0) out.set(driverId, (out.get(driverId) ?? 0) + ms); };
    for (const r of this.db.prepare(`SELECT l.driver_id, SUM(l.cuts) AS cuts FROM laps l WHERE l.session_id = ? ${carFilter} GROUP BY l.driver_id`).all(sessionId, ...cars) as Row[])
      add(r.driver_id, Math.round(r.cuts * rules.cutSeconds * 1000));
    for (const r of this.db.prepare(
      `SELECT l.driver_id, i.kind, i.speed, i.rel_speed FROM lap_incidents i JOIN laps l ON l.id = i.lap_id WHERE l.session_id = ? ${carFilter}`,
    ).all(sessionId, ...cars) as Row[]) {
      if (r.kind === 'car' && rules.carHitSeconds > 0 && (r.rel_speed ?? r.speed) >= rules.carHitMinKmh) add(r.driver_id, Math.round(rules.carHitSeconds * 1000));
      if (r.kind === 'env' && rules.envHitSeconds > 0 && r.speed >= rules.envHitMinKmh) add(r.driver_id, Math.round(rules.envHitSeconds * 1000));
    }
    return out;
  }

  /** Últimas sesiones con vueltas y quién corrió en ellas, para elegir a quién penalizar. */
  recentSessions(limit: number): PenaltySessionDto[] {
    const sessions = this.db.prepare(
      'SELECT s.id, s.track, s.layout, s.type, s.started_at FROM sessions s WHERE s.origin IS NULL AND EXISTS (SELECT 1 FROM laps l WHERE l.session_id = s.id) ORDER BY s.id DESC LIMIT ?',
    ).all(limit) as Row[];
    const drivers = this.db.prepare('SELECT d.id, d.name, COUNT(*) AS laps FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.session_id = ? GROUP BY d.id ORDER BY laps DESC, d.name');
    return sessions.map((s) => ({
      id: s.id, track: s.track, layout: s.layout, type: s.type, startedAt: s.started_at,
      drivers: (drivers.all(s.id) as Row[]).map((d) => ({ id: d.id, name: d.name, laps: d.laps })),
    }));
  }
}
