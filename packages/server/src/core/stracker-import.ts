import { DatabaseSync } from 'node:sqlite';
import type { ImportReportDto, PlayerChoice, StrackerApplyInput, StrackerPlayerDto, StrackerPreviewDto, StrackerSeasonDto, StrackerTrackDto, ScoringConfig, LapRules } from '@howler/shared';
import { ratioToPct, sanitizeTemp, SCORING_PRESETS, type LapAids, type SessionConditions } from '@howler/shared';
import type { Repository } from '../db/repository';
import type { ImportedLap } from '../db/imports';
import { judgeWithReview } from './lap-rules';

/**
 * Importador de stracker (`stracker.db3`, SQLite). Se abre SIEMPRE en solo lectura. Lo que trae y lo que no:
 *  - Sí: sesiones (tipo, fechas), vueltas (tiempo, validez, cortes, nº de choques, velocidad máxima, agarre, fecha) y, si los hay,
 *    campeonatos con su tabla de puntos.
 *  - No: sectores (con AssettoServer stracker no los guarda), velocidad de los choques (solo cuenta cuántos), trayectorias.
 *  - El Steam ID viene cifrado (hash): no se puede enlazar con tus pilotos por Steam, solo por nombre y con tu confirmación.
 * La validez se vuelve a decidir con las reglas de Howler (única fuente de verdad), no con la bandera de stracker.
 */

const SOURCE = 'stracker';
const REQUIRED = ['Players', 'Tracks', 'Cars', 'Session', 'PlayerInSession', 'Lap'];
const MAX_INCIDENTS_PER_LAP = 20;
const OUT_LAP_FACTOR = 1.15;

type Row = Record<string, any>;

export function openStracker(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => r.name as string));
    const missing = REQUIRED.filter((t) => !have.has(t));
    if (missing.length) throw new Error(`Esto no parece una base de datos de stracker (faltan: ${missing.join(', ')}).`);
    return db;
  } catch (e) {
    db.close();
    if (e instanceof Error && /not a database|file is not/i.test(e.message)) throw new Error('El archivo no es una base de datos SQLite válida.');
    throw e;
  }
}

/** «csp/0/../ks_silverstone-gp» → «ks_silverstone-gp» (como hace el tracker con lo que manda AssettoServer). */
export const stripCspPath = (raw: string) => raw.split('/').pop() || raw;

export interface TrackContext {
  /** Circuitos y layouts que ya hay en la base de datos de Howler. */
  known: { track: string; layout: string }[];
  /** ¿Existe en el contenido de AC instalado? */
  inContent?: (track: string, layout: string) => boolean;
}

/**
 * stracker junta circuito y layout con «-» («ks_silverstone-gp»). Se separa mirando lo que Howler o el contenido de AC conocen;
 * si no se sabe, se corta en el ÚLTIMO «-» (los layouts rara vez llevan guion). `known` indica si hubo alguna confirmación.
 */
