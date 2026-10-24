import type { DatabaseSync } from 'node:sqlite';
import { LapAdmin } from './lap-admin';
import { Championships } from './championships';
import { Signups } from './signups';
import { Imports } from './imports';
import { MultiHowlerStore, serverSql, type ServerFilter } from './multihowler';
import { MhTraces } from './mh-traces';
import { DriverAdmin } from './driver-admin';
import { SharedChampionships } from './shared-championships';
import { Penalties } from './penalties';
import { RecordScopes } from './record-scopes';
import { SessionHistory } from './session-history';
import { Profiles } from './profiles';
import { LapExport } from './lap-export';
import type { LapAids, SessionConditions, ComboDto, OnlineDriver, RecentLapDto, ProgressionStepDto, RecordDto, RecordEntryDto, RecordsDto, SectorKind, SessionLapDto, SessionSummary, TimingDto, TimingRowDto } from '@howler/shared';

export interface NewLap {
  sessionId: number;
  driverId: number;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  sectorsMs: (number | null)[];
  cuts: number;
  grip: number | null;
  valid: boolean;
  invalidReason: string | null;
  /** Sectores medidos por el juego del piloto (no estimados). */
  sectorsExact?: boolean;
  source?: 'live' | 'results' | 'import';
  /** Temperaturas (°C) y ayudas, si se conocen. */
  tempAir?: number | null;
  tempTrack?: number | null;
  /** Clima que decía el servidor al darse la vuelta (carpeta de clima o tipo de CSP), si se sabe. */
  weather?: string | null;
  aids?: LapAids | null;
  /** Cuándo se dio la vuelta (ISO), para vueltas importadas; por defecto, ahora. */
  createdAt?: string;
  /** Velocidad máxima de la vuelta (km/h), medida con las posiciones del servidor. */
  maxSpeedKmh?: number | null;
  /** La vuelta no empezó en la línea de meta (salida de boxes, reinicio...): su tiempo no es el de una vuelta normal. */
  outLap?: boolean;
  /** Pendiente de revisión (con `valid` en false): no cuenta hasta que se apruebe. */
  pending?: boolean;
}

export interface NewIncident {
  kind: 'car' | 'env';
  /** Velocidad que manda el juego. */
  speed: number;
  /** Velocidad relativa entre los dos coches, si se pudo medir (solo choques entre coches). */
  relSpeed?: number | null;
  otherDriverId: number | null;
}

type Row = Record<string, any>;

/** Condiciones de una fila de `sessions`; `null` si no se sabe ninguna. */
export function conditionsOf(r: Row): SessionConditions | null {
  const c = { fuelPct: r.fuel_pct ?? null, damagePct: r.damage_pct ?? null, tyreWearPct: r.tyre_wear_pct ?? null, tyresOut: r.tyres_out ?? null };
  return Object.values(c).some((v) => v != null) ? c : null;
}

/** Ayudas guardadas como JSON; un valor que no se pueda leer se ignora. */
export function parseAids(raw: unknown): LapAids | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? (v as LapAids) : null; } catch { return null; }
}


