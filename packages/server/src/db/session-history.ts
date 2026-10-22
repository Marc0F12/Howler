import type { DatabaseSync } from 'node:sqlite';
import { serverSql, type MultiHowlerStore, type ServerFilter } from './multihowler';
import { type SessionHistoryItemDto, type SessionHistoryPageDto } from '@howler/shared';

type Row = Record<string, any>;

/** El instante límite (exclusivo) de «hasta»: si es solo una fecha, el día siguiente. */
function dayAfter(to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return to;
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export interface SessionFilter {
  track?: string;
  layout?: string;
  car?: string;
  type?: number;
  driverId?: number;
  /** Fechas ISO (AAAA-MM-DD o con hora): desde (incluida) y hasta (el día entero). */
  from?: string;
  to?: string;
  server?: ServerFilter;
  limit: number;
  offset: number;
}

/** Historial de sesiones: la lista con sus filtros. Solo salen las sesiones en las que se dio alguna vuelta. */
export class SessionHistory {
  constructor(private db: DatabaseSync, private multihowler: MultiHowlerStore) {}

  list(f: SessionFilter): SessionHistoryPageDto {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.track !== undefined) { where.push('s.track = ?'); args.push(f.track); }
    if (f.layout !== undefined) { where.push('s.layout = ?'); args.push(f.layout); }
    if (f.type !== undefined) { where.push('s.type = ?'); args.push(f.type); }
    if (f.car !== undefined) { where.push('EXISTS (SELECT 1 FROM laps x WHERE x.session_id = s.id AND x.car = ?)'); args.push(f.car); }
    if (f.driverId !== undefined) { where.push('EXISTS (SELECT 1 FROM laps x WHERE x.session_id = s.id AND x.driver_id = ?)'); args.push(f.driverId); }
    if (f.from) { where.push('s.started_at >= ?'); args.push(f.from); }
    if (f.to) { where.push('s.started_at < ?'); args.push(dayAfter(f.to)); }
    const cond = (where.length ? `AND ${where.join(' AND ')}` : '') + serverSql(f.server, 's.');
    const from = `FROM sessions s WHERE EXISTS (SELECT 1 FROM laps l WHERE l.session_id = s.id AND l.hidden = 0) ${cond}`;
    const total = (this.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args) as Row).n as number;
    const rows = this.db.prepare(`SELECT s.* ${from} ORDER BY s.started_at DESC, s.id DESC LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset) as Row[];

    const stats = this.db.prepare(
      `SELECT COUNT(*) AS laps, COALESCE(SUM(valid), 0) AS valid, COUNT(DISTINCT driver_id) AS drivers, MIN(CASE WHEN valid = 1 THEN lap_ms END) AS best FROM laps WHERE session_id = ?`);
    const names = this.db.prepare(
      `SELECT d.id, d.name FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.session_id = ? AND l.hidden = 0 GROUP BY d.id ORDER BY COUNT(*) DESC, d.name LIMIT 6`);
    const cars = this.db.prepare('SELECT DISTINCT car FROM laps WHERE session_id = ? ORDER BY car');
    const bestBy = this.db.prepare(
      `SELECT d.name FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.session_id = ? AND l.valid = 1 AND l.hidden = 0 ORDER BY l.lap_ms, l.id LIMIT 1`);

    const items: SessionHistoryItemDto[] = rows.map((r) => {
      const st = stats.get(r.id) as Row;
      return {
        id: r.id, ...((b) => ({ serverBadge: b.text, serverBadgeBg: b.bg, serverBadgeFg: b.fg }))(this.multihowler.badgeOf(r.origin)), track: r.track, layout: r.layout, name: r.name, type: r.type, startedAt: r.started_at, endedAt: r.ended_at ?? null,
        laps: st.laps, validLaps: st.valid, drivers: st.drivers,
        driverNames: (names.all(r.id) as Row[]).map((d) => ({ id: d.id, name: d.name })),
        cars: (cars.all(r.id) as Row[]).map((c) => c.car),
        bestMs: st.best ?? null,
        bestDriverName: st.best != null ? ((bestBy.get(r.id) as Row | undefined)?.name ?? null) : null,
      };
    });
    return { total, items };
  }
}
