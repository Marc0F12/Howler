import type { DatabaseSync } from 'node:sqlite';
import { NO_RACE_PENALTIES, SCHEDULE_KINDS, validateBadge, type BadgeDesign, type RacePenaltyRules, type ScheduleItem } from '@howler/shared';
import type { Penalties } from './penalties';
import {
  computeStandings, roundScores,
  type Adjustment, type ChampionshipDto, type ChampionshipInput, type ChampionshipModDto, type ChampionshipModInput, type ChampionshipRoundDto, type ChampionshipStatus,
  type ChampionshipSummaryDto, type RosterEntry, type RoundResult, type ScoringConfig, type SessionCandidateDto,
} from '@howler/shared';

type Row = Record<string, any>;

/** Calendario guardado en JSON; lo que no valga se descarta (nunca falla). */
function parseSchedule(raw: unknown): ScheduleItem[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return null;
    const kinds: readonly string[] = SCHEDULE_KINDS;
    const out = j.filter((x): x is ScheduleItem => !!x && typeof x === 'object' && kinds.includes((x as ScheduleItem).kind));
    return out.length > 0 ? out : null;
  } catch { return null; }
}

/** Diseño de insignia guardado en JSON; si no vale, se ignora (nunca falla). */
function parseBadge(raw: unknown): BadgeDesign | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { const r = validateBadge(JSON.parse(raw)); return r.ok ? r.badge : null; } catch { return null; }
}
const badgeJson = (input: { badgeDesign?: BadgeDesign | null }): string | null => {
  if (input.badgeDesign == null) return null;
  const r = validateBadge(input.badgeDesign);
  if (!r.ok) throw new Error('El diseño de la insignia no es válido: ' + r.error);
  return JSON.stringify(r.badge);
};

const RACE = 3;
const QUALI = 2;

/** Campeonatos: definición, inscritos, pruebas, asignación de sesiones y clasificación (el cálculo lo hace `computeStandings`). */
export class Championships {
  private autoRules: () => RacePenaltyRules = () => NO_RACE_PENALTIES;

  constructor(private db: DatabaseSync, private penalties: Penalties) {}

  /** De dónde salen las penalizaciones automáticas (la configuración de Howler, siempre la vigente). */
  setAutoPenalties(provider: () => RacePenaltyRules) { this.autoRules = provider; }
  private skinSource: ((driverId: number) => { car: string; skin: string | null } | null) | null = null;
  /** De dónde sacar la skin de un inscrito al que no se le asignó una en el campeonato (la lista de coches del servidor). */
  setSkinSource(provider: (driverId: number) => { car: string; skin: string | null } | null) { this.skinSource = provider; }

