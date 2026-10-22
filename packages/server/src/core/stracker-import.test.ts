import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, formatAids, formatConditions, ratioToPct, sanitizeTemp } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { importStracker, importStrackerSteps, inspectStracker, openStracker, resolveStrackerTrack, stripCspPath } from './stracker-import';

const root = mkdtempSync(join(tmpdir(), 'howler-stracker-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const cortes = () => BUILTIN_PROFILES.cortes!.rules;
const estricto = () => BUILTIN_PROFILES.estricto!.rules;

/** Archivo de stracker mínimo, con el mismo esquema que el real (solo las columnas que se leen). */
function makeStracker(name = 's.db3', withConditions = false) {
  const path = join(root, `${Math.random().toString(36).slice(2)}-${name}`);
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA user_version = 24;
    CREATE TABLE Players (PlayerId INTEGER PRIMARY KEY, SteamGuid TEXT, Name TEXT);
    CREATE TABLE Tracks (TrackId INTEGER PRIMARY KEY, Track TEXT);
    CREATE TABLE Cars (CarId INTEGER PRIMARY KEY, Car TEXT);
    CREATE TABLE Session (SessionId INTEGER PRIMARY KEY, TrackId INTEGER, SessionType TEXT, StartTimeDate INTEGER, EndTimeDate INTEGER${withConditions ? ', FuelRate REAL, Damage REAL, TyreWearFactor REAL, AllowedTyresOut INTEGER' : ''});
    CREATE TABLE PlayerInSession (PlayerInSessionId INTEGER PRIMARY KEY, SessionId INTEGER, PlayerId INTEGER, CarId INTEGER${withConditions ? ', ABS INTEGER, TractionControl INTEGER' : ''});
    CREATE TABLE Lap (LapId INTEGER PRIMARY KEY, PlayerInSessionId INTEGER, LapCount INTEGER, LapTime INTEGER, Valid INTEGER, Cuts INTEGER, CollisionsCar INTEGER, CollisionsEnv INTEGER, MaxSpeed_KMH REAL, GripLevel REAL, Timestamp INTEGER${withConditions ? ', TemperatureAmbient INTEGER, TemperatureTrack INTEGER, AidABS INTEGER, AidTC INTEGER, AidStabilityControl REAL' : ''});
    CREATE TABLE CSSeasons (CSId INTEGER PRIMARY KEY, CSName TEXT);
    CREATE TABLE CSEvent (EventId INTEGER PRIMARY KEY, EventName TEXT, CSId INTEGER);
    CREATE TABLE CSEventSessions (CSEventSessionId INTEGER PRIMARY KEY, EventId INTEGER, SessionId INTEGER, PointSchemaId INTEGER, SessionName TEXT);
    CREATE TABLE CSPointSchema (PointSchemaId INTEGER PRIMARY KEY, PSName TEXT);
    CREATE TABLE CSPointSchemaEntry (PointSchemaEntryId INTEGER PRIMARY KEY, PointSchemaId INTEGER, Position INTEGER, Points REAL);
    INSERT INTO Players VALUES (1, 'sha256:aaaa', 'Ana'), (2, 'sha256:bbbb', 'Beto'), (3, 'sha256:cccc', 'Cris');
    INSERT INTO Tracks VALUES (1, 'csp/0/../ks_silverstone-gp'), (2, 'csp/0/../monza');
    INSERT INTO Cars VALUES (1, 'mx5');
    -- Sesión 1: práctica en Silverstone. Sesión 2: carrera en Monza. Sesión 3: carrera en Monza (otro día).
    INSERT INTO Session (SessionId, TrackId, SessionType, StartTimeDate, EndTimeDate) VALUES (1, 1, 'Practice', 1767285783, 1767286707), (2, 2, 'Race', 1767300000, 1767301000), (3, 2, 'Race', 1767400000, 1767401000);
    INSERT INTO PlayerInSession VALUES ${withConditions ? '(1, 1, 1, 1, 1, 0), (2, 1, 2, 1, 2, 2), (3, 2, 1, 1, NULL, NULL), (4, 2, 2, 1, NULL, NULL), (5, 2, 3, 1, NULL, NULL), (6, 3, 1, 1, NULL, NULL), (7, 3, 3, 1, NULL, NULL)' : '(1, 1, 1, 1), (2, 1, 2, 1), (3, 2, 1, 1), (4, 2, 2, 1), (5, 2, 3, 1), (6, 3, 1, 1), (7, 3, 3, 1)'};
  `);
  const lap = db.prepare('INSERT INTO Lap (PlayerInSessionId, LapCount, LapTime, Valid, Cuts, CollisionsCar, CollisionsEnv, MaxSpeed_KMH, GripLevel, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  // Práctica: Ana sale de boxes (vuelta 1 lenta), luego dos vueltas buenas, una con corte; Beto una con choque
  lap.run(1, 1, 190_000, 0, 0, 0, 0, 180, 1, 1767285900);
  lap.run(1, 2, 100_000, 1, 0, 0, 0, 230, 1, 1767286000);
  lap.run(1, 3, 99_000, 0, 2, 0, 0, 231, 1, 1767286100);
  lap.run(2, 2, 101_000, 0, 0, 1, 0, 225, 1, 1767286200);
  lap.run(2, 3, 0, 0, 0, 0, 0, 0, 1, 1767286300); // tiempo 0: se ignora
  // Carreras
  for (const [pis, t] of [[3, 90_000], [4, 91_000], [5, 92_000]] as const) { lap.run(pis, 1, t, 1, 0, 0, 0, 200, 1, 1767300100); lap.run(pis, 2, t, 1, 0, 0, 0, 200, 1, 1767300200); }
  for (const [pis, t] of [[6, 90_500], [7, 89_500]] as const) { lap.run(pis, 1, t, 1, 0, 0, 0, 200, 1, 1767400100); lap.run(pis, 2, t, 1, 0, 0, 0, 200, 1, 1767400200); }
  if (withConditions) {
    // Temperaturas en todas las vueltas; ayudas por vuelta solo en las de Ana en la práctica (ABS activo, TC apagado, estabilidad 50 %)
    db.exec(`UPDATE Session SET FuelRate = 1, Damage = 0, TyreWearFactor = 0.5, AllowedTyresOut = 2;`);
    db.exec(`UPDATE Lap SET TemperatureAmbient = 17, TemperatureTrack = 24; UPDATE Lap SET AidABS = 1, AidTC = 0, AidStabilityControl = 0.5 WHERE PlayerInSessionId = 1;`);
  }
  // Campeonato de stracker: dos carreras en Monza con una tabla de puntos con hueco en la posición 2
  db.exec(`
    INSERT INTO CSSeasons VALUES (1, 'Copa Test');
    INSERT INTO CSEvent VALUES (1, 'Jornada', 1);
    INSERT INTO CSEventSessions VALUES (1, 1, 2, 1, 'Carrera1'), (2, 1, 3, 1, 'Carrera2');
    INSERT INTO CSPointSchema VALUES (1, 'Reglas');
    INSERT INTO CSPointSchemaEntry VALUES (1, 1, 1, 10), (2, 1, 3, 4);
  `);
  db.close();
  return path;
}
const fresh = () => new Repository(openDatabase(':memory:'));

describe('abrir un archivo de stracker', () => {
  it('rechaza un SQLite que no es de stracker y un archivo que no es SQLite', () => {
    const p = join(root, 'otro.db');
    const db = new DatabaseSync(p); db.exec('CREATE TABLE x (a)'); db.close();
    expect(() => openStracker(p)).toThrow(/no parece una base de datos de stracker/);
    const txt = join(root, 'texto.db3'); writeFileSync(txt, 'hola, esto no es una base de datos '.repeat(10));
    expect(() => openStracker(txt)).toThrow();
  });
});

describe('circuito y layout', () => {
  const known = [{ track: 'ks_silverstone', layout: 'gp' }];
  it('quita el prefijo CSP y usa lo que Howler o el contenido de AC conocen', () => {
    expect(stripCspPath('csp/0/../ks_silverstone-gp')).toBe('ks_silverstone-gp');
    expect(resolveStrackerTrack('csp/0/../ks_silverstone-gp', { known })).toEqual({ track: 'ks_silverstone', layout: 'gp', known: true });
    // un circuito cuyo NOMBRE lleva guion y no tiene layout: el contenido manda
    expect(resolveStrackerTrack('acu_barcelona-city', { known: [], inContent: (t, l) => t === 'acu_barcelona-city' && l === '' })).toEqual({ track: 'acu_barcelona-city', layout: '', known: true });
    expect(resolveStrackerTrack('acu_barcelona-city-normal', { known: [], inContent: (t, l) => t === 'acu_barcelona-city' && l === 'normal' })).toMatchObject({ track: 'acu_barcelona-city', layout: 'normal', known: true });
  });
  it('sin pistas corta en el último guion y avisa de que no está confirmado', () => {
    expect(resolveStrackerTrack('x_track-a-b', { known: [] })).toEqual({ track: 'x_track-a', layout: 'b', known: false });
    expect(resolveStrackerTrack('csp/0/../monza', { known: [] })).toEqual({ track: 'monza', layout: '', known: false });
  });
});

describe('vista previa', () => {
  it('cuenta lo que hay y propone enlazar por nombre solo si hay un piloto único', () => {
    const repo = fresh();
    repo.upsertDriver('7656119000000001', 'ana');
    repo.upsertDriver('7656119000000002', 'Beto'); repo.upsertDriver('7656119000000003', 'beto'); // dos Beto: ambiguo
    const p = inspectStracker(makeStracker(), repo);
    expect(p).toMatchObject({ version: 24, sessions: 3, laps: 15, alreadyImported: 0, lapsWithTemps: 0, lapsWithAids: 0 });
    expect(inspectStracker(makeStracker('c.db3', true), repo)).toMatchObject({ lapsWithTemps: 15, lapsWithAids: 5 }); // ayudas solo en la práctica (5 vueltas)
    expect(p.players.map((x) => [x.name, x.laps, x.suggestedDriverId !== null]).sort()).toEqual([['Ana', 7, true], ['Beto', 4, false], ['Cris', 4, false]]);
    expect(p.tracks.map((t) => [t.track, t.layout])).toContainEqual(['ks_silverstone', 'gp']);
    expect(p.seasons).toEqual([{ id: 1, name: 'Copa Test', sessions: 2 }]);
    expect(JSON.stringify(p)).not.toContain('sha256'); // el hash de stracker no sale
  });
});

describe('importar', () => {
  it('importa sesiones y vueltas con sus fechas, tipos, velocidad máxima y agarre', () => {
    const repo = fresh();
    const r = importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    expect(r).toMatchObject({ sessionsImported: 3, sessionsSkipped: 0, laps: 14, driversCreated: 3 }); // la vuelta de 0 ms no cuenta
    const laps = repo.lapAdmin.recent(50);
    expect(laps).toHaveLength(14);
    const ana = repo.profiles.driverList().find((d) => d.name === 'Ana')!;
    expect(ana.laps).toBe(7);
    const detail = repo.profiles.driverProfile(ana.id)!;
    expect(detail.combos.find((c) => c.track === 'ks_silverstone')).toMatchObject({ layout: 'gp', car: 'mx5', bestMs: 100_000, maxSpeedKmh: 231 });
  });

  it('las vueltas se juzgan con las reglas de Howler: corte anula, la salida de boxes queda pendiente, el choque depende del perfil', () => {
    const run = (rules: () => any) => { const repo = fresh(); const r = importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, rules); return { repo, r }; };
    const a = run(cortes);
    // práctica de Ana: salida (190.000 > 1,15 × mejor) pendiente, 100.000 válida, 99.000 con corte anulada; Beto con choque: válida en «cortes»
    expect(a.r).toMatchObject({ lapsPending: 1, lapsInvalid: 1 });
    expect(a.repo.lapAdmin.recent(50, true)).toHaveLength(1);
    const b = run(estricto);
    expect(b.r.lapsInvalid).toBe(a.r.lapsInvalid + 1); // con «estricto» el choque de Beto también anula
    expect(a.r.validityChanged).toBeGreaterThan(0); // stracker marcó inválida la de Beto por choque y Howler la da por buena
  });

  it('enlazar con un piloto existente, saltar a otro, y repetir la importación no duplica nada', () => {
    const repo = fresh();
    const mine = repo.upsertDriver('7656119000000001', 'Ana Real');
    const file = makeStracker();
    const input = { players: { '1': { mode: 'link' as const, driverId: mine }, '3': { mode: 'skip' as const } }, tracks: {}, championships: false };
    const r1 = importStracker(repo, file, input, cortes);
    expect(r1).toMatchObject({ driversLinked: 1, driversCreated: 1 }); // Beto es nuevo; Cris se salta
    expect(repo.profiles.driverList().map((d) => d.name).sort()).toEqual(['Ana Real', 'Beto']);
    const r2 = importStracker(repo, file, input, cortes);
    expect(r2).toMatchObject({ sessionsImported: 0, sessionsSkipped: 3, laps: 0, driversCreated: 0 });
    expect(repo.lapAdmin.recent(100)).toHaveLength(r1.laps);
  });

  it('una sesión en la que solo participaban jugadores saltados no se crea', () => {
    const repo = fresh();
    const r = importStracker(repo, makeStracker(), { players: { '1': { mode: 'skip' }, '3': { mode: 'skip' } }, tracks: {}, championships: false }, cortes);
    expect(r.sessionsImported).toBe(2); // quedan la práctica (Beto) y la carrera del día 1 (Beto); la 3.ª solo tenía a Ana y a Cris
  });

  it('el circuito se puede corregir a mano', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: { 'csp/0/../ks_silverstone-gp': { track: 'ks_silverstone-gp', layout: '' } }, championships: false }, cortes);
    expect(repo.imports.knownTracks()).toContainEqual({ track: 'ks_silverstone-gp', layout: '' });
  });

  it('los campeonatos de stracker se crean como borrador, con su tabla de puntos y las carreras asignadas', () => {
    const repo = fresh();
    const r = importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: true }, cortes);
    expect(r.championshipsCreated).toBe(1);
    const [c] = repo.championships.list(true);
    expect(c).toMatchObject({ name: 'Copa Test', status: 'draft', rounds: 2, played: 2, participants: 3 });
    const full = repo.championships.get(c!.id)!;
    expect(full.scoring.pointsTable).toEqual([10, 0, 4]); // el hueco de la posición 2 se rellena con 0
    expect(full.roundList.map((x) => [x.track, x.played])).toEqual([['monza', true], ['monza', true]]);
    expect(importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: true }, cortes).championshipsCreated).toBe(0); // otra copia del mismo archivo: nada nuevo
  });

  it('el hash de stracker queda como identificador interno y no aparece en ninguna ficha', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: true }, cortes);
    const id = repo.profiles.driverList()[0]!.id;
    expect(repo.driverSteamId(id)).toMatch(/^stracker:sha256:/);
    expect(JSON.stringify(repo.profiles.driverProfile(id))).not.toContain('sha256');
    expect(JSON.stringify(repo.championships.list(true))).not.toContain('sha256');
  });
});

describe('unir pilotos importados', () => {
  it('pasa vueltas e inscripciones al piloto real y borra el importado', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: true }, cortes);
    const real = repo.upsertDriver('7656119000000001', 'Ana Real');
    const imported = repo.imports.importedDrivers();
    const ana = imported.find((d) => d.name === 'Ana')!;
    expect(ana.laps).toBe(7);
    repo.imports.mergeDriver(ana.id, real);
    expect(repo.imports.importedDrivers().map((d) => d.name)).toEqual(['Beto', 'Cris']);
    expect(repo.profiles.driverProfile(real)!.totals.laps).toBe(7);
    expect(repo.profiles.driverProfile(ana.id)).toBeNull();
    const c = repo.championships.get(repo.championships.list(true)[0]!.id)!;
    expect(c.entries.map((e) => e.name)).toContain('Ana Real');
    expect(c.entries.map((e) => e.name)).not.toContain('Ana');
  });

  it('un enlace a un piloto que ya no existe se rechaza ANTES de importar nada', () => {
    const repo = fresh();
    expect(() => importStracker(repo, makeStracker(), { players: { '1': { mode: 'link', driverId: 9999 } }, tracks: {}, championships: false }, cortes)).toThrow(/ya no existe/);
    expect(repo.sessionHistory.list({ limit: 10, offset: 0 }).total).toBe(0);
  });

  it('al unir también pasan las penalizaciones y queda un alias: reimportar no recrea al piloto', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    const real = repo.upsertDriver('7656119000000001', 'Ana Real');
    const ana = repo.imports.importedDrivers().find((d) => d.name === 'Ana')!;
    const sess = (repo as any).db.prepare('SELECT id FROM sessions LIMIT 1').get().id as number;
    repo.penalties.add({ sessionId: sess, driverId: ana.id, kind: 'warning', reason: 'x' });
    repo.imports.mergeDriver(ana.id, real);
    expect((repo as any).db.prepare('SELECT COUNT(*) c FROM penalties WHERE driver_id = ?').get(real).c).toBe(1);
    expect((repo as any).db.prepare("SELECT COUNT(*) c FROM driver_aliases WHERE driver_id = ?").get(real).c).toBe(1);
  });

  it('no deja unir un piloto real, ni uno consigo mismo, ni con uno que no existe; y si ya estaban los dos en un campeonato no falla', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: true }, cortes);
    const real = repo.upsertDriver('7656119000000001', 'Ana Real');
    const other = repo.upsertDriver('7656119000000002', 'Otro');
    const [a] = repo.imports.importedDrivers();
    expect(() => repo.imports.mergeDriver(real, other)).toThrow(/creados por una importación/);
    expect(() => repo.imports.mergeDriver(a!.id, a!.id)).toThrow(/mismo/);
    expect(() => repo.imports.mergeDriver(a!.id, 9999)).toThrow(/no existe/);
    // los dos inscritos en el mismo campeonato
    const champ = repo.championships.list(true)[0]!;
    const full = repo.championships.get(champ.id)!;
    repo.championships.save(champ.id, {
      name: full.name, format: 'individual', status: 'draft', scoring: full.scoring, teams: [],
      entries: [...full.entries.map((e) => ({ driverId: e.driverId, teamKey: null })), { driverId: real, teamKey: null }],
      rounds: full.roundList.map((r) => ({ id: r.id, track: r.track, layout: r.layout })),
    });
    repo.imports.mergeDriver(a!.id, real);
    expect(repo.championships.get(champ.id)!.entries.filter((e) => e.driverId === real)).toHaveLength(1);
  });
});

describe('temperaturas y ayudas', () => {
  it('importa la temperatura del aire y de la pista, y las ayudas de la vuelta o, si no las hay, las de la sesión del jugador', () => {
    const repo = fresh();
    importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes);
    const table = repo.records('ks_silverstone', 'gp', []);
    const ana = table.entries.find((e) => e.driverName === 'Ana')!;
    expect(ana).toMatchObject({ tempAir: 17, tempTrack: 24, aids: { abs: 1, tc: 0, stability: 0.5 } });
    expect(formatAids(ana.aids)).toEqual(['ABS', 'Estabilidad 50 %']); // TC apagado no se enseña
    const beto = table.entries.find((e) => e.driverName === 'Beto')!;
    expect(beto.aids).toEqual({ abs: 2, tc: 2 }); // sin ayudas por vuelta: salen las de su sesión
    const sess = repo.profiles.driverProfile(ana.driverId)!; // la ficha sigue funcionando
    expect(sess.totals.laps).toBe(7);
    expect(repo.records('monza', '', []).entries[0]!.aids).toBeNull(); // la carrera no traía ayudas
  });

  it('un archivo sin esas columnas (stracker antiguo o con AssettoServer) importa igual, sin temperaturas ni ayudas', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    expect(repo.records('ks_silverstone', 'gp', []).entries[0]).toMatchObject({ tempAir: null, tempTrack: null, aids: null });
  });

  it('una importación hecha antes de guardar estos datos se completa al repetirla, sin duplicar nada', () => {
    const repo = fresh();
    const plain = importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    const again = importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes);
    expect(again).toMatchObject({ sessionsImported: 0, sessionsSkipped: 3, laps: 0, lapsUpdated: plain.laps });
    expect(repo.records('ks_silverstone', 'gp', []).entries.find((e) => e.driverName === 'Ana')).toMatchObject({ tempAir: 17, tempTrack: 24 });
    // y a la tercera ya no hay nada que completar
    expect(importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes).lapsUpdated).toBe(0);
  });

  it('las temperaturas absurdas se descartan', () => {
    expect(sanitizeTemp(21.4)).toBe(21);
    expect(sanitizeTemp(null)).toBeNull();
    expect(sanitizeTemp(-300)).toBeNull();
    expect(sanitizeTemp(9999)).toBeNull();
    expect(sanitizeTemp('20')).toBeNull();
  });
});

describe('ajustes de sesión', () => {
  const cond = (repo: Repository, i: number) => (repo as any).db.prepare('SELECT fuel_pct, damage_pct, tyre_wear_pct, tyres_out FROM sessions WHERE id = ?').get(i);

  it('importa combustible, daños, desgaste y neumáticos fuera de cada sesión (1 = 100 %)', () => {
    const repo = fresh();
    expect(inspectStracker(makeStracker('c.db3', true), repo).sessionsWithSettings).toBe(3);
    importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes);
    const s = repo.latestSessionWithLaps()!;
    expect(s.conditions).toEqual({ fuelPct: 100, damagePct: 0, tyreWearPct: 50, tyresOut: 2 });
    expect(formatConditions(s.conditions)).toEqual(['Combustible 100 %', 'Sin daños', 'Desgaste 50 %', '2 neumáticos fuera permitidos']);
  });

  it('un archivo sin esas columnas deja la sesión sin condiciones', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    expect(repo.latestSessionWithLaps()!.conditions).toBeNull();
  });

  it('una importación antigua se completa al repetirla: las sesiones reciben sus ajustes', () => {
    const repo = fresh();
    importStracker(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    const again = importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes);
    expect(again.sessionsUpdated).toBe(3);
    expect(cond(repo, 1)).toMatchObject({ fuel_pct: 100, damage_pct: 0 });
    expect(importStracker(repo, makeStracker('c.db3', true), { players: {}, tracks: {}, championships: false }, cortes).sessionsUpdated).toBe(0);
  });

  it('formato: sin consumo, sin desgaste y porcentajes absurdos descartados', () => {
    expect(formatConditions({ fuelPct: 0, damagePct: 200, tyreWearPct: 0, tyresOut: -1 })).toEqual(['Sin consumo de combustible', 'Daños 200 %', 'Sin desgaste de neumáticos']);
    expect(formatConditions(null)).toEqual([]);
    expect(ratioToPct(0.5)).toBe(50);
    expect(ratioToPct(1)).toBe(100);
    expect(ratioToPct(-1)).toBeNull();
    expect(ratioToPct(99)).toBeNull();
    expect(ratioToPct(null)).toBeNull();
  });
});

describe('importación por pasos (barra de progreso)', () => {
  it('cede el control antes de cada sesión con el avance y termina con el mismo informe', () => {
    const repo = fresh();
    const it = importStrackerSteps(repo, makeStracker(), { players: {}, tracks: {}, championships: false }, cortes);
    const seen: number[] = [];
    let r = it.next();
    while (!r.done) { seen.push(r.value.done); expect(r.value.total).toBe(3); r = it.next(); }
    expect(seen).toEqual([0, 1, 2, 3]); // antes de cada una de las 3 sesiones y al terminarlas todas
    expect(r.value).toMatchObject({ sessionsImported: 3, laps: 14 });
  });

  it('abandonarla a medias no deja el archivo abierto y lo ya importado queda entero', () => {
    const repo = fresh();
    const file = makeStracker();
    const it = importStrackerSteps(repo, file, { players: {}, tracks: {}, championships: false }, cortes);
    it.next(); it.next(); // una sesión importada
    it.return({} as never);
    expect(repo.lapAdmin.recent(100).length).toBeGreaterThan(0);
    // se puede continuar después: lo importado se salta
    expect(importStracker(repo, file, { players: {}, tracks: {}, championships: false }, cortes).sessionsSkipped).toBe(1);
  });
});