export function resolveStrackerTrack(raw: string, ctx: TrackContext): { track: string; layout: string; known: boolean } {
  const full = stripCspPath(raw);
  const cuts = [...full.matchAll(/-/g)].map((m) => m.index!);
  const candidates: { track: string; layout: string }[] = [{ track: full, layout: '' }, ...cuts.map((i) => ({ track: full.slice(0, i), layout: full.slice(i + 1) }))];
  const hit = (c: { track: string; layout: string }) => ctx.known.some((k) => k.track === c.track && k.layout === c.layout) || (ctx.inContent?.(c.track, c.layout) ?? false);
  const found = candidates.find(hit);
  if (found) return { ...found, known: true };
  const last = cuts.at(-1);
  return last == null ? { track: full, layout: '', known: false } : { track: full.slice(0, last), layout: full.slice(last + 1), known: false };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Ayudas de una vuelta: las de la propia vuelta (`Aid*`) y, si no las hay, las de la sesión del jugador (`ABS`, `TractionControl`...).
 * Solo se guarda lo que stracker sabía: con AssettoServer todo viene vacío y la vuelta queda sin ayudas conocidas.
 */
export function strackerAids(l: Row): LapAids | null {
  const pick = (lapKey: string, sessKey: string) => num(l[lapKey]) ?? num(l[sessKey]);
  const a: LapAids = {
    abs: pick('AidABS', 'ABS'), tc: pick('AidTC', 'TractionControl'), blip: pick('AidAutoBlib', 'AutoBlib'), brake: pick('AidAutoBrake', 'AutoBrake'),
    clutch: pick('AidAutoClutch', 'AutoClutch'), shift: pick('AidAutoShift', 'AutoShift'), line: pick('AidIdealLine', 'IdealLine'),
    stability: pick('AidStabilityControl', 'StabilityControl'), slip: num(l.AidSlipStream), blankets: num(l.AidTyreBlankets),
  };
  const out = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as LapAids;
  return Object.keys(out).length ? out : null;
}

const sessionKey = (s: Row) => `${s.StartTimeDate}|${s.Track}|${s.SessionType}`;
const sessionType = (t: string) => (/^race/i.test(t) ? 3 : /^qual/i.test(t) ? 2 : 1);
const isoOf = (sec: number | null) => (sec != null && sec > 0 ? new Date(sec * 1000).toISOString() : null);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Los ajustes de la sesión que guarda stracker (1 = 100 %); las columnas que falten en versiones antiguas se leen como vacías. */
function sessionsSql(db: DatabaseSync): string {
  const have = new Set((db.prepare('PRAGMA table_info(Session)').all() as Row[]).map((r) => r.name as string));
  const sel = ['FuelRate', 'Damage', 'TyreWearFactor', 'AllowedTyresOut'].map((c) => `${have.has(c) ? `s.${c}` : 'NULL'} AS ${c}`);
  return `SELECT s.SessionId, s.SessionType, s.StartTimeDate, s.EndTimeDate, t.Track, ${sel.join(', ')} FROM Session s JOIN Tracks t ON t.TrackId = s.TrackId ORDER BY s.SessionId`;
}

export function strackerConditions(s: Row): SessionConditions | null {
  const c: SessionConditions = { fuelPct: ratioToPct(s.FuelRate), damagePct: ratioToPct(s.Damage), tyreWearPct: ratioToPct(s.TyreWearFactor), tyresOut: typeof s.AllowedTyresOut === 'number' && s.AllowedTyresOut >= 0 && s.AllowedTyresOut <= 4 ? s.AllowedTyresOut : null };
  return Object.values(c).some((v) => v != null) ? c : null;
}

/** Resumen del archivo para que el usuario decida antes de importar. */
export function inspectStracker(path: string, repo: Repository, inContent?: TrackContext['inContent']): Omit<StrackerPreviewDto, 'uploadId'> {
  const db = openStracker(path);
  try {
    const q = (sql: string) => db.prepare(sql).all() as Row[];
    const drivers = repo.imports.allDrivers();
    const byName = new Map<string, number[]>();
    for (const d of drivers) byName.set(norm(d.name), [...(byName.get(norm(d.name)) ?? []), d.id]);
    const players: StrackerPlayerDto[] = q(
      `SELECT p.PlayerId, p.Name, COUNT(l.LapId) AS laps, COUNT(DISTINCT pis.SessionId) AS sessions
       FROM Players p JOIN PlayerInSession pis ON pis.PlayerId = p.PlayerId LEFT JOIN Lap l ON l.PlayerInSessionId = pis.PlayerInSessionId
       GROUP BY p.PlayerId HAVING laps > 0 ORDER BY laps DESC`,
    ).map((r) => {
      const m = byName.get(norm(String(r.Name ?? '')));
      return { id: r.PlayerId, name: String(r.Name ?? `Jugador ${r.PlayerId}`), laps: r.laps, sessions: r.sessions, suggestedDriverId: m?.length === 1 ? m[0]! : null };
    });
    const ctx: TrackContext = { known: repo.imports.knownTracks(), inContent };
    const tracks: StrackerTrackDto[] = q(
      `SELECT t.Track, COUNT(l.LapId) AS laps FROM Tracks t JOIN Session s ON s.TrackId = t.TrackId JOIN PlayerInSession pis ON pis.SessionId = s.SessionId
       JOIN Lap l ON l.PlayerInSessionId = pis.PlayerInSessionId GROUP BY t.Track ORDER BY laps DESC`,
    ).map((r) => ({ raw: r.Track, ...resolveStrackerTrack(r.Track, ctx), laps: r.laps }));
    const sessions = q(sessionsSql(db));
    let seasons: StrackerSeasonDto[] = [];
    try {
      seasons = q('SELECT c.CSId, c.CSName, COUNT(es.CSEventSessionId) AS n FROM CSSeasons c LEFT JOIN CSEvent e ON e.CSId = c.CSId LEFT JOIN CSEventSessions es ON es.EventId = e.EventId GROUP BY c.CSId')
        .map((r) => ({ id: r.CSId, name: String(r.CSName ?? `Temporada ${r.CSId}`), sessions: r.n }));
    } catch { /* versión sin campeonatos */ }
    const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name as string));
    const lapCols = cols('Lap'), pisCols = cols('PlayerInSession');
    const tempCond = ['TemperatureAmbient', 'TemperatureTrack'].filter((c) => lapCols.has(c)).map((c) => `l.${c} IS NOT NULL`);
    const aidCond = [
      ...['AidABS', 'AidTC', 'AidAutoBlib', 'AidAutoBrake', 'AidAutoClutch', 'AidAutoShift', 'AidIdealLine', 'AidStabilityControl', 'AidSlipStream', 'AidTyreBlankets'].filter((c) => lapCols.has(c)).map((c) => `l.${c} IS NOT NULL`),
      ...['ABS', 'TractionControl', 'AutoBlib', 'AutoBrake', 'AutoClutch', 'AutoShift', 'IdealLine', 'StabilityControl'].filter((c) => pisCols.has(c)).map((c) => `pis.${c} IS NOT NULL`),
    ];
    const count = (cond: string[]) => cond.length
      ? (q(`SELECT COUNT(*) AS n FROM Lap l JOIN PlayerInSession pis ON pis.PlayerInSessionId = l.PlayerInSessionId WHERE ${cond.join(' OR ')}`)[0] as Row).n as number
      : 0;
    const dates = sessions.map((s) => s.StartTimeDate).filter((x) => x > 0) as number[];
    return {
      version: (db.prepare('PRAGMA user_version').get() as Row).user_version,
      sessions: sessions.length,
      laps: (q('SELECT COUNT(*) AS n FROM Lap')[0] as Row).n,
      lapsWithTemps: count(tempCond), lapsWithAids: count(aidCond), sessionsWithSettings: sessions.filter((x) => strackerConditions(x) != null).length,
      alreadyImported: sessions.filter((s) => repo.imports.find(SOURCE, 'session', sessionKey(s)) != null).length,
      from: isoOf(dates.length ? Math.min(...dates) : null), to: isoOf(dates.length ? Math.max(...dates) : null),
      players, tracks, seasons, existingDrivers: drivers,
    };
  } finally {
    db.close();
  }
}

