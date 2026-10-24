import type { DatabaseSync } from 'node:sqlite';
import type {
  ActivityDayDto, BusyDriverDto, CarListItemDto, CarProfileDto, CarTrackRecordDto, DriverComboStatDto, DriverListItemDto,
  DriverProfileDto, DriverProgressDto, DriverSessionStatDto, RankingsDto, TopTimeDto, TotalsDto, TrackCarRecordDto, TrackListItemDto, TrackProfileDto,
} from '@howler/shared';

type Row = Record<string, any>;

/** Cuántos días hacia atrás cubre la gráfica de actividad. */
const ACTIVITY_DAYS = 90;
const TOP_MAX = 50;
const SESSIONS_SHOWN = 15;

/**
 * Consultas de las fichas (piloto, circuito, coche) y de sus listados. Todo se agrega en SQL: con muchas vueltas
 * solo se leen los grupos, nunca las vueltas una a una.
 */
export class Profiles {
  constructor(private db: DatabaseSync) {}

  // ---------- piezas comunes ----------

  /** Totales de las vueltas que cumplen `cond` (el alias de la tabla es `l`). */
  private totals(cond: string, args: (string | number)[]): TotalsDto {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS laps, COALESCE(SUM(l.valid), 0) AS valid, COALESCE(SUM(l.cuts), 0) AS cuts, COALESCE(SUM(l.pending), 0) AS pending_laps,
                COALESCE(SUM(CASE WHEN l.out_lap = 0 OR l.valid = 1 THEN l.lap_ms ELSE 0 END), 0) AS ms, COUNT(DISTINCT l.session_id) AS sessions,
                COUNT(DISTINCT l.track || '|' || l.layout) AS tracks, COUNT(DISTINCT l.car) AS cars,
                COUNT(DISTINCT l.driver_id) AS drivers, MAX(l.max_speed) AS vmax,
                MIN(l.created_at) AS first_at, MAX(l.created_at) AS last_at
         FROM laps l WHERE ${cond} AND l.hidden = 0`,
      )
      .get(...args) as Row;
    return {
      laps: r.laps, validLaps: r.valid, pendingLaps: r.pending_laps, cuts: r.cuts, timeMs: r.ms, sessions: r.sessions, tracks: r.tracks, cars: r.cars,
      drivers: r.drivers, maxSpeedKmh: r.vmax ?? null, firstAt: r.first_at ?? null, lastAt: r.last_at ?? null,
    };
  }

  /** Vueltas por día de los últimos 90 días. */
  private activity(cond: string, args: (string | number)[]): ActivityDayDto[] {
    const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString();
    const rows = this.db
      .prepare(`SELECT substr(l.created_at, 1, 10) AS day, COUNT(*) AS laps FROM laps l WHERE ${cond} AND l.hidden = 0 AND l.created_at >= ? GROUP BY day ORDER BY day`)
      .all(...args, since) as Row[];
    return rows.map((r) => ({ day: r.day, laps: r.laps }));
  }

  /** Los pilotos que más vueltas han dado en lo que cumple `cond`. */
  private busiest(cond: string, args: (string | number)[], limit = 5): BusyDriverDto[] {
    const rows = this.db
      .prepare(
        `SELECT l.driver_id, d.name, COUNT(*) AS laps FROM laps l JOIN drivers d ON d.id = l.driver_id
         WHERE ${cond} AND l.hidden = 0 GROUP BY l.driver_id ORDER BY laps DESC, d.name LIMIT ?`,
      )
      .all(...args, limit) as Row[];
    return rows.map((r) => ({ driverId: r.driver_id, driverName: r.name, laps: r.laps }));
  }

  /** La vuelta válida más rápida de las que cumplen `cond` (con quién y cuándo). */
  private bestLap(cond: string, args: (string | number)[]) {
    return this.db
      .prepare(
        `SELECT l.id, l.driver_id, d.name AS driver_name, l.car, l.track, l.layout, l.lap_ms, l.max_speed, l.created_at
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE ${cond} AND l.valid = 1 AND l.hidden = 0 ORDER BY l.lap_ms, l.id LIMIT 1`,
      )
      .get(...args) as Row | undefined;
  }

  // ---------- pilotos ----------

  driverList(): DriverListItemDto[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.name, COUNT(l.id) AS laps, COALESCE(SUM(l.valid), 0) AS valid,
                COUNT(DISTINCT l.track || '|' || l.layout) AS tracks, COUNT(DISTINCT l.car) AS cars, MAX(l.created_at) AS last_seen
         FROM drivers d JOIN laps l ON l.driver_id = d.id AND l.hidden = 0 GROUP BY d.id ORDER BY laps DESC, d.name`,
      )
      .all() as Row[];
    return rows.map((r) => ({ id: r.id, name: r.name, laps: r.laps, validLaps: r.valid, tracks: r.tracks, cars: r.cars, lastSeen: r.last_seen }));
  }

  /**
   * Top N (10 por defecto, máx. 50) de varias clasificaciones de pilotos. Las vueltas pendientes o anuladas no cuentan para récords ni tiempo.
   * `track`/`layout` limitan a un circuito y `since` (ISO) a las vueltas dadas desde ese momento.
   */
  rankings(f: { track?: string; layout?: string; since?: string; top?: number } = {}): RankingsDto {
    const limit = Math.min(50, Math.max(1, Math.floor(f.top ?? 10)));
    const cond: string[] = [];
    const args: string[] = [];
    if (f.track !== undefined) { cond.push('l.track = ?'); args.push(f.track); }
    if (f.track !== undefined && f.layout !== undefined) { cond.push('l.layout = ?'); args.push(f.layout); }
    if (f.since) { cond.push('l.created_at >= ?'); args.push(f.since); }
    // Condición común de las vueltas que cuentan (`l` = la vuelta). Cada consulta la usa UNA sola vez, así `args` coincide.
    const w = ['l.hidden = 0', ...cond].join(' AND ');
    const top = (sql: string): { driverId: number; driverName: string; value: number }[] =>
      (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({ driverId: r.id, driverName: r.name, value: r.v }));
    const perDriver = (select: string, where = '1 = 1', having = '', order = 'v DESC, d.name') =>
      top(`SELECT d.id, d.name, ${select} AS v FROM drivers d JOIN laps l ON l.driver_id = d.id AND ${w} WHERE ${where} GROUP BY d.id ${having} ORDER BY ${order} LIMIT ${limit}`);
    return {
      laps: perDriver('COUNT(*)'),
      validLaps: perDriver('SUM(l.valid)'),
      topSpeed: perDriver('MAX(l.max_speed)', 'l.max_speed IS NOT NULL AND l.max_speed > 0'),
      sessions: perDriver('COUNT(DISTINCT l.session_id)'),
      cars: perDriver('COUNT(DISTINCT l.car)'),
      daysActive: perDriver('COUNT(DISTINCT substr(l.created_at, 1, 10))'),
      // Podios: combinaciones (con rivales) donde su mejor vuelta válida es de las 3 mejores.
      podiums: top(
        `WITH b AS (SELECT l.driver_id, l.track, l.layout, l.car, MIN(l.lap_ms) AS m FROM laps l WHERE l.valid = 1 AND ${w} GROUP BY l.driver_id, l.track, l.layout, l.car),
              r AS (SELECT driver_id, RANK() OVER (PARTITION BY track, layout, car ORDER BY m) AS rk, COUNT(*) OVER (PARTITION BY track, layout, car) AS n FROM b)
         SELECT d.id, d.name, COUNT(*) AS v FROM r JOIN drivers d ON d.id = r.driver_id WHERE r.rk <= 3 AND r.n > 1
         GROUP BY d.id ORDER BY v DESC, d.name LIMIT ${limit}`),
      // Récord vigente de cada combinación con rivales (una sola vuelta por combinación; con empate, la más antigua).
      records: top(
        `WITH combos AS (
           SELECT c.track, c.layout, c.car, COUNT(DISTINCT c.driver_id) AS n,
                  (SELECT b.id FROM laps b WHERE b.track = c.track AND b.layout = c.layout AND b.car = c.car AND b.valid = 1 AND b.hidden = 0 ORDER BY b.lap_ms, b.id LIMIT 1) AS best_id
           FROM laps c WHERE c.valid = 1 AND c.hidden = 0 GROUP BY c.track, c.layout, c.car HAVING n > 1)
         SELECT d.id, d.name, COUNT(*) AS v FROM combos
           JOIN laps l ON l.id = combos.best_id AND ${w}
           JOIN drivers d ON d.id = l.driver_id
         GROUP BY d.id ORDER BY v DESC, d.name LIMIT ${limit}`),
      timeMs: perDriver('SUM(l.lap_ms)', '(l.out_lap = 0 OR l.valid = 1)'),
      cleanPct: perDriver('ROUND(100.0 * SUM(l.valid) / COUNT(*), 1)', '1 = 1', 'HAVING COUNT(*) >= 20', 'v DESC, COUNT(*) DESC'),
      tracks: perDriver("COUNT(DISTINCT l.track || '|' || l.layout)"),
    };
  }

  /** Para el mapa del mundo: cada circuito+layout con sus vueltas y los 3 mejores tiempos (un piloto una vez, con su mejor coche). */
  worldBoard(): { track: string; layout: string; laps: number; top: { driverId: number; driverName: string; lapMs: number; car: string }[] }[] {
    const tracks = this.db.prepare('SELECT track, layout, COUNT(*) AS n FROM laps WHERE hidden = 0 GROUP BY track, layout ORDER BY track, layout').all() as Row[];
    const best = this.db.prepare(
      `WITH b AS (SELECT id, track, layout, driver_id, car, lap_ms, ROW_NUMBER() OVER (PARTITION BY track, layout, driver_id ORDER BY lap_ms, id) AS rn FROM laps WHERE valid = 1 AND hidden = 0),
            r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY track, layout ORDER BY lap_ms, id) AS rk FROM b WHERE rn = 1)
       SELECT r.track, r.layout, r.driver_id, d.name, r.car, r.lap_ms FROM r JOIN drivers d ON d.id = r.driver_id WHERE r.rk <= 3 ORDER BY r.track, r.layout, r.rk`,
    ).all() as Row[];
    const by = new Map<string, { driverId: number; driverName: string; lapMs: number; car: string }[]>();
    for (const r of best) {
      const k = `${r.track}|${r.layout}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push({ driverId: r.driver_id, driverName: r.name, lapMs: r.lap_ms, car: r.car });
    }
    return tracks.map((t) => ({ track: t.track, layout: t.layout, laps: t.n, top: by.get(`${t.track}|${t.layout}`) ?? [] }));
  }

  driverProfile(id: number): DriverProfileDto | null {
    const d = this.db.prepare('SELECT id, name, first_seen, last_seen FROM drivers WHERE id = ? AND hidden = 0').get(id) as Row | undefined;
    if (!d) return null;

    const inc = this.db
      .prepare('SELECT i.kind, COUNT(*) AS n FROM lap_incidents i JOIN laps l ON l.id = i.lap_id WHERE l.driver_id = ? AND l.hidden = 0 GROUP BY i.kind')
      .all(id) as Row[];

    // Estadísticas del piloto por combinación (circuito + layout + coche).
    const mine = this.db
      .prepare(
        `SELECT track, layout, car, COUNT(*) AS laps, SUM(valid) AS valid,
                AVG(CASE WHEN valid = 1 THEN lap_ms END) AS avg_ms,
                SUM(CASE WHEN valid = 1 THEN lap_ms * lap_ms * 1.0 END) AS sq,
                COUNT(CASE WHEN valid = 1 THEN 1 END) AS n_avg,
                SUM(out_lap) AS out_laps, MAX(max_speed) AS vmax, MAX(created_at) AS last_at
         FROM laps WHERE driver_id = ? AND hidden = 0 GROUP BY track, layout, car`,
      )
      .all(id) as Row[];

    // Mejor vuelta de TODOS los pilotos en esas combinaciones, para sacar su puesto y el récord.
    const bests = this.db
      .prepare(
        `SELECT l.driver_id, l.track, l.layout, l.car, MIN(l.lap_ms) AS b
         FROM laps l JOIN (SELECT DISTINCT track, layout, car FROM laps WHERE driver_id = ?) c
           ON c.track = l.track AND c.layout = l.layout AND c.car = l.car
         WHERE l.valid = 1 AND l.hidden = 0 GROUP BY l.driver_id, l.track, l.layout, l.car`,
      )
      .all(id) as Row[];
    const byCombo = new Map<string, Map<number, number>>();
    for (const b of bests) {
      const k = `${b.track}|${b.layout}|${b.car}`;
      (byCombo.get(k) ?? byCombo.set(k, new Map()).get(k)!).set(b.driver_id, b.b);
    }

    const combos: DriverComboStatDto[] = mine.map((m) => {
      const all = byCombo.get(`${m.track}|${m.layout}|${m.car}`);
      const best = all?.get(id) ?? null;
      const values = all ? [...all.values()] : [];
      const avg = m.avg_ms ?? null;
      const std = avg != null && m.n_avg > 0 ? Math.sqrt(Math.max(0, m.sq / m.n_avg - avg * avg)) : null;
      return {
        track: m.track, layout: m.layout, car: m.car, laps: m.laps, validLaps: m.valid ?? 0, bestMs: best, avgMs: avg, stdMs: std, outLaps: m.out_laps ?? 0,
        maxSpeedKmh: m.vmax ?? null,
        rank: best == null ? null : 1 + values.filter((v) => v < best).length,
        drivers: values.length, recordMs: values.length ? Math.min(...values) : null, lastAt: m.last_at,
      };
    });
    combos.sort((a, b) => b.laps - a.laps);

    // Sesiones recientes y su puesto en cada una.
    const sess = this.db
      .prepare(
        `SELECT s.id, s.track, s.layout, s.name, s.type, s.started_at, COUNT(*) AS laps, SUM(l.valid) AS valid,
                MIN(CASE WHEN l.valid = 1 THEN l.lap_ms END) AS best, GROUP_CONCAT(DISTINCT l.car) AS cars
         FROM laps l JOIN sessions s ON s.id = l.session_id WHERE l.driver_id = ? AND l.hidden = 0 GROUP BY s.id ORDER BY s.id DESC LIMIT ?`,
      )
      .all(id, SESSIONS_SHOWN) as Row[];
    const sessionBests = new Map<number, number[]>();
    if (sess.length) {
      const rows = this.db
        .prepare(
          `SELECT session_id, MIN(lap_ms) AS b FROM laps WHERE valid = 1 AND hidden = 0 AND session_id IN (${sess.map(() => '?').join(',')})
           GROUP BY session_id, driver_id`,
        )
        .all(...sess.map((s) => s.id)) as Row[];
      for (const r of rows) (sessionBests.get(r.session_id) ?? sessionBests.set(r.session_id, []).get(r.session_id)!).push(r.b);
    }
    const sessions: DriverSessionStatDto[] = sess.map((s) => {
      const all = sessionBests.get(s.id) ?? [];
      return {
        id: s.id, track: s.track, layout: s.layout, name: s.name, type: s.type, startedAt: s.started_at, laps: s.laps, validLaps: s.valid ?? 0,
        bestMs: s.best ?? null, position: s.best == null ? null : 1 + all.filter((v) => v < s.best).length, drivers: all.length,
        cars: String(s.cars ?? '').split(',').filter(Boolean),
      };
    });

    const trackLaps = new Map<string, { track: string; layout: string; laps: number }>();
    const carLaps = new Map<string, number>();
    for (const c of combos) {
      const k = `${c.track}|${c.layout}`;
      const t = trackLaps.get(k) ?? { track: c.track, layout: c.layout, laps: 0 };
      t.laps += c.laps;
      trackLaps.set(k, t);
      carLaps.set(c.car, (carLaps.get(c.car) ?? 0) + c.laps);
    }
    const favTrack = [...trackLaps.values()].sort((a, b) => b.laps - a.laps)[0] ?? null;
    const favCar = [...carLaps].sort((a, b) => b[1] - a[1])[0];

    return {
      id: d.id, name: d.name, firstSeen: d.first_seen, lastSeen: d.last_seen,
      totals: this.totals('l.driver_id = ?', [id]),
      carCollisions: inc.find((r) => r.kind === 'car')?.n ?? 0,
      envCollisions: inc.find((r) => r.kind === 'env')?.n ?? 0,
      records: combos.filter((c) => c.rank === 1).length,
      podiums: combos.filter((c) => c.rank != null && c.rank <= 3).length,
      favoriteTrack: favTrack, favoriteCar: favCar ? { car: favCar[0], laps: favCar[1] } : null,
      combos, progress: this.progress(id), sessions, activity: this.activity('l.driver_id = ?', [id]),
    };
  }

  /** Cada mejora del mejor tiempo personal, por combinación y en orden. Solo vueltas válidas (las pendientes no cuentan hasta aprobarse). */
  private progress(driverId: number): DriverProgressDto[] {
    const rows = this.db.prepare('SELECT track, layout, car, lap_ms, created_at FROM laps WHERE driver_id = ? AND valid = 1 AND hidden = 0 ORDER BY created_at, id').all(driverId) as Row[];
    const byCombo = new Map<string, DriverProgressDto>();
    for (const r of rows) {
      const k = `${r.track}|${r.layout}|${r.car}`;
      const c = byCombo.get(k) ?? byCombo.set(k, { track: r.track, layout: r.layout, car: r.car, points: [] }).get(k)!;
      if (c.points.length === 0 || r.lap_ms < c.points[c.points.length - 1]!.ms) c.points.push({ at: r.created_at, ms: r.lap_ms });
    }
    return [...byCombo.values()].sort((a, b) => b.points.length - a.points.length);
  }

  // ---------- circuitos ----------

  trackList(): TrackListItemDto[] {
    const rows = this.db
      .prepare(
        `SELECT track, layout, COUNT(*) AS laps, COUNT(DISTINCT driver_id) AS drivers, COUNT(DISTINCT car) AS cars, MAX(created_at) AS last_at
         FROM laps WHERE hidden = 0 GROUP BY track, layout ORDER BY MAX(id) DESC`,
      )
      .all() as Row[];
    return rows.map((r) => {
      const best = this.bestLap('l.track = ? AND l.layout = ?', [r.track, r.layout]);
      return {
        track: r.track, layout: r.layout, laps: r.laps, drivers: r.drivers, cars: r.cars, lastAt: r.last_at,
        recordMs: best?.lap_ms ?? null, recordDriverId: best?.driver_id ?? null, recordDriverName: best?.driver_name ?? null, recordCar: best?.car ?? null,
      };
    });
  }

  trackProfile(track: string, layout: string): TrackProfileDto | null {
    const cond = 'l.track = ? AND l.layout = ?';
    const args = [track, layout];
    const totals = this.totals(cond, args);
    if (totals.laps === 0) return null;

    // Mejor vuelta de cada piloto con cada coche; de ahí, la mejor de cada piloto.
    const groups = this.db
      .prepare(
        `SELECT l.driver_id, d.name AS driver_name, l.car, COUNT(*) AS laps, MIN(CASE WHEN l.valid = 1 THEN l.lap_ms END) AS best
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE ${cond} AND l.hidden = 0 GROUP BY l.driver_id, l.car HAVING best IS NOT NULL`,
      )
      .all(...args) as Row[];
    const perDriver = new Map<number, Row>();
    for (const g of groups) {
      const cur = perDriver.get(g.driver_id);
      if (!cur || g.best < cur.best) perDriver.set(g.driver_id, g);
    }
    const ranked = [...perDriver.values()].sort((a, b) => a.best - b.best || a.driver_id - b.driver_id).slice(0, TOP_MAX);
    const lapOf = this.db.prepare(
      'SELECT max_speed, created_at FROM laps WHERE track = ? AND layout = ? AND driver_id = ? AND car = ? AND valid = 1 AND lap_ms = ? ORDER BY id LIMIT 1',
    );
    const top: TopTimeDto[] = ranked.map((g, i) => {
      const lap = lapOf.get(track, layout, g.driver_id, g.car, g.best) as Row;
      return {
        position: i + 1, driverId: g.driver_id, driverName: g.driver_name, car: g.car, lapMs: g.best, gapMs: g.best - ranked[0]!.best,
        laps: g.laps, maxSpeedKmh: lap?.max_speed ?? null, at: lap?.created_at ?? '',
      };
    });

    // Récord de cada coche en este circuito.
    const carRows = this.db
      .prepare(
        `SELECT l.car, COUNT(*) AS laps, COUNT(DISTINCT l.driver_id) AS drivers, MIN(CASE WHEN l.valid = 1 THEN l.lap_ms END) AS best
         FROM laps l WHERE ${cond} AND l.hidden = 0 GROUP BY l.car ORDER BY laps DESC`,
      )
      .all(...args) as Row[];
    const cars: TrackCarRecordDto[] = carRows.map((r) => {
      const holder = r.best == null ? undefined : this.bestLap(`${cond} AND l.car = ?`, [...args, r.car]);
      return { car: r.car, bestMs: r.best ?? null, driverId: holder?.driver_id ?? null, driverName: holder?.driver_name ?? null, laps: r.laps, drivers: r.drivers };
    });
    cars.sort((a, b) => (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity));

    return { track, layout, totals, record: top[0] ?? null, top, cars, busiest: this.busiest(cond, args), activity: this.activity(cond, args) };
  }

  // ---------- coches ----------

  carList(): CarListItemDto[] {
    const rows = this.db
      .prepare(
        `SELECT car, COUNT(*) AS laps, COUNT(DISTINCT driver_id) AS drivers, COUNT(DISTINCT track || '|' || layout) AS tracks, MAX(created_at) AS last_at
         FROM laps WHERE hidden = 0 GROUP BY car ORDER BY laps DESC, car`,
      )
      .all() as Row[];
    return rows.map((r) => ({ car: r.car, laps: r.laps, drivers: r.drivers, tracks: r.tracks, lastAt: r.last_at }));
  }

  carProfile(car: string): CarProfileDto | null {
    const cond = 'l.car = ?';
    const args = [car];
    const totals = this.totals(cond, args);
    if (totals.laps === 0) return null;

    const rows = this.db
      .prepare(
        `SELECT l.track, l.layout, COUNT(*) AS laps, COUNT(DISTINCT l.driver_id) AS drivers, MIN(CASE WHEN l.valid = 1 THEN l.lap_ms END) AS best
         FROM laps l WHERE ${cond} AND l.hidden = 0 GROUP BY l.track, l.layout`,
      )
      .all(...args) as Row[];
    const tracks: CarTrackRecordDto[] = rows.map((r) => {
      const holder = r.best == null ? undefined : this.bestLap(`${cond} AND l.track = ? AND l.layout = ?`, [car, r.track, r.layout]);
      return {
        track: r.track, layout: r.layout, bestMs: r.best ?? null, driverId: holder?.driver_id ?? null, driverName: holder?.driver_name ?? null,
        laps: r.laps, drivers: r.drivers, at: holder?.created_at ?? null,
      };
    });
    tracks.sort((a, b) => b.laps - a.laps);

    return { car, totals, tracks, busiest: this.busiest(cond, args), activity: this.activity(cond, args) };
  }
}
