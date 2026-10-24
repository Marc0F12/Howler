import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Migraciones en orden; PRAGMA user_version guarda cuántas se han aplicado. Nunca editar una ya publicada: añadir otra. */
/**
 * Marca las salidas de boxes del historial anterior a la detección: la primera vuelta de un piloto en una sesión cuando
 * es mucho más lenta que el mejor tiempo de esa combinación (si no hay otra vuelta válida con la que comparar, no se marca).
 */
export const OUT_LAP_BACKFILL_SQL = `
  UPDATE laps SET out_lap = 1 WHERE id IN (
    SELECT l.id FROM laps l
    WHERE l.id = (SELECT MIN(f.id) FROM laps f WHERE f.session_id = l.session_id AND f.driver_id = l.driver_id)
      AND l.lap_ms > 1.3 * COALESCE(
        (SELECT MIN(r.lap_ms) FROM laps r WHERE r.track = l.track AND r.layout = l.layout AND r.car = l.car AND r.valid = 1 AND r.id <> l.id),
        l.lap_ms)
  );
`;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE drivers (
    id INTEGER PRIMARY KEY,
    steam_id TEXT NOT NULL UNIQUE,   -- interno: nunca sale por la API
    name TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    track TEXT NOT NULL,
    layout TEXT NOT NULL,
    name TEXT NOT NULL,
    type INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE laps (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    track TEXT NOT NULL,
    layout TEXT NOT NULL,
    car TEXT NOT NULL,
    lap_ms INTEGER NOT NULL,
    s1_ms INTEGER, s2_ms INTEGER, s3_ms INTEGER,
    cuts INTEGER NOT NULL DEFAULT 0,
    grip REAL,
    valid INTEGER NOT NULL,
    invalid_reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX laps_combo ON laps(track, layout, car, valid, lap_ms);
  CREATE INDEX laps_driver ON laps(driver_id, track, layout, car);
  -- Cada choque queda ligado a su vuelta para poder recalcular reglas con el historial (fase 3).
  CREATE TABLE lap_incidents (
    id INTEGER PRIMARY KEY,
    lap_id INTEGER NOT NULL REFERENCES laps(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- 'car' | 'env'
    speed REAL NOT NULL,
    other_driver_id INTEGER
  );
  CREATE INDEX lap_incidents_lap ON lap_incidents(lap_id);
  `,
  // Sectores por circuito en número variable (el HUD de Gandía tiene 5): una fila por sector.
  `
  CREATE TABLE lap_sectors (
    lap_id INTEGER NOT NULL REFERENCES laps(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    PRIMARY KEY (lap_id, idx)
  );
  INSERT INTO lap_sectors SELECT id, 0, s1_ms FROM laps WHERE s1_ms IS NOT NULL;
  INSERT INTO lap_sectors SELECT id, 1, s2_ms FROM laps WHERE s2_ms IS NOT NULL;
  INSERT INTO lap_sectors SELECT id, 2, s3_ms FROM laps WHERE s3_ms IS NOT NULL;
  ALTER TABLE laps DROP COLUMN s1_ms;
  ALTER TABLE laps DROP COLUMN s2_ms;
  ALTER TABLE laps DROP COLUMN s3_ms;
  CREATE INDEX lap_sectors_idx ON lap_sectors(idx, ms);
  `,
  // Los sectores en directo son una estimación; al acabar la sesión se sustituyen por los medidos por el juego
  // del piloto (results/*.json del servidor). source: de dónde salió la vuelta.
  `
  ALTER TABLE laps ADD COLUMN sectors_exact INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE laps ADD COLUMN source TEXT NOT NULL DEFAULT 'live';  -- 'live' | 'results'
  `,
  // Velocidad máxima de cada vuelta y trazas (posición/rumbo/velocidad a ~10 Hz, deflate) de las mejores vueltas
  // de cada combinación, para reproducirlas como fantasmas. Solo se conservan las del top 3 de cada combinación.
  `
  ALTER TABLE laps ADD COLUMN max_speed REAL;
  CREATE TABLE lap_traces (
    lap_id INTEGER PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
    samples INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  `,
  // Decisión manual del administrador sobre una vuelta: el recálculo de reglas no la toca.
  `
  ALTER TABLE laps ADD COLUMN override TEXT;       -- NULL | 'valid' | 'void'
  ALTER TABLE laps ADD COLUMN override_note TEXT;
  `,
  // Velocidad relativa entre los dos coches en un choque (la que manda el juego puede ser la del propio coche) y marca de
  // «salida de boxes» (vuelta que no empezó en la línea de meta: el tiempo incluye salir de boxes o volver tras un reinicio).
  `
  ALTER TABLE lap_incidents ADD COLUMN rel_speed REAL;
  ALTER TABLE laps ADD COLUMN out_lap INTEGER NOT NULL DEFAULT 0;
  ${OUT_LAP_BACKFILL_SQL}
  `,
  // Tercer estado de una vuelta: «pendiente de revisión» (valid = 0 y pending = 1). Las salidas de boxes quedan pendientes
  // hasta que quien controla Howler las aprueba (pasan a válidas, con todos sus efectos) o las anula.
  `
  ALTER TABLE laps ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
  UPDATE laps SET valid = 0, pending = 1, invalid_reason = 'Pendiente de revisión: salida de boxes'
    WHERE out_lap = 1 AND valid = 1 AND override IS NULL;
  `,
  // Campeonatos: definición (puntuación como JSON), equipos, inscritos, pruebas con calendario y sesiones asignadas, mods y ajustes a mano.
  `
  CREATE TABLE championships (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    format TEXT NOT NULL,            -- individual | pairs | teams
    status TEXT NOT NULL,            -- draft | active | finished
    scoring TEXT NOT NULL,           -- ScoringConfig en JSON
    created_at TEXT NOT NULL
  );
  CREATE TABLE championship_teams (
    id INTEGER PRIMARY KEY,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE championship_entries (
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    team_id INTEGER REFERENCES championship_teams(id) ON DELETE SET NULL,
    color TEXT,
    PRIMARY KEY (championship_id, driver_id)
  );
  CREATE TABLE championship_rounds (
    id INTEGER PRIMARY KEY,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    track TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT '',
    cars TEXT NOT NULL DEFAULT '[]', -- JSON con los ids de coche permitidos (vacío = cualquiera)
    practice_at TEXT, quali_at TEXT, race_at TEXT,
    race_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    quali_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL
  );
  CREATE TABLE championship_mods (
    id INTEGER PRIMARY KEY,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    round_id INTEGER REFERENCES championship_rounds(id) ON DELETE CASCADE,  -- null = de todo el campeonato
    name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, note TEXT
  );
  CREATE TABLE championship_adjustments (
    id INTEGER PRIMARY KEY,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES championship_rounds(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    points REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
  );
  `,
  // Ficha de cada mod: imagen y especificaciones (leídas de su web o escritas a mano) para las tarjetas de coche y circuito.
  `
  ALTER TABLE championship_mods ADD COLUMN image_url TEXT;
  ALTER TABLE championship_mods ADD COLUMN specs TEXT NOT NULL DEFAULT '{}';
  `,
  // Registro de lo importado de otras herramientas (stracker...): evita duplicar al repetir una importación.
  `
  CREATE TABLE imports (
    source TEXT NOT NULL,            -- p. ej. 'stracker'
    kind TEXT NOT NULL,              -- 'session' | 'season'
    source_key TEXT NOT NULL,        -- identificador estable en el origen
    local_id INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (source, kind, source_key)
  );
  `,
  // Condiciones de cada vuelta: temperatura del aire y de la pista (°C) y ayudas del piloto (JSON), si se conocen.
  `
  ALTER TABLE laps ADD COLUMN temp_air INTEGER;
  ALTER TABLE laps ADD COLUMN temp_track INTEGER;
  ALTER TABLE laps ADD COLUMN aids TEXT;
  `,
  // Ajustes con los que se corrió cada sesión (porcentajes del server_cfg.ini), si se conocen.
  `
  ALTER TABLE sessions ADD COLUMN fuel_pct INTEGER;
  ALTER TABLE sessions ADD COLUMN damage_pct INTEGER;
  ALTER TABLE sessions ADD COLUMN tyre_wear_pct INTEGER;
  ALTER TABLE sessions ADD COLUMN tyres_out INTEGER;
  `,
  // Penalizaciones de los comisarios: avisos guardados, segundos añadidos al tiempo de carrera y descalificaciones.
  `
  CREATE TABLE penalties (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- 'warning' | 'time' | 'dsq'
    seconds REAL,                    -- solo para 'time'
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX penalties_session ON penalties(session_id);
  `,
  // MultiHowler: identidad propia, vínculos con otros Howler y origen de cada vuelta/sesión copiada. Lo propio tiene
  // origin NULL y un contador rev (sube en cada alta o cambio, por triggers); lo ajeno es una copia de solo lectura
  // (origin = identidad del Howler de origen, origin_id = su id allí, origin_rev = su rev).
  `
  CREATE TABLE mh_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    uuid TEXT NOT NULL,              -- identidad permanente; nunca se muestra
    name TEXT NOT NULL,
    link_key TEXT NOT NULL,          -- clave para pedir vincularse (regenerable)
    address TEXT NOT NULL DEFAULT '',
    rev INTEGER NOT NULL DEFAULT 0   -- último rev repartido a vueltas propias
  );
  CREATE TABLE mh_peers (
    id INTEGER PRIMARY KEY,
    direction TEXT NOT NULL,         -- 'outgoing' (yo pedí) | 'incoming' (me pidieron)
    peer_uuid TEXT,
    name TEXT NOT NULL,
    url TEXT,                        -- solo en 'outgoing'
    status TEXT NOT NULL,            -- 'requested' | 'pending' | 'approved' | 'denied' | 'revoked'
    token_hash TEXT,                 -- sha256 del token con el que ELLOS me llaman (incoming)
    token_plain TEXT,                -- incoming: token aún sin entregar; outgoing: el token con el que YO les llamo
    request_secret_hash TEXT,        -- incoming: para que el solicitante consulte su estado
    request_secret TEXT,             -- outgoing: el secreto de mi solicitud
    we_give INTEGER NOT NULL DEFAULT 0,
    we_receive INTEGER NOT NULL DEFAULT 0,
    they_give INTEGER NOT NULL DEFAULT 0,
    they_receive INTEGER NOT NULL DEFAULT 0,
    share_championships INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_attempt_at TEXT,
    last_error TEXT,
    last_new_laps INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX mh_peers_token ON mh_peers(token_hash) WHERE token_hash IS NOT NULL;
  ALTER TABLE sessions ADD COLUMN origin TEXT;
  ALTER TABLE sessions ADD COLUMN origin_id INTEGER;
  ALTER TABLE laps ADD COLUMN origin TEXT;
  ALTER TABLE laps ADD COLUMN origin_id INTEGER;
  ALTER TABLE laps ADD COLUMN origin_rev INTEGER;
  ALTER TABLE laps ADD COLUMN rev INTEGER;
  CREATE UNIQUE INDEX sessions_origin ON sessions(origin, origin_id) WHERE origin IS NOT NULL;
  CREATE UNIQUE INDEX laps_origin ON laps(origin, origin_id) WHERE origin IS NOT NULL;
  CREATE INDEX laps_rev ON laps(rev) WHERE origin IS NULL;
  CREATE INDEX laps_origin_rev ON laps(origin, origin_rev) WHERE origin IS NOT NULL;
  UPDATE laps SET rev = id;
  INSERT INTO mh_identity (id, uuid, name, link_key, rev) VALUES (1, '', 'Howler', '', COALESCE((SELECT MAX(id) FROM laps), 0));
  CREATE TRIGGER laps_rev_ins AFTER INSERT ON laps WHEN NEW.origin IS NULL BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = NEW.id;
  END;
  CREATE TRIGGER laps_rev_upd AFTER UPDATE ON laps WHEN NEW.origin IS NULL AND NEW.rev IS OLD.rev BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = NEW.id;
  END;
  CREATE TRIGGER lap_sectors_rev_ins AFTER INSERT ON lap_sectors BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = NEW.lap_id AND origin IS NULL;
  END;
  CREATE TRIGGER lap_sectors_rev_upd AFTER UPDATE ON lap_sectors BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = NEW.lap_id AND origin IS NULL;
  END;
  CREATE TRIGGER lap_sectors_rev_del AFTER DELETE ON lap_sectors BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = OLD.lap_id AND origin IS NULL;
  END;
  `,
  // Al regenerar la identidad (carpeta de datos copiada) solo se comparten las vueltas propias posteriores a ese momento.
  `
  ALTER TABLE mh_identity ADD COLUMN share_from_rev INTEGER NOT NULL DEFAULT 0;
  `,
  // Gestor de pilotos y MultiHowler paso 4-5: pilotos ocultos/renombrados a mano, alias de pilotos unidos (para que su Steam ID
  // siga apuntando al piloto de destino) y vueltas ocultas (las de un piloto oculto o de un Howler oculto; no se comparte ni se borra).
  `
  ALTER TABLE drivers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE drivers ADD COLUMN name_locked INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE driver_aliases (
    steam_id TEXT PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE
  );
  ALTER TABLE laps ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE mh_origins (uuid TEXT PRIMARY KEY, name TEXT NOT NULL);
  DROP TRIGGER laps_rev_upd;
  CREATE TRIGGER laps_rev_upd AFTER UPDATE ON laps WHEN NEW.origin IS NULL AND NEW.rev IS OLD.rev AND NEW.hidden IS OLD.hidden BEGIN
    UPDATE mh_identity SET rev = rev + 1;
    UPDATE laps SET rev = (SELECT rev FROM mh_identity) WHERE id = NEW.id;
  END;
  CREATE TRIGGER laps_hidden_ins AFTER INSERT ON laps BEGIN
    UPDATE laps SET hidden = 1 WHERE id = NEW.id AND (
      EXISTS (SELECT 1 FROM drivers d WHERE d.id = NEW.driver_id AND d.hidden = 1)
      OR EXISTS (SELECT 1 FROM mh_peers p WHERE p.peer_uuid = NEW.origin AND p.hidden = 1));
  END;
  `,
  // MultiHowler paso 6: campeonatos compartidos entre pares (copias de solo lectura de la definición; los resultados se calculan
  // aquí con las vueltas y sesiones sincronizadas). origin_*: de qué Howler vienen y los ids que tenían allí.
  `
  ALTER TABLE championships ADD COLUMN origin TEXT;
  ALTER TABLE championships ADD COLUMN origin_id INTEGER;
  CREATE UNIQUE INDEX championships_origin ON championships(origin, origin_id) WHERE origin IS NOT NULL;
  ALTER TABLE championship_rounds ADD COLUMN origin_race_session INTEGER;
  ALTER TABLE championship_rounds ADD COLUMN origin_quali_session INTEGER;
  ALTER TABLE mh_peers ADD COLUMN they_share INTEGER NOT NULL DEFAULT 0;
  `,
  // Insignia (hasta 6 caracteres, admite emojis) con la que cada Howler se identifica ante los demás.
  `
  ALTER TABLE mh_identity ADD COLUMN badge TEXT NOT NULL DEFAULT '';
  ALTER TABLE mh_origins ADD COLUMN badge TEXT NOT NULL DEFAULT '';
  `,
  // Colores de la insignia (#rrggbb; vacío = automático).
  `
  ALTER TABLE mh_identity ADD COLUMN badge_bg TEXT NOT NULL DEFAULT '';
  ALTER TABLE mh_identity ADD COLUMN badge_fg TEXT NOT NULL DEFAULT '';
  ALTER TABLE mh_origins ADD COLUMN badge_bg TEXT NOT NULL DEFAULT '';
  ALTER TABLE mh_origins ADD COLUMN badge_fg TEXT NOT NULL DEFAULT '';
  `,
  // Casi todas las consultas de sesión (torre, historial, rey de la colina) filtran las vueltas por sesión.
  `
  CREATE INDEX IF NOT EXISTS laps_session ON laps(session_id);
  `,
  // Clima de cada vuelta: el nombre que mandó el servidor al darla (carpeta de clima o tipo de CSP). Vueltas anteriores: NULL.
  `
  ALTER TABLE laps ADD COLUMN weather TEXT;
  `,
  // Campeonatos: ajuste de la imagen, coche y skin de cada inscrito, y clima y calendario completo de cada prueba.
  `
  ALTER TABLE championships ADD COLUMN image_fit TEXT;
  ALTER TABLE championship_entries ADD COLUMN car TEXT;
  ALTER TABLE championship_entries ADD COLUMN skin TEXT;
  ALTER TABLE championship_rounds ADD COLUMN weather TEXT;
  ALTER TABLE championship_rounds ADD COLUMN schedule TEXT;
  `,
  // Campeonatos: el diseño de la insignia creada en el panel (JSON howler-badge) para poder volver a editarla.
  `
  ALTER TABLE championships ADD COLUMN badge_design TEXT;
  `,
  // MultiHowler: interruptor «compartir trayectorias» por vínculo, y marca de «ya pedí la traza de esta vuelta ajena».
  `
  ALTER TABLE mh_peers ADD COLUMN share_traces INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE laps ADD COLUMN trace_checked INTEGER NOT NULL DEFAULT 0;
  `,
  // Inscripción pública a campeonatos: ajustes (JSON) y solicitudes pendientes de aprobar.
  `
  ALTER TABLE championships ADD COLUMN signup TEXT;
  CREATE TABLE championship_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    steam TEXT NOT NULL,
    team TEXT NOT NULL DEFAULT '',
    car TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    answers TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT,
    driver_id INTEGER
  );
  CREATE INDEX championship_signups_champ ON championship_signups(championship_id, status);
  `,
];

/** Versión de esquema de esta versión de Howler (nº de migraciones). */
export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