function strackerScoring(db: DatabaseSync, schemaId: number | null): ScoringConfig {
  const base = structuredClone(SCORING_PRESETS.f1!.config);
  base.bonuses = [];
  if (schemaId == null) return base;
  let table: Row[] = [];
  try { table = db.prepare('SELECT Position, Points FROM CSPointSchemaEntry WHERE PointSchemaId = ? ORDER BY Position').all(schemaId) as Row[]; } catch { /* esa versión de stracker no trae tabla de puntos: se queda la de la plantilla */ }
  if (table.length) {
    // stracker deja huecos si no hay puntos en alguna posición: se rellenan con 0 para que el puesto n cobre lo que toca
    const max = Math.max(...table.map((r) => r.Position));
    const pts = Array.from({ length: max }, (_, i) => table.find((r) => r.Position === i + 1)?.Points ?? 0);
    base.pointsTable = pts.map((p) => Number(p) || 0);
  }
  return base;
}

/**
 * Importa lo elegido. Es idempotente: una sesión ya importada (misma fecha, circuito y tipo) se salta, así que se puede repetir.
 * `rulesFor` da las reglas de vuelta válida de cada circuito (las de Howler en vigor).
 */
export function importStracker(
  repo: Repository,
  path: string,
  input: Pick<StrackerApplyInput, 'players' | 'tracks' | 'championships'>,
  rulesFor: (track: string, layout: string) => LapRules,
  inContent?: TrackContext['inContent'],
): ImportReportDto {
  const it = importStrackerSteps(repo, path, input, rulesFor, inContent);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

export interface ImportProgress { done: number; total: number }

/**
 * Igual que `importStracker`, pero por pasos: cede el control después de cada sesión con lo avanzado, para poder enseñar una
 * barra de progreso y no bloquear el servidor durante importaciones grandes. Si se abandona a medias, `return()` cierra el archivo.
 */
export function* importStrackerSteps(
  repo: Repository,
  path: string,
  input: Pick<StrackerApplyInput, 'players' | 'tracks' | 'championships'>,
  rulesFor: (track: string, layout: string) => LapRules,
  inContent?: TrackContext['inContent'],
): Generator<ImportProgress, ImportReportDto> {
  const db = openStracker(path);
  const report: ImportReportDto = { sessionsImported: 0, sessionsSkipped: 0, laps: 0, lapsValid: 0, lapsInvalid: 0, lapsPending: 0, validityChanged: 0, lapsUpdated: 0, sessionsUpdated: 0, driversCreated: 0, driversLinked: 0, championshipsCreated: 0, notes: [] };
  try {
    const q = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as Row[];

    // 0. Antes de escribir nada: cada piloto al que se enlaza tiene que existir (si no, la importación se quedaría a medias).
    for (const choice of Object.values(input.players)) {
      if (choice.mode === 'link' && !repo.imports.driverExists(choice.driverId)) throw new Error('Uno de los pilotos elegidos para enlazar ya no existe. Vuelve a abrir el resumen y elígelo de nuevo.');
    }

    // 1. Jugadores → pilotos de Howler (nuevos, enlazados o saltados)
    const driverOf = new Map<number, number>();
    const players = q('SELECT PlayerId, SteamGuid, Name FROM Players');
    for (const p of players) {
      const choice: PlayerChoice = input.players[String(p.PlayerId)] ?? { mode: 'new' };
      if (choice.mode === 'skip') continue;
      if (choice.mode === 'link') { driverOf.set(p.PlayerId, choice.driverId); report.driversLinked++; continue; }
      // El hash de stracker hace de «Steam ID» interno: no es un ID de Steam real, nunca sale por la API y sirve para repetir la importación sin duplicar.
      const steam = `stracker:${p.SteamGuid ?? p.PlayerId}`;
      const existing = repo.imports.driverBySteam(steam);
      const id = existing ?? repo.upsertDriverKeepName(steam, String(p.Name ?? `Jugador ${p.PlayerId}`));
      // Solo cuenta como creado si de verdad nació con ese ID interno (un piloto ya unido a otro responde por su alias).
      if (existing == null && repo.imports.driverBySteam(steam) != null) report.driversCreated++;
      driverOf.set(p.PlayerId, id);
    }

    // 2. Tiempo de referencia por circuito+coche (para reconocer salidas de boxes)
    const ref = new Map<string, number>();
    for (const r of q(`SELECT t.Track, c.Car, MIN(l.LapTime) AS best FROM Lap l JOIN PlayerInSession pis ON pis.PlayerInSessionId = l.PlayerInSessionId
                       JOIN Session s ON s.SessionId = pis.SessionId JOIN Tracks t ON t.TrackId = s.TrackId JOIN Cars c ON c.CarId = pis.CarId WHERE l.Valid = 1 AND l.LapTime > 0 GROUP BY t.Track, c.Car`))
      ref.set(`${r.Track}|${r.Car}`, r.best);

    // 3. Sesiones, una a una (cada una todo o nada)
    const trackCtx: TrackContext = { known: repo.imports.knownTracks(), inContent };
    const localOf = new Map<number, number>(); // SessionId de stracker → sesión de Howler
    // Las versiones de stracker no tienen todas las mismas columnas (ayudas, temperaturas...): las que falten se leen como vacías.
    const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name as string));
    const lapCols = cols('Lap'), pisCols = cols('PlayerInSession');
    const lapSel = ['MaxSpeed_KMH', 'GripLevel', 'Timestamp', 'TemperatureAmbient', 'TemperatureTrack', 'AidABS', 'AidTC', 'AidAutoBlib', 'AidAutoBrake', 'AidAutoClutch', 'AidAutoShift', 'AidIdealLine', 'AidStabilityControl', 'AidSlipStream', 'AidTyreBlankets', 'Cuts', 'CollisionsCar', 'CollisionsEnv']
      .map((c) => `${lapCols.has(c) ? `l.${c}` : 'NULL'} AS ${c}`);
    const pisSel = ['ABS', 'TractionControl', 'AutoBlib', 'AutoBrake', 'AutoClutch', 'AutoShift', 'IdealLine', 'StabilityControl'].map((c) => `${pisCols.has(c) ? `pis.${c}` : 'NULL'} AS ${c}`);
    const lapSql = db.prepare(
      `SELECT pis.PlayerId, c.Car, l.LapCount, l.LapTime, l.Valid, ${[...lapSel, ...pisSel].join(', ')}
       FROM Lap l JOIN PlayerInSession pis ON pis.PlayerInSessionId = l.PlayerInSessionId JOIN Cars c ON c.CarId = pis.CarId WHERE pis.SessionId = ? ORDER BY l.LapId`,
    );
    const allSessions = q(sessionsSql(db));
    let doneSessions = 0;
    for (const s of allSessions) {
      yield { done: doneSessions++, total: allSessions.length }; // cede el control antes de cada sesión: aquí se puede enseñar el avance
      const key = sessionKey(s);
      const already = repo.imports.find(SOURCE, 'session', key);
      const mapped = input.tracks[s.Track] ?? (({ track, layout }) => ({ track, layout }))(resolveStrackerTrack(s.Track, trackCtx));
      const rules = rulesFor(mapped.track, mapped.layout);
      const laps: ImportedLap[] = [];
      let changed = 0;
      for (const l of lapSql.all(s.SessionId) as Row[]) {
        const driverId = driverOf.get(l.PlayerId);
        if (driverId == null || !(l.LapTime > 0)) continue;
        const incidents: ImportedLap['incidents'] = [
          ...Array.from({ length: Math.min(l.CollisionsCar ?? 0, MAX_INCIDENTS_PER_LAP) }, () => ({ kind: 'car' as const, speed: 0 })),
          ...Array.from({ length: Math.min(l.CollisionsEnv ?? 0, MAX_INCIDENTS_PER_LAP) }, () => ({ kind: 'env' as const, speed: 0 })),
        ];
        const best = ref.get(`${s.Track}|${l.Car}`);
        const outLap = l.LapCount === 1 && best != null && l.LapTime > best * OUT_LAP_FACTOR;
        const v = judgeWithReview({ lapMs: l.LapTime, cuts: l.Cuts ?? 0, incidents }, rules, outLap);
        if ((l.Valid === 1) !== v.valid && !v.pending) changed++;
        laps.push({
          driverId, car: l.Car, lapMs: l.LapTime, cuts: l.Cuts ?? 0, grip: l.GripLevel ?? null, valid: v.valid, invalidReason: v.reason, pending: v.pending, outLap,
          maxSpeedKmh: l.MaxSpeed_KMH ?? null, createdAt: isoOf(l.Timestamp) ?? isoOf(s.StartTimeDate) ?? new Date().toISOString(), incidents,
          tempAir: sanitizeTemp(l.TemperatureAmbient), tempTrack: sanitizeTemp(l.TemperatureTrack), aids: strackerAids(l),
        });
      }
      if (already != null) {
        // Ya importada: no se toca nada salvo completar las temperaturas y ayudas que faltaban (importaciones hechas antes de guardarlas).
        report.sessionsSkipped++;
        localOf.set(s.SessionId, already);
        report.lapsUpdated += repo.imports.enrichLaps(already, laps);
        const cond = strackerConditions(s);
        if (cond && repo.imports.setConditionsIfMissing(already, cond)) report.sessionsUpdated++;
        continue;
      }
      report.validityChanged += changed;
      if (laps.length === 0) { report.sessionsSkipped++; continue; }
      const type = sessionType(String(s.SessionType));
      const id = repo.imports.importSession(SOURCE, key, {
        track: mapped.track, layout: mapped.layout, name: type === 3 ? 'Race' : type === 2 ? 'Qualify' : 'Practice', type,
        startedAt: isoOf(s.StartTimeDate) ?? new Date().toISOString(), endedAt: isoOf(s.EndTimeDate), conditions: strackerConditions(s),
      }, laps);
      localOf.set(s.SessionId, id);
      report.sessionsImported++;
      report.laps += laps.length;
      report.lapsValid += laps.filter((x) => x.valid).length;
      report.lapsPending += laps.filter((x) => x.pending).length;
      report.lapsInvalid += laps.filter((x) => !x.valid && !x.pending).length;
    }

    yield { done: allSessions.length, total: allSessions.length };

    // 4. Campeonatos de stracker → borradores de Howler
    if (input.championships) importSeasons(db, repo, localOf, report);
    if (report.driversCreated > 0) report.notes.push('Los pilotos nuevos tienen un identificador interno de stracker: si alguien ya juega en tu servidor con su Steam, únelo con su piloto en «Pilotos importados» (pestaña Importar): todas sus vueltas pasan al piloto de verdad.');
    report.notes.push('stracker no guarda sectores con AssettoServer ni la velocidad de los choques, así que esas vueltas no los tienen.');
    return report;
  } finally {
    db.close();
  }
}