  private tx<T>(fn: () => T): T {
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

  // ───────────────────────── Crear / editar / borrar ─────────────────────────

  /** Crea (`id` null) o sustituye la definición entera. Las carreras con `id` conservan sus sesiones asignadas. */
  save(id: number | null, input: ChampionshipInput): number {
    if (id != null) this.assertOwn(id);
    const teamKeys = new Set(input.teams.map((t) => t.key));
    if (teamKeys.size !== input.teams.length) throw new Error('Hay dos equipos con la misma clave.');
    const seen = new Set<number>();
    for (const e of input.entries) {
      if (seen.has(e.driverId)) throw new Error('Un piloto está inscrito dos veces.');
      seen.add(e.driverId);
      if (e.teamKey != null && !teamKeys.has(e.teamKey)) throw new Error('Un piloto apunta a un equipo que no existe.');
    }
    return this.tx(() => {
      let cid = id;
      if (cid == null) {
        cid = Number(
          this.db
            .prepare('INSERT INTO championships (name, description, image_url, image_fit, badge_design, format, status, scoring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(input.name, input.description ?? '', input.imageUrl ?? null, input.imageFit ?? null, badgeJson(input), input.format, input.status ?? 'draft', JSON.stringify(input.scoring), new Date().toISOString()).lastInsertRowid,
        );
      } else {
        if (!this.db.prepare('SELECT 1 FROM championships WHERE id = ?').get(cid)) throw new Error('Ese campeonato no existe.');
        this.db
          .prepare('UPDATE championships SET name = ?, description = ?, image_url = ?, image_fit = ?, badge_design = ?, format = ?, status = ?, scoring = ? WHERE id = ?')
          .run(input.name, input.description ?? '', input.imageUrl ?? null, input.imageFit ?? null, badgeJson(input), input.format, input.status ?? this.statusOf(cid), JSON.stringify(input.scoring), cid);
        this.db.prepare('DELETE FROM championship_entries WHERE championship_id = ?').run(cid);
        this.db.prepare('DELETE FROM championship_teams WHERE championship_id = ?').run(cid);
        this.db.prepare('DELETE FROM championship_mods WHERE championship_id = ?').run(cid);
        const keep = input.rounds.map((r) => r.id).filter((x): x is number => x != null);
        const existing = (this.db.prepare('SELECT id FROM championship_rounds WHERE championship_id = ?').all(cid) as Row[]).map((r) => r.id as number);
        for (const rid of existing) if (!keep.includes(rid)) this.db.prepare('DELETE FROM championship_rounds WHERE id = ?').run(rid);
      }
      const teamIds = new Map<string, number>();
      for (const t of input.teams) {
        teamIds.set(t.key, Number(this.db.prepare('INSERT INTO championship_teams (championship_id, name, color) VALUES (?, ?, ?)').run(cid, t.name, t.color).lastInsertRowid));
      }
      for (const e of input.entries) {
        this.db
          .prepare('INSERT INTO championship_entries (championship_id, driver_id, team_id, color, car, skin) VALUES (?, ?, ?, ?, ?, ?)')
          .run(cid, e.driverId, e.teamKey != null ? teamIds.get(e.teamKey)! : null, e.color ?? null, e.car ?? null, e.car ? (e.skin ?? null) : null);
      }
      const addMod = (m: ChampionshipModInput, roundId: number | null) =>
        this.db.prepare('INSERT INTO championship_mods (championship_id, round_id, name, kind, url, note, image_url, specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(cid, roundId, m.name, m.kind, m.url, m.note ?? null, m.imageUrl ?? null, JSON.stringify(m.specs ?? {}));
      input.rounds.forEach((r, i) => {
        let rid = r.id ?? null;
        const cars = JSON.stringify(r.cars ?? []);
        // Con calendario completo, las tres fechas clásicas salen de él (la asignación de sesiones y los avisos siguen usándolas)
        const sched = r.schedule && r.schedule.length > 0 ? r.schedule : null;
        const when = (k: string, fallback: string | null | undefined) => (sched ? (sched.find((x) => x.kind === k)?.at ?? null) : (fallback ?? null));
        const [pAt, qAt, rAt] = [when('practice', r.practiceAt), when('quali', r.qualiAt), when('race', r.raceAt)];
        const schedJson = sched ? JSON.stringify(sched) : null;
        if (rid != null) {
          const ok = this.db.prepare('UPDATE championship_rounds SET number = ?, track = ?, layout = ?, cars = ?, practice_at = ?, quali_at = ?, race_at = ?, weather = ?, schedule = ? WHERE id = ? AND championship_id = ?')
            .run(i + 1, r.track, r.layout ?? '', cars, pAt, qAt, rAt, r.weather ?? null, schedJson, rid, cid);
          if (!ok.changes) throw new Error('Una de las carreras no pertenece a este campeonato.');
        } else {
          rid = Number(this.db.prepare('INSERT INTO championship_rounds (championship_id, number, track, layout, cars, practice_at, quali_at, race_at, weather, schedule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(cid, i + 1, r.track, r.layout ?? '', cars, pAt, qAt, rAt, r.weather ?? null, schedJson).lastInsertRowid);
        }
        for (const m of r.mods ?? []) addMod(m, rid);
      });
      for (const m of input.mods ?? []) addMod(m, null);
      return cid;
    });
  }

  /** Las copias de campeonatos de otro Howler son de solo lectura. */
  private assertOwn(id: number) {
    if ((this.db.prepare('SELECT origin FROM championships WHERE id = ?').get(id) as Row | undefined)?.origin != null) throw new Error('Es una copia de un campeonato de otro Howler: solo lectura.');
  }

  private statusOf(id: number): ChampionshipStatus {
    return (this.db.prepare('SELECT status FROM championships WHERE id = ?').get(id) as Row).status;
  }

  /** Imágenes de portada en uso (valores de `image_url`), para limpiar las subidas que ya no usa nadie. */
  imageRefs(): string[] {
    return (this.db.prepare('SELECT image_url FROM championships WHERE image_url IS NOT NULL').all() as Row[]).map((r) => r.image_url as string);
  }

  setStatus(id: number, status: ChampionshipStatus): boolean {
    this.assertOwn(id);
    return this.db.prepare('UPDATE championships SET status = ? WHERE id = ?').run(status, id).changes > 0;
  }

  remove(id: number): boolean {
    this.assertOwn(id);
    return this.db.prepare('DELETE FROM championships WHERE id = ?').run(id).changes > 0;
  }

  addAdjustment(id: number, a: { roundId: number; driverId: number; points: number; reason: string }): number {
    this.assertOwn(id);
    const ok = this.db.prepare('SELECT 1 FROM championship_rounds WHERE id = ? AND championship_id = ?').get(a.roundId, id);
    if (!ok) throw new Error('Esa carrera no es de este campeonato.');
    return Number(this.db.prepare('INSERT INTO championship_adjustments (championship_id, round_id, driver_id, points, reason) VALUES (?, ?, ?, ?, ?)').run(id, a.roundId, a.driverId, a.points, a.reason).lastInsertRowid);
  }

  removeAdjustment(id: number, adjustmentId: number): boolean {
    this.assertOwn(id);
    return this.db.prepare('DELETE FROM championship_adjustments WHERE id = ? AND championship_id = ?').run(adjustmentId, id).changes > 0;
  }

  // ───────────────────────── Sesiones ─────────────────────────

  /** Asigna (o quita con `sessionId` null) la sesión de carrera o de clasificación de una prueba. */
  assign(id: number, roundId: number, kind: 'race' | 'quali', sessionId: number | null): boolean {
    this.assertOwn(id);
    if (sessionId != null) {
      const s = this.db.prepare('SELECT type FROM sessions WHERE id = ?').get(sessionId) as Row | undefined;
      if (!s) throw new Error('Esa sesión no existe.');
      if (s.type !== (kind === 'race' ? RACE : QUALI)) throw new Error(kind === 'race' ? 'Esa sesión no es una carrera.' : 'Esa sesión no es una clasificación.');
      // una sesión solo puede ser una prueba de cada campeonato
      this.db.prepare(`UPDATE championship_rounds SET ${kind}_session_id = NULL WHERE championship_id = ? AND ${kind}_session_id = ?`).run(id, sessionId);
    }
    const r = this.db.prepare(`UPDATE championship_rounds SET ${kind}_session_id = ? WHERE id = ? AND championship_id = ?`).run(sessionId, roundId, id);
    return r.changes > 0;
  }

  private enrolledIds(id: number): number[] {
    return (this.db.prepare('SELECT driver_id FROM championship_entries WHERE championship_id = ?').all(id) as Row[]).map((r) => r.driver_id);
  }

  /** Cuántos inscritos dieron vueltas en cada sesión. */
  private enrolledInSession(id: number, sessionId: number): number {
    return (this.db.prepare(`SELECT COUNT(DISTINCT l.driver_id) AS n FROM laps l JOIN championship_entries e ON e.driver_id = l.driver_id AND e.championship_id = ? WHERE l.session_id = ?`).get(id, sessionId) as Row).n;
  }

  /**
   * Asigna solas las sesiones que encajan sin duda con la siguiente prueba pendiente: mismo circuito y layout, y al menos
   * dos inscritos (o todos, si hay menos de dos) con vueltas. Solo campeonatos activos y sesiones posteriores a su creación.
   * Lo demás queda como candidato para confirmar a mano.
   */
  autoAssign(id: number): number {
    // Se lee desde la web pública: solo se vuelve a mirar si ha cambiado algo que pueda afectar (vueltas, sesiones, pruebas, inscritos).
    const before = this.assignSignature(id);
    if (this.assignSeen.get(id) === before) return 0;
    const n = this.runAutoAssign(id);
    this.assignSeen.set(id, n ? this.assignSignature(id) : before);
    return n;
  }

  private assignSeen = new Map<number, string>();

  private assignSignature(id: number): string {
    const r = this.db.prepare(
      `SELECT (SELECT MAX(id) FROM laps) AS l, (SELECT MAX(id) FROM sessions) AS s,
              (SELECT group_concat(id || track || layout || ifnull(race_session_id, '') || '/' || ifnull(quali_session_id, ''), ';') FROM championship_rounds WHERE championship_id = ?) AS r,
              (SELECT COUNT(*) FROM championship_entries WHERE championship_id = ?) AS e,
              (SELECT status FROM championships WHERE id = ?) AS st`,
    ).get(id, id, id) as Row;
    return `${r.l}|${r.s}|${r.r}|${r.e}|${r.st}`;
  }

  private runAutoAssign(id: number): number {
    if ((this.db.prepare('SELECT origin FROM championships WHERE id = ?').get(id) as Row | undefined)?.origin != null) return 0;
    const c = this.db.prepare('SELECT status, created_at FROM championships WHERE id = ?').get(id) as Row | undefined;
    if (!c || c.status !== 'active') return 0;
    const need = Math.min(2, this.enrolledIds(id).length);
    if (need === 0) return 0;
    let assigned = 0;
    const sessions = this.db
      .prepare(`SELECT id, track, layout, type FROM sessions s WHERE s.origin IS NULL AND type IN (${QUALI}, ${RACE}) AND started_at >= ?
                AND NOT EXISTS (SELECT 1 FROM championship_rounds r WHERE r.championship_id = ? AND (r.race_session_id = s.id OR r.quali_session_id = s.id))
                ORDER BY id`)
      .all(c.created_at, id) as Row[];
    for (const s of sessions) {
      if (this.enrolledInSession(id, s.id) < need) continue;
      const col = s.type === RACE ? 'race_session_id' : 'quali_session_id';
      const round = this.db
        .prepare(`SELECT id FROM championship_rounds WHERE championship_id = ? AND track = ? AND layout = ? AND race_session_id IS NULL AND ${col} IS NULL ORDER BY number LIMIT 1`)
        .get(id, s.track, s.layout) as Row | undefined;
      if (!round) continue;
      this.db.prepare(`UPDATE championship_rounds SET ${col} = ? WHERE id = ?`).run(s.id, round.id);
      assigned++;
    }
    return assigned;
  }

  /** Sesiones de carrera y clasificación con inscritos que no están en ninguna prueba: el panel las ofrece para confirmar. */
  candidates(id: number, limit = 20): SessionCandidateDto[] {
    if ((this.db.prepare('SELECT origin FROM championships WHERE id = ?').get(id) as Row | undefined)?.origin != null) return [];
    const rows = this.db
      .prepare(`SELECT s.id, s.track, s.layout, s.type, s.started_at FROM sessions s
                WHERE s.origin IS NULL AND s.type IN (${QUALI}, ${RACE})
                AND NOT EXISTS (SELECT 1 FROM championship_rounds r WHERE r.championship_id = ? AND (r.race_session_id = s.id OR r.quali_session_id = s.id))
                ORDER BY s.id DESC LIMIT ?`)
      .all(id, limit * 4) as Row[];
    const out: SessionCandidateDto[] = [];
    for (const s of rows) {
      const n = this.enrolledInSession(id, s.id);
      if (n === 0) continue;
      const round = this.db.prepare('SELECT number FROM championship_rounds WHERE championship_id = ? AND track = ? AND layout = ? AND race_session_id IS NULL ORDER BY number LIMIT 1').get(id, s.track, s.layout) as Row | undefined;
      out.push({ sessionId: s.id, track: s.track, layout: s.layout, type: s.type, startedAt: s.started_at, enrolledDrivers: n, suggestedRound: round?.number ?? null });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ───────────────────────── Resultados y clasificación ─────────────────────────

  /**
   * Resultado de una sesión de carrera para los inscritos. El puesto sale de las vueltas guardadas (más vueltas, y a igualdad,
   * menos tiempo total) y se cuenta entre los inscritos. Si la prueba limita coches, solo valen las vueltas con esos coches.
   */
  private raceResults(sessionId: number, enrolled: Set<number>, cars: string[]): RoundResult[] {
    const rows = this.db.prepare('SELECT driver_id, car, lap_ms, valid, out_lap, max_speed FROM laps WHERE session_id = ?').all(sessionId) as Row[];
    const by = new Map<number, Row[]>();
    for (const r of rows) {
      if (!enrolled.has(r.driver_id) || (cars.length && !cars.includes(r.car))) continue;
      (by.get(r.driver_id) ?? by.set(r.driver_id, []).get(r.driver_id)!).push(r);
    }
    const manual = this.penalties.manualFor(sessionId);
    const auto = this.penalties.autoFor(sessionId, this.autoRules(), cars);
    const res = [...by.entries()].map(([driverId, laps]) => {
      const good = laps.filter((l) => l.valid === 1);
      const normal = good.filter((l) => l.out_lap === 0).map((l) => l.lap_ms as number);
      const mean = normal.length ? normal.reduce((a, b) => a + b, 0) / normal.length : null;
      const std = mean != null && normal.length > 1 ? Math.sqrt(normal.reduce((a, b) => a + (b - mean) ** 2, 0) / normal.length) : null;
      const speeds = laps.map((l) => l.max_speed).filter((v): v is number => v != null);
      const m = manual.get(driverId);
      const total = laps.reduce((a, l) => a + l.lap_ms, 0);
      return {
        driverId, total, penalty: (m?.ms ?? 0) + (auto.get(driverId) ?? 0), dsq: m?.dsq ?? false, count: laps.length,
        bestLapMs: good.length ? Math.min(...good.map((l) => l.lap_ms as number)) : null,
        avgLapMs: mean != null ? Math.round(mean) : null, consistencyMs: std != null ? Math.round(std) : null,
        topSpeedKmh: speeds.length ? Math.max(...speeds) : null,
      };
    });
    // Gana quien más vueltas da y, a igualdad, el de menos tiempo total CON las penalizaciones; un descalificado queda fuera.
    const ranked = res.filter((r) => !r.dsq).sort((a, b) => b.count - a.count || a.total + a.penalty - (b.total + b.penalty));
    const out: RoundResult[] = ranked.map((r, i) => ({
      driverId: r.driverId, finishPos: i + 1, qualiPos: null, bestLapMs: r.bestLapMs, avgLapMs: r.avgLapMs,
      consistencyMs: r.consistencyMs, laps: r.count, topSpeedKmh: r.topSpeedKmh, totalMs: r.total, penaltyMs: r.penalty, dsq: false,
    }));
    for (const r of res.filter((x) => x.dsq)) {
      out.push({ driverId: r.driverId, finishPos: null, qualiPos: null, bestLapMs: r.bestLapMs, avgLapMs: r.avgLapMs, consistencyMs: r.consistencyMs, laps: r.count, topSpeedKmh: r.topSpeedKmh, totalMs: r.total, penaltyMs: r.penalty, dsq: true });
    }
    return out;
  }

  private qualiPositions(sessionId: number, enrolled: Set<number>, cars: string[]): Map<number, number> {
    const rows = this.db
      .prepare('SELECT driver_id, car, MIN(lap_ms) AS best FROM laps WHERE session_id = ? AND valid = 1 GROUP BY driver_id, car')
      .all(sessionId) as Row[];
    const best = new Map<number, number>();
    for (const r of rows) if (enrolled.has(r.driver_id) && (!cars.length || cars.includes(r.car))) best.set(r.driver_id, Math.min(best.get(r.driver_id) ?? Infinity, r.best));
    const order = [...best.entries()].sort((a, b) => a[1] - b[1]);
    return new Map(order.map(([id], i) => [id, i + 1]));
  }

  // ───────────────────────── Lectura ─────────────────────────

  list(includeDrafts: boolean): ChampionshipSummaryDto[] {
    const rows = this.db.prepare(`SELECT id FROM championships ${includeDrafts ? '' : "WHERE status != 'draft'"} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, id DESC`).all() as Row[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean).map(({ scoring: _s, teams: _t, entries: _e, roundList: _r, mods: _m, standings: _st, adjustments: _a, ...summary }) => summary);
  }

  /** `null` si no existe. Con `publicOnly`, un borrador tampoco existe. */
  get(id: number, publicOnly = false): ChampionshipDto | null {
    const c = this.db.prepare('SELECT * FROM championships WHERE id = ?').get(id) as Row | undefined;
    if (!c || (publicOnly && c.status === 'draft')) return null;
    this.autoAssign(id);
    const scoring = JSON.parse(c.scoring) as ScoringConfig;
    const teams = (this.db.prepare('SELECT id, name, color FROM championship_teams WHERE championship_id = ? ORDER BY id').all(id) as Row[]).map((t) => ({ id: t.id as number, name: t.name as string, color: t.color as string }));
    const entries = (this.db.prepare(`SELECT e.driver_id, d.name, e.team_id, e.color, e.car, e.skin FROM championship_entries e JOIN drivers d ON d.id = e.driver_id WHERE e.championship_id = ? ORDER BY d.name`).all(id) as Row[])
      .map((e) => {
        const own = { car: (e.car as string | null) ?? null, skin: (e.skin as string | null) ?? null };
        const fallback = own.car ? null : this.skinSource?.(e.driver_id as number) ?? null; // sin asignar aquí: la de la lista de coches del servidor
        return { driverId: e.driver_id as number, name: e.name as string, teamId: (e.team_id as number | null) ?? null, color: (e.color as string | null) ?? null, car: own.car ?? fallback?.car ?? null, skin: own.car ? own.skin : fallback?.skin ?? null };
      });
    const enrolled = new Set(entries.map((e) => e.driverId));
    const modRows = this.db.prepare('SELECT id, round_id, name, kind, url, note, image_url, specs FROM championship_mods WHERE championship_id = ? ORDER BY id').all(id) as Row[];
    const modDto = (m: Row): ChampionshipModDto => ({ id: m.id, name: m.name, kind: m.kind, url: m.url, note: m.note ?? null, imageUrl: m.image_url ?? null, specs: JSON.parse(m.specs || '{}') });
    const roundRows = this.db.prepare('SELECT * FROM championship_rounds WHERE championship_id = ? ORDER BY number').all(id) as Row[];

    const results: (RoundResult[] | null)[] = [];
    const roundList: ChampionshipRoundDto[] = roundRows.map((r) => {
      const cars = JSON.parse(r.cars) as string[];
      let res: RoundResult[] | null = null;
      if (r.race_session_id != null) {
        res = this.raceResults(r.race_session_id, enrolled, cars);
        if (r.quali_session_id != null) {
          const q = this.qualiPositions(r.quali_session_id, enrolled, cars);
          res = res.map((x) => ({ ...x, qualiPos: q.get(x.driverId) ?? null }));
        }
        if (res.length === 0) res = null;
      }
      results.push(res);
      return {
        id: r.id, number: r.number, track: r.track, layout: r.layout, cars, practiceAt: r.practice_at ?? null, qualiAt: r.quali_at ?? null, raceAt: r.race_at ?? null,
        weather: r.weather ?? null, schedule: parseSchedule(r.schedule),
        raceSessionId: r.race_session_id ?? null, qualiSessionId: r.quali_session_id ?? null, played: res != null,
        mods: modRows.filter((m) => m.round_id === r.id).map(modDto), results: [],
      };
    });

    const adjRows = this.db.prepare('SELECT id, round_id, driver_id, points, reason FROM championship_adjustments WHERE championship_id = ? ORDER BY id').all(id) as Row[];
    const idx = new Map(roundRows.map((r, i) => [r.id as number, i]));
    const adjustments: Adjustment[] = adjRows.filter((a) => idx.has(a.round_id)).map((a) => ({ driverId: a.driver_id, round: idx.get(a.round_id)!, points: a.points }));
    const roster: RosterEntry[] = entries.map((e) => ({ driverId: e.driverId, teamId: e.teamId }));
    const standings = computeStandings(scoring, roster, results, adjustments);

    roundList.forEach((r, i) => {
      const res = results[i];
      if (!res) return;
      const pts = roundScores(scoring, res);
      const manual = r.raceSessionId != null ? this.penalties.manualFor(r.raceSessionId) : new Map<number, { notes: string[] }>();
      r.results = res.map((x) => ({
        driverId: x.driverId, finishPos: x.finishPos, qualiPos: x.qualiPos ?? null, bestLapMs: x.bestLapMs, laps: x.laps,
        totalMs: x.totalMs != null ? x.totalMs + (x.penaltyMs ?? 0) : null, penaltyMs: x.penaltyMs ?? 0, dsq: x.dsq ?? false, notes: manual.get(x.driverId)?.notes ?? [],
        points: (pts.get(x.driverId) ?? 0) + adjustments.filter((a) => a.round === i && a.driverId === x.driverId).reduce((s, a) => s + a.points, 0),
      }));
    });

    const played = roundList.filter((r) => r.played).length;
    const next = roundList.find((r) => !r.played) ?? null;
    const lead = played > 0 ? standings.drivers[0] : undefined;
    return {
      id: c.id, name: c.name, description: c.description, imageUrl: c.image_url ?? null, imageFit: c.image_fit === 'cover' || c.image_fit === 'contain' ? c.image_fit : null, badgeDesign: parseBadge(c.badge_design), teamColors: teams.slice(0, 2).map((x) => x.color), format: c.format, status: c.status,
      sharedFrom: c.origin == null ? null : ((this.db.prepare('SELECT name FROM mh_origins WHERE uuid = ?').get(c.origin) as Row | undefined)?.name ?? (this.db.prepare('SELECT name FROM mh_peers WHERE peer_uuid = ? LIMIT 1').get(c.origin) as Row | undefined)?.name ?? 'Otro Howler'),
      rounds: roundList.length, played, participants: entries.length,
      next: next ? { number: next.number, track: next.track, layout: next.layout, raceAt: next.raceAt } : null,
      leader: lead ? { driverId: lead.id, name: entries.find((e) => e.driverId === lead.id)?.name ?? '' } : null,
      scoring, teams, entries, roundList, mods: modRows.filter((m) => m.round_id == null).map(modDto), standings,
      adjustments: adjRows.map((a) => ({ id: a.id, driverId: a.driver_id, round: idx.get(a.round_id) ?? -1, points: a.points, reason: a.reason })),
    };
  }
}