/** Todo el SQL vive aquí; el resto del código no escribe consultas. */
/** Copia consistente de la base de datos (con la conexión abierta) en `file`, que no debe existir. */
export function snapshotDatabase(db: DatabaseSync, file: string): void {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

export class Repository {
  /** Fichas de piloto, circuito y coche y sus listados. */
  readonly profiles: Profiles;
  /** Recálculo de validez con reglas nuevas y decisiones manuales sobre vueltas. */
  readonly lapAdmin: LapAdmin;
  /** Campeonatos y su clasificación. */
  readonly championships: Championships;
  /** Inscripción pública a campeonatos. */
  readonly signups: Signups;
  /** Importación de datos de otras herramientas (stracker...). */
  readonly imports: Imports;
  /** Avisos, tiempo añadido y descalificaciones de carrera. */
  readonly penalties: Penalties;
  /** Identidad, vínculos y copias de otros Howler. */
  readonly multihowler: MultiHowlerStore;
  readonly mhTraces: MhTraces;
  readonly driverAdmin: DriverAdmin;
  readonly sharedChampionships: SharedChampionships;
  readonly recordScopes: RecordScopes;
  readonly sessionHistory: SessionHistory;
  /** Exportación de las vueltas a CSV / JSON. */
  readonly lapExport: LapExport;

  constructor(private db: DatabaseSync) {
    this.lapExport = new LapExport(db);
    this.profiles = new Profiles(db);
    this.lapAdmin = new LapAdmin(db);
    this.penalties = new Penalties(db);
    this.recordScopes = new RecordScopes(db);
    this.championships = new Championships(db, this.penalties);
    this.signups = new Signups(db);
    this.imports = new Imports(db);
    this.multihowler = new MultiHowlerStore(db);
    this.mhTraces = new MhTraces(db, (t, l, c) => this.pruneTraces(t, l, c));
    this.sessionHistory = new SessionHistory(db, this.multihowler);
    this.driverAdmin = new DriverAdmin(db);
    this.sharedChampionships = new SharedChampionships(db);
    this.multihowler.onHiddenChange = () => this.driverAdmin.refreshHidden();
  }

  /** SOLO para uso interno del servidor (p. ej. pedir el avatar a Steam): el Steam ID nunca sale por la API. */
  driverSteamId(driverId: number): string | null {
    return (this.db.prepare('SELECT steam_id FROM drivers WHERE id = ?').get(driverId) as Row | undefined)?.steam_id ?? null;
  }

  /** Piloto de ese Steam ID (o al que se unió), sin crearlo. SOLO uso interno. */
  driverBySteam(steamId: string): { id: number; name: string } | null {
    const found = this.db.prepare('SELECT id, name FROM drivers WHERE steam_id = ?').get(steamId) as Row | undefined;
    return found ? { id: found.id, name: found.name } : this.aliasOf(steamId);
  }

  /** Piloto de ese Steam ID; si no existía se crea con el nombre dado. NO cambia el nombre de uno que ya existe. */
  findOrCreateDriver(steamId: string, name: string): { id: number; name: string } {
    const aliased = this.aliasOf(steamId);
    if (aliased) return aliased;
    const found = this.db.prepare('SELECT id, name FROM drivers WHERE steam_id = ?').get(steamId) as Row | undefined;
    if (found) return { id: found.id, name: found.name };
    return { id: this.upsertDriver(steamId, name), name };
  }

  /** Como `upsertDriver`, pero si el piloto ya existe NO le cambia el nombre (para importaciones que no deben pisar datos). */
  upsertDriverKeepName(steamId: string, name: string): number {
    const found = this.aliasOf(steamId) ?? (this.db.prepare('SELECT id FROM drivers WHERE steam_id = ?').get(steamId) as Row | undefined);
    return found ? found.id : this.upsertDriver(steamId, name);
  }

  /** Si ese Steam ID pertenece a un piloto que se unió a otro, el piloto de destino. */
  private aliasOf(steamId: string): { id: number; name: string } | null {
    const r = this.db.prepare('SELECT d.id, d.name FROM driver_aliases a JOIN drivers d ON d.id = a.driver_id WHERE a.steam_id = ?').get(steamId) as Row | undefined;
    return r ? { id: r.id, name: r.name } : null;
  }

  upsertDriver(steamId: string, name: string): number {
    const now = new Date().toISOString();
    const aliased = this.aliasOf(steamId);
    if (aliased) {
      this.db.prepare('UPDATE drivers SET last_seen = ?, name = CASE WHEN name_locked = 1 THEN name ELSE ? END WHERE id = ?').run(now, name, aliased.id);
      return aliased.id;
    }
    this.db
      .prepare(
        `INSERT INTO drivers (steam_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(steam_id) DO UPDATE SET name = CASE WHEN drivers.name_locked = 1 THEN drivers.name ELSE excluded.name END, last_seen = excluded.last_seen`,
      )
      .run(steamId, name, now, now);
    return (this.db.prepare('SELECT id FROM drivers WHERE steam_id = ?').get(steamId) as Row).id;
  }

  createSession(s: { track: string; layout: string; name: string; type: number; conditions?: SessionConditions | null }): SessionSummary {
    const startedAt = new Date().toISOString();
    const c = s.conditions ?? null;
    const r = this.db
      .prepare('INSERT INTO sessions (track, layout, name, type, started_at, fuel_pct, damage_pct, tyre_wear_pct, tyres_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.track, s.layout, s.name, s.type, startedAt, c?.fuelPct ?? null, c?.damagePct ?? null, c?.tyreWearPct ?? null, c?.tyresOut ?? null);
    return { id: Number(r.lastInsertRowid), track: s.track, layout: s.layout, name: s.name, type: s.type, startedAt, conditions: c };
  }

  sessionHasLaps(id: number): boolean {
    return this.db.prepare('SELECT 1 FROM laps WHERE session_id = ? LIMIT 1').get(id) !== undefined;
  }

  /** Una sesión por su id (null si no existe). */
  sessionById(id: number): SessionSummary | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? { id: r.id, track: r.track, layout: r.layout, name: r.name, type: r.type, startedAt: r.started_at, conditions: conditionsOf(r) } : null;
  }

  /** La sesión más reciente en la que se dio alguna vuelta. */
  latestSessionWithLaps(): SessionSummary | null {
    const r = this.db
      .prepare('SELECT * FROM sessions s WHERE s.origin IS NULL AND EXISTS (SELECT 1 FROM laps l WHERE l.session_id = s.id) ORDER BY s.id DESC LIMIT 1')
      .get() as Row | undefined;
    return r ? { id: r.id, track: r.track, layout: r.layout, name: r.name, type: r.type, startedAt: r.started_at, conditions: conditionsOf(r) } : null;
  }

  /** Todas las vueltas de un piloto en una sesión, de la primera a la última. */
  driverSessionLaps(sessionId: number, driverId: number): SessionLapDto[] {
    const rows = this.db
      .prepare('SELECT id, car, lap_ms, valid, invalid_reason, max_speed, out_lap, pending, temp_air, temp_track, weather, aids, created_at FROM laps WHERE session_id = ? AND driver_id = ? AND hidden = 0 ORDER BY id')
      .all(sessionId, driverId) as Row[];
    const secs = this.sectorsOf(rows.map((r) => r.id));
    return rows.map((r, i) => ({
      lapNo: i + 1, lapId: r.id, lapMs: r.lap_ms, valid: r.valid === 1, invalidReason: r.invalid_reason,
      car: r.car, sectorsMs: secs.get(r.id) ?? [], maxSpeedKmh: r.max_speed ?? null, outLap: r.out_lap === 1, pending: r.pending === 1, tempAir: r.temp_air ?? null, tempTrack: r.temp_track ?? null, weather: r.weather ?? null, aids: parseAids(r.aids), at: r.created_at,
    }));
  }

  /**
   * Las `limit` mejores vueltas de un circuito (la mejor de cada piloto y coche), de más rápida a más lenta.
   * `cars` vacío = todos los coches. Es el mismo criterio que la tabla de tiempos.
   */
  topLapIds(track: string, layout: string, cars: string[], limit: number, includeHidden = false): number[] {
    const hid = includeHidden ? '' : 'AND hidden = 0';
    const carFilter = cars.length ? `AND car IN (${cars.map(() => '?').join(',')})` : '';
    const groups = this.db
      .prepare(
        `SELECT driver_id, car, MIN(lap_ms) AS best FROM laps
         WHERE track = ? AND layout = ? AND valid = 1 ${hid} ${carFilter} GROUP BY driver_id, car ORDER BY best, MIN(id) LIMIT ?`,
      )
      .all(track, layout, ...cars, limit) as Row[];
    const idOf = this.db.prepare(
      `SELECT id FROM laps WHERE track = ? AND layout = ? AND driver_id = ? AND car = ? AND valid = 1 AND lap_ms = ? ${hid} ORDER BY id LIMIT 1`,
    );
    return groups.map((g) => (idOf.get(track, layout, g.driver_id, g.car, g.best) as Row).id as number);
  }

  /**
   * ¿Es esta vuelta la mejor válida de su piloto con ese coche en ese circuito (a igualdad, la más antigua)?
   * Solo esas conservan traza, así que el resto ni se guarda.
   */
  isPersonalBest(lapId: number): boolean {
    const l = this.db.prepare('SELECT driver_id, track, layout, car, lap_ms FROM laps WHERE id = ?').get(lapId) as Row | undefined;
    if (!l) return false;
    return this.db.prepare(
      'SELECT 1 FROM laps WHERE driver_id = ? AND track = ? AND layout = ? AND car = ? AND valid = 1 AND id <> ? AND lap_ms <= ? LIMIT 1',
    ).get(l.driver_id, l.track, l.layout, l.car, lapId, l.lap_ms) == null;
  }

  /** Guarda la traza (ya empaquetada) de una vuelta. */
  saveTrace(lapId: number, samples: number, data: Buffer) {
    this.db.prepare('INSERT OR REPLACE INTO lap_traces (lap_id, samples, data) VALUES (?, ?, ?)').run(lapId, samples, data);
  }

  /**
   * Borra las trazas de la combinación que no son la mejor vuelta válida de su piloto. Se conserva la mejor de CADA
   * piloto (no solo las 3 primeras) para poder comparar a cualquiera con cualquiera.
   */
  pruneTraces(track: string, layout: string, car: string) {
    const keepIds = this.topLapIds(track, layout, [car], 1_000_000, true);
    const rows = this.db
      .prepare('SELECT t.lap_id FROM lap_traces t JOIN laps l ON l.id = t.lap_id WHERE l.track = ? AND l.layout = ? AND l.car = ?')
      .all(track, layout, car) as Row[];
    const del = this.db.prepare('DELETE FROM lap_traces WHERE lap_id = ?');
    for (const r of rows) if (!keepIds.includes(r.lap_id)) del.run(r.lap_id);
  }

  /** Las 3 mejores vueltas de la selección con su traza empaquetada (null si no se grabó). */
  topLapsWithTraces(track: string, layout: string, cars: string[], limit = 3) {
    return this.lapsWithTraces(this.topLapIds(track, layout, cars, limit));
  }

  /**
   * La mejor vuelta válida de cada piloto y coche pedidos en un circuito, con su traza (para comparar vueltas).
   * Se respeta el orden pedido; si alguien no tiene vuelta válida allí, se omite.
   */
  bestLapsWithTraces(track: string, layout: string, picks: { driverId: number; car: string }[]) {
    const best = this.db.prepare(
      'SELECT id FROM laps WHERE track = ? AND layout = ? AND driver_id = ? AND car = ? AND valid = 1 AND hidden = 0 ORDER BY lap_ms, id LIMIT 1',
    );
    const ids = picks.flatMap((p) => { const r = best.get(track, layout, p.driverId, p.car) as Row | undefined; return r ? [r.id as number] : []; });
    return this.lapsWithTraces(ids);
  }

  private lapsWithTraces(ids: number[]) {
    const get = this.db.prepare(
      `SELECT l.id, l.driver_id, d.name AS driver_name, l.car, l.lap_ms, l.max_speed, l.sectors_exact, l.created_at, t.data
       FROM laps l JOIN drivers d ON d.id = l.driver_id LEFT JOIN lap_traces t ON t.lap_id = l.id WHERE l.id = ?`,
    );
    const secs = this.sectorsOf(ids);
    return ids.map((id, i) => {
      const r = get.get(id) as Row;
      return {
        sectorsMs: secs.get(id) ?? [], sectorsExact: r.sectors_exact === 1,
        rank: i + 1, lapId: r.id as number, driverId: r.driver_id as number, driverName: r.driver_name as string, car: r.car as string,
        lapMs: r.lap_ms as number, maxSpeedKmh: (r.max_speed as number | null) ?? null, at: r.created_at as string,
        data: (r.data as Uint8Array | null) ? Buffer.from(r.data as Uint8Array) : null,
      };
    });
  }

  /** El mejor tiempo de vuelta (válida y que no sea salida de boxes) de una combinación, o null si aún no hay ninguno. */
  comboBestMs(track: string, layout: string, car: string): number | null {
    const r = this.db
      .prepare('SELECT MIN(lap_ms) AS b FROM laps WHERE track = ? AND layout = ? AND car = ? AND valid = 1')
      .get(track, layout, car) as Row;
    return r.b ?? null;
  }

  /** Cómo ha ido bajando el mejor tiempo de la sesión: cada vuelta válida que lo mejoró, en orden. */
  sessionProgression(sessionId: number): ProgressionStepDto[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.driver_id, d.name AS driver_name, l.car, l.lap_ms, l.created_at
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.session_id = ? AND l.valid = 1 AND l.hidden = 0 ORDER BY l.id`,
      )
      .all(sessionId) as Row[];
    const steps: ProgressionStepDto[] = [];
    let best: Row | null = null;
    for (const r of rows) {
      if (best && r.lap_ms >= best.lap_ms) continue;
      steps.push({
        lapId: r.id, driverId: r.driver_id, driverName: r.driver_name, car: r.car, lapMs: r.lap_ms,
        previousMs: best?.lap_ms ?? null, previousDriverName: best?.driver_name ?? null, at: r.created_at,
      });
      best = r;
    }
    return steps;
  }

  endSession(id: number) {
    const done = this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(new Date().toISOString(), id).changes;
    // Las sesiones no tienen contador de cambios propio: se «toca» su última vuelta para que MultiHowler reenvíe la sesión ya terminada.
    if (done) this.db.prepare('UPDATE laps SET created_at = created_at WHERE id = (SELECT MAX(id) FROM laps WHERE session_id = ? AND origin IS NULL)').run(id);
  }

  /** Copia consistente de la base de datos en `file` (para las copias de seguridad). */
  snapshotTo(file: string) { snapshotDatabase(this.db, file); }

  insertLap(l: NewLap, incidents: NewIncident[]): number {
    this.db.exec('BEGIN');
    try {
      const r = this.db
        .prepare(
          `INSERT INTO laps (session_id, driver_id, track, layout, car, lap_ms, cuts, grip, valid, invalid_reason, created_at, sectors_exact, source, max_speed, out_lap, pending, temp_air, temp_track, aids, weather)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          l.sessionId, l.driverId, l.track, l.layout, l.car, l.lapMs,
          l.cuts, l.grip, l.valid ? 1 : 0, l.invalidReason, l.createdAt ?? new Date().toISOString(),
          l.sectorsExact ? 1 : 0, l.source ?? 'live', l.maxSpeedKmh ?? null, l.outLap ? 1 : 0, l.pending ? 1 : 0,
          l.tempAir ?? null, l.tempTrack ?? null, l.aids && Object.keys(l.aids).length ? JSON.stringify(l.aids) : null, l.weather ?? null,
        );
      const lapId = Number(r.lastInsertRowid);
      const insSector = this.db.prepare('INSERT INTO lap_sectors (lap_id, idx, ms) VALUES (?, ?, ?)');
      l.sectorsMs.forEach((ms, idx) => { if (ms != null) insSector.run(lapId, idx, ms); });
      const ins = this.db.prepare('INSERT INTO lap_incidents (lap_id, kind, speed, rel_speed, other_driver_id) VALUES (?, ?, ?, ?, ?)');
      for (const i of incidents) ins.run(lapId, i.kind, i.speed, i.relSpeed ?? null, i.otherDriverId);
      this.db.exec('COMMIT');
      return lapId;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Vueltas de un piloto en una sesión con ese tiempo exacto (puede haber repetidas), en orden de registro. */
  lapsByTime(sessionId: number, driverId: number, lapMs: number): { id: number; exact: boolean }[] {
    const rows = this.db
      .prepare('SELECT id, sectors_exact FROM laps WHERE session_id = ? AND driver_id = ? AND lap_ms = ? ORDER BY id')
      .all(sessionId, driverId, lapMs) as Row[];
    return rows.map((r) => ({ id: r.id, exact: r.sectors_exact === 1 }));
  }

  /** Sustituye los sectores estimados de una vuelta por los medidos por el juego. */
  setExactSectors(lapId: number, sectorsMs: number[]) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM lap_sectors WHERE lap_id = ?').run(lapId);
      const ins = this.db.prepare('INSERT INTO lap_sectors (lap_id, idx, ms) VALUES (?, ?, ?)');
      sectorsMs.forEach((ms, idx) => ins.run(lapId, idx, ms));
      this.db.prepare('UPDATE laps SET sectors_exact = 1 WHERE id = ?').run(lapId);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  combos(server?: ServerFilter): ComboDto[] {
    const rows = this.db
      .prepare(
        `SELECT c.track, c.layout, c.car, c.laps, c.drivers, b.lap_ms AS best_ms, d.name AS best_driver
         FROM (SELECT track, layout, car, COUNT(*) AS laps, COUNT(DISTINCT driver_id) AS drivers, MAX(id) AS last_id
               FROM laps WHERE hidden = 0${serverSql(server)} GROUP BY track, layout, car) c
         LEFT JOIN laps b ON b.id = (SELECT l.id FROM laps l
                                     WHERE l.track = c.track AND l.layout = c.layout AND l.car = c.car AND l.valid = 1 AND l.hidden = 0${serverSql(server, 'l.')}
                                     ORDER BY l.lap_ms, l.id LIMIT 1)
         LEFT JOIN drivers d ON d.id = b.driver_id
         ORDER BY c.last_id DESC`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      track: r.track, layout: r.layout, car: r.car, laps: r.laps, drivers: r.drivers,
      bestMs: r.best_ms ?? null, bestDriverName: r.best_driver ?? null,
    }));
  }

  /** Sectores de varias vueltas de una vez: lapId -> [s1, s2, ...] (null donde no se midió). */
  private sectorsOf(lapIds: number[]): Map<number, (number | null)[]> {
    const out = new Map<number, (number | null)[]>();
    // Por lotes: SQLite limita el número de parámetros de una consulta.
    for (let i = 0; i < lapIds.length; i += 500) {
      const chunk = lapIds.slice(i, i + 500);
      const rows = this.db
        .prepare(`SELECT lap_id, idx, ms FROM lap_sectors WHERE lap_id IN (${chunk.map(() => '?').join(',')}) ORDER BY idx`)
        .all(...chunk) as Row[];
      for (const r of rows) {
        const arr = out.get(r.lap_id) ?? [];
        while (arr.length < r.idx) arr.push(null);
        arr[r.idx] = r.ms;
        out.set(r.lap_id, arr);
      }
    }
    return out;
  }

  /**
   * Tabla de tiempos de un circuito: una fila por piloto y coche con su mejor vuelta válida, ordenada por tiempo.
   * `cars` vacío = todos los coches jugados en el circuito. Con varios coches la tabla los mezcla.
   */
  records(track: string, layout: string, cars: string[], server?: ServerFilter): RecordsDto {
    const carFilter = cars.length ? `AND l.car IN (${cars.map(() => '?').join(',')})` : '';
    const args = [track, layout, ...cars];

    // Todo se agrega en SQL: un circuito popular puede tener decenas de miles de vueltas.
    const groups = this.db
      .prepare(
        `SELECT l.driver_id, d.name AS driver_name, l.car, COUNT(*) AS laps, SUM(l.valid) AS valid_laps,
                MIN(CASE WHEN l.valid = 1 THEN l.lap_ms END) AS best_ms
         FROM laps l JOIN drivers d ON d.id = l.driver_id
         WHERE l.track = ? AND l.layout = ? AND l.hidden = 0${serverSql(server, 'l.')} ${carFilter}
         GROUP BY l.driver_id, l.car HAVING best_ms IS NOT NULL`,
      )
      .all(...args) as Row[];

    // La mejor vuelta de cada grupo (la más antigua si hay empate) con su agarre, origen de sectores y fecha.
    const bestLap = this.db.prepare(
      `SELECT id, origin, grip, sectors_exact, max_speed, temp_air, temp_track, weather, aids, created_at FROM laps
       WHERE track = ? AND layout = ? AND driver_id = ? AND car = ? AND valid = 1 AND lap_ms = ? ORDER BY id LIMIT 1`,
    );
    const best = groups.map((g) => ({ g, lap: bestLap.get(track, layout, g.driver_id, g.car, g.best_ms) as Row }));
    const secs = this.sectorsOf(best.map((b) => b.lap.id));

    // Mejores sectores de cada piloto y coche (entre sus vueltas válidas), para la vuelta óptima.
    const personal = new Map<string, (number | null)[]>();
    for (const r of this.db
      .prepare(
        `SELECT l.driver_id, l.car, s.idx, MIN(s.ms) AS ms FROM lap_sectors s JOIN laps l ON l.id = s.lap_id
         WHERE l.track = ? AND l.layout = ? AND l.hidden = 0${serverSql(server, 'l.')} ${carFilter} AND l.valid = 1 GROUP BY l.driver_id, l.car, s.idx`,
      )
      .all(...args) as Row[]) {
      const key = `${r.driver_id}|${r.car}`;
      const arr = personal.get(key) ?? [];
      while (arr.length < r.idx) arr.push(null);
      arr[r.idx] = r.ms;
      personal.set(key, arr);
    }
    const sectorCount = Math.max(0, ...[...personal.values()].map((a) => a.length), ...[...secs.values()].map((a) => a.length));

    best.sort((a, b) => a.g.best_ms - b.g.best_ms || a.lap.id - b.lap.id);
    const sectorBestsMs: (number | null)[] = Array(sectorCount).fill(null);
    for (const { g } of best) {
      (personal.get(`${g.driver_id}|${g.car}`) ?? []).forEach((ms, i) => {
        if (ms != null && (sectorBestsMs[i] == null || ms < sectorBestsMs[i]!)) sectorBestsMs[i] = ms;
      });
    }

    const top = best[0]?.g.best_ms ?? 0;
    const entries: RecordEntryDto[] = best.map(({ g, lap }, i) => {
      const own = personal.get(`${g.driver_id}|${g.car}`) ?? [];
      const lapSectors = secs.get(lap.id) ?? [];
      return {
        position: i + 1,
        ...((b) => ({ serverBadge: b.text, serverBadgeBg: b.bg, serverBadgeFg: b.fg }))(this.multihowler.badgeOf(lap.origin ?? null)),
        driverId: g.driver_id,
        driverName: g.driver_name,
        car: g.car,
        lapMs: g.best_ms,
        sectorsMs: lapSectors,
        sectorsExact: lap.sectors_exact === 1,
        gapMs: g.best_ms - top,
        // Solo tiene sentido si la mejor vuelta tiene todos sus sectores medidos: así la suma nunca supera el tiempo de vuelta.
        optimalMs: sectorCount > 0 && lapSectors.filter((ms) => ms != null).length === sectorCount && own.length === sectorCount && own.every((ms) => ms != null)
          ? own.reduce((a, b) => a + b!, 0)
          : null,
        laps: g.laps,
        validLaps: g.valid_laps,
        grip: lap.grip ?? null,
        maxSpeedKmh: lap.max_speed ?? null,
        tempAir: lap.temp_air ?? null,
        tempTrack: lap.temp_track ?? null,
        weather: lap.weather ?? null,
        aids: parseAids(lap.aids),
        at: lap.created_at,
      };
    });
    const present = cars.length ? cars : (this.db.prepare('SELECT DISTINCT car FROM laps WHERE track = ? AND layout = ? ORDER BY car').all(track, layout) as Row[]).map((r) => r.car as string);
    return { track, layout, cars: present, sectorBestsMs, entries };
  }

  /**
   * Torre de tiempos de una sesión: por piloto, su mejor vuelta válida, su última vuelta y los colores de los
   * sectores de esa última vuelta (morado = mejor de la sesión, verde = su mejor personal, amarillo = normal).
   * `online` son los pilotos conectados ahora: salen aunque no hayan completado ninguna vuelta.
   */
  sessionTiming(session: SessionSummary | null, online: OnlineDriver[]): TimingDto {
    if (!session) return { session: null, sectorCount: 0, rows: [] };
    const laps = this.db
      .prepare(
        `SELECT l.id, l.driver_id, d.name AS driver_name, l.car, l.lap_ms, l.valid, l.out_lap, l.pending
         FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.session_id = ? AND l.hidden = 0 ORDER BY l.id`,
      )
      .all(session.id) as Row[];
    const secs = this.sectorsOf(laps.map((l) => l.id));
    const sectorCount = Math.max(0, ...[...secs.values()].map((a) => a.length));

    // Mejores sectores de la sesión (entre vueltas válidas) y mejores personales de cada piloto.
    const sessionBest: (number | null)[] = Array(sectorCount).fill(null);
    const personalBest = new Map<number, (number | null)[]>();
    for (const l of laps) {
      if (l.valid !== 1) continue; // las anuladas y las pendientes de revisión no pintan récords
      const own = personalBest.get(l.driver_id) ?? Array(sectorCount).fill(null);
      (secs.get(l.id) ?? []).forEach((ms, i) => {
        if (ms == null) return;
        if (sessionBest[i] == null || ms < sessionBest[i]!) sessionBest[i] = ms;
        if (own[i] == null || ms < own[i]!) own[i] = ms;
      });
      personalBest.set(l.driver_id, own);
    }

    const byDriver = new Map<number, Row[]>();
    for (const l of laps) (byDriver.get(l.driver_id) ?? byDriver.set(l.driver_id, []).get(l.driver_id)!).push(l);
    const onlineBy = new Map(online.map((o) => [o.driverId, o]));
    // Un piloto oculto no sale en la torre ni siquiera conectado.
    const hiddenIds = new Set((this.db.prepare('SELECT id FROM drivers WHERE hidden = 1').all() as Row[]).map((r) => r.id as number));
    const ids = new Set([...byDriver.keys(), ...online.map((o) => o.driverId)].filter((id) => !hiddenIds.has(id)));

    const rows: Omit<TimingRowDto, 'position' | 'gapMs'>[] = [...ids].map((driverId) => {
      const mine = byDriver.get(driverId) ?? [];
      const valid = mine.filter((l) => l.valid === 1);
      const best = valid.reduce<Row | null>((b, l) => (!b || l.lap_ms < b.lap_ms ? l : b), null);
      const last = mine.at(-1) ?? null;
      const on = onlineBy.get(driverId);
      const mark = (ms: number | null, i: number): { ms: number | null; kind: SectorKind } => {
        if (ms == null) return { ms: null, kind: 'none' };
        if (last!.valid !== 1) return { ms, kind: 'yellow' }; // una vuelta anulada no pinta récords
        if (ms === sessionBest[i]) return { ms, kind: 'purple' };
        if (ms === personalBest.get(driverId)?.[i]) return { ms, kind: 'green' };
        return { ms, kind: 'yellow' };
      };
      const lastSecs = last ? secs.get(last.id) ?? [] : [];
      return {
        driverId,
        driverName: on?.name ?? mine[0]?.driver_name ?? (this.db.prepare('SELECT name FROM drivers WHERE id = ?').get(driverId) as Row).name,
        carId: on?.carId ?? null,
        car: on?.car ?? mine.at(-1)?.car ?? '',
        online: !!on,
        bestMs: best?.lap_ms ?? null,
        lastMs: last?.lap_ms ?? null,
        lastValid: last?.valid === 1,
        lastPending: last?.pending === 1,
        laps: mine.length,
        lastSectors: Array.from({ length: sectorCount }, (_, i) => mark(lastSecs[i] ?? null, i)),
      };
    });

    rows.sort((a, b) => (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity) || Number(b.online) - Number(a.online) || a.driverName.localeCompare(b.driverName));
    const top = rows[0]?.bestMs ?? null;
    return {
      session,
      sectorCount,
      rows: rows.map((r, i) => ({ ...r, position: i + 1, gapMs: r.bestMs != null && top != null ? r.bestMs - top : null })),
    };
  }

  /**
   * Récords vigentes: uno por combinación (circuito + coche), el más reciente primero. Cada uno es la mejor vuelta
   * válida de su combinación; `previous*` es el récord que sustituyó (vacío si fue la primera vuelta válida).
   */
  recentRecords(limit: number): RecordDto[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.driver_id, d.name AS driver_name, l.track, l.layout, l.car, l.lap_ms, l.created_at,
                (SELECT MIN(p.lap_ms) FROM laps p
                  WHERE p.track = l.track AND p.layout = l.layout AND p.car = l.car AND p.valid = 1 AND p.id < l.id) AS prev_ms
         FROM laps l JOIN drivers d ON d.id = l.driver_id
         WHERE l.valid = 1 AND l.hidden = 0
           AND l.id = (SELECT b.id FROM laps b WHERE b.track = l.track AND b.layout = l.layout AND b.car = l.car AND b.valid = 1 AND b.hidden = 0
                       ORDER BY b.lap_ms, b.id LIMIT 1)
         ORDER BY l.id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    const prevHolder = this.db.prepare(
      `SELECT d.name FROM laps p JOIN drivers d ON d.id = p.driver_id
       WHERE p.track = ? AND p.layout = ? AND p.car = ? AND p.valid = 1 AND p.id < ? AND p.lap_ms = ? ORDER BY p.id LIMIT 1`,
    );
    return rows.map((r) => {
      const prev = r.prev_ms == null ? undefined : (prevHolder.get(r.track, r.layout, r.car, r.id, r.prev_ms) as Row | undefined);
      return {
        lapId: r.id, driverId: r.driver_id, driverName: r.driver_name, track: r.track, layout: r.layout, car: r.car,
        lapMs: r.lap_ms, previousMs: r.prev_ms ?? null, previousDriverName: prev?.name ?? null, at: r.created_at,
      };
    });
  }

  recentLaps(limit: number): RecentLapDto[] {
    const rows = this.db
      .prepare(`SELECT l.*, d.name AS driver_name FROM laps l JOIN drivers d ON d.id = l.driver_id WHERE l.hidden = 0 ORDER BY l.id DESC LIMIT ?`)
      .all(limit) as Row[];
    const secs = this.sectorsOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id, driverId: r.driver_id, driverName: r.driver_name,
      track: r.track, layout: r.layout, car: r.car, lapMs: r.lap_ms,
      sectorsMs: secs.get(r.id) ?? [], sectorsExact: r.sectors_exact === 1, valid: r.valid === 1, invalidReason: r.invalid_reason, at: r.created_at,
    }));
  }
}