function importSeasons(db: DatabaseSync, repo: Repository, localOf: Map<number, number>, report: ImportReportDto) {
  const all = (sql: string, ...a: any[]) => { try { return db.prepare(sql).all(...a) as Row[]; } catch { return []; } };
  for (const season of all('SELECT CSId, CSName FROM CSSeasons ORDER BY CSId')) {
    const key = `${season.CSId}|${season.CSName}`;
    if (repo.imports.find(SOURCE, 'season', key) != null) continue;
    const sessions = all(
      `SELECT es.SessionId, es.SessionName, es.PointSchemaId, e.EventName FROM CSEventSessions es JOIN CSEvent e ON e.EventId = es.EventId
       WHERE e.CSId = ? ORDER BY e.EventId, es.CSEventSessionId`, season.CSId,
    ).filter((r) => localOf.has(r.SessionId));
    if (sessions.length === 0) { report.notes.push(`La temporada «${season.CSName}» no tiene ninguna sesión importada: no se creó el campeonato.`); continue; }
    const localIds = sessions.map((r) => localOf.get(r.SessionId)!);
    const drivers = repo.imports.driversIn(localIds);
    const first = sessions[0]!;
    const rounds = sessions.map((r) => {
      const ls = repo.imports.sessionInfo(localOf.get(r.SessionId)!)!;
      return { track: ls.track, layout: ls.layout, raceAt: ls.startedAt };
    });
    const id = repo.championships.save(null, {
      name: String(season.CSName ?? `Temporada ${season.CSId}`).slice(0, 100),
      description: 'Importado de stracker. Revisa las carreras, los participantes y la puntuación antes de activarlo.',
      format: 'individual', status: 'draft', scoring: strackerScoring(db, first.PointSchemaId ?? null),
      teams: [], entries: drivers.map((driverId) => ({ driverId, teamKey: null })),
      rounds: rounds.map((r) => ({ track: r.track, layout: r.layout, raceAt: r.raceAt })),
    });
    const created = repo.championships.get(id)!;
    sessions.forEach((r, i) => {
      const local = localOf.get(r.SessionId)!;
      try { repo.championships.assign(id, created.roundList[i]!.id, 'race', local); } catch { /* no era una carrera: queda sin asignar */ }
    });
    repo.imports.mark(SOURCE, 'season', key, id);
    report.championshipsCreated++;
  }
}
