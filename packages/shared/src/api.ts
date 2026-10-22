import type { LapAids, SessionConditions } from './lap-conditions';
/** Contrato HTTP entre servidor y web. Nunca se expone el ID de Steam. */

export interface SessionSummary {
  id: number;
  track: string;
  layout: string;
  name: string;
  type: number;
  startedAt: string;
  /** Combustible, daños y desgaste con los que se corrió, si se conocen. */
  conditions?: SessionConditions | null;
}

export interface OnlineDriver {
  carId: number;
  driverId: number;
  name: string;
  car: string;
}

export interface StatusDto {
  /** true si llegaron paquetes del servidor de AC hace poco. */
  acConnected: boolean;
  /** true si el plugin HowlerPlugin está activo en el servidor: los sectores llegan exactos, en directo. */
  exactSectors: boolean;
  session: SessionSummary | null;
  online: OnlineDriver[];
}

export interface ComboDto {
  track: string;
  layout: string;
  car: string;
  laps: number;
  drivers: number;
  /** Récord de la combinación (mejor vuelta válida de cualquier piloto); null si todas las vueltas están anuladas. */
  bestMs: number | null;
  bestDriverName: string | null;
}

/** Una fila de la tabla de tiempos: la mejor vuelta válida de un piloto con un coche, y su resumen en la combinación. */
export interface RecordEntryDto {
  position: number;
  /** Servidor donde se hizo la vuelta (este u otro Howler vinculado) y los colores de su insignia. */
  serverBadge: string;
  serverBadgeBg: string;
  serverBadgeFg: string;
  driverId: number;
  driverName: string;
  car: string;
  /** Mejor vuelta válida. */
  lapMs: number;
  /** Sectores de esa mejor vuelta. */
  sectorsMs: (number | null)[];
  /** false = sectores estimados en directo; true = confirmados con los medidos por el juego. */
  sectorsExact: boolean;
  /** Diferencia con la primera fila de la tabla. */
  gapMs: number;
  /** Vuelta óptima: suma de sus mejores sectores (de cualquier vuelta válida); null si falta algún sector. */
  optimalMs: number | null;
  /** Vueltas totales dadas con ese coche en el circuito, y cuántas fueron válidas. */
  laps: number;
  validLaps: number;
  /** Agarre de la pista en su mejor vuelta (0-1), si se conoce. */
  grip: number | null;
  /** Velocidad máxima (km/h) en esa mejor vuelta, si se midió. */
  maxSpeedKmh: number | null;
  /** Temperatura del aire y de la pista (°C) en esa vuelta, si se conoce. */
  tempAir: number | null;
  tempTrack: number | null;
  /** Clima en esa vuelta (carpeta de clima o tipo de CSP), si se guardó. */
  weather: string | null;
  /** Ayudas del piloto en esa vuelta (solo si vienen de una importación). */
  aids: LapAids | null;
  /** Cuándo hizo la mejor vuelta. */
  at: string;
}

export interface RecordsDto {
  track: string;
  layout: string;
  /** Coches incluidos en la tabla (todos los jugados en el circuito si no se eligió ninguno). */
  cars: string[];
  /** Mejor tiempo absoluto de cada sector entre las filas de la tabla (morado). */
  sectorBestsMs: (number | null)[];
  entries: RecordEntryDto[];
}

export interface RecentLapDto {
  id: number;
  driverId: number;
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  sectorsMs: (number | null)[];
  sectorsExact: boolean;
  valid: boolean;
  invalidReason: string | null;
  at: string;
}

/** Eventos del canal SSE /api/live. La web los usa como señal para recargar datos. */
export type LiveEvent =
  | { type: 'status' }
  | { type: 'session' }
  | { type: 'results' }
  | { type: 'server' }
  /** Un campeonato se activó o se dio por terminado (lo usa Discord). */
  | { type: 'championship'; kind: 'started' | 'finished'; id: number }
  /** Un evento programado se acerca (`soon`, con los minutos que faltan) o empieza (`start`). */
  | { type: 'schedule'; kind: 'soon' | 'start'; name: string; minutes: number; track: string; layout: string }
  /** Vuelta nueva: lleva su combinación para que cada tabla solo recargue si le afecta. */
  | { type: 'lap'; lapId: number; valid: boolean; sessionId: number; driverId: number; track: string; layout: string; car: string };

/** Mapa de un circuito: la imagen y cómo pasar coordenadas del juego a píxeles (data/map.ini de AC). */
export interface MapInfoDto {
  track: string;
  layout: string;
  width: number;
  height: number;
  /** píxel x = (x_mundo + xOffset) / scale + margin; píxel y = (z_mundo + zOffset) / scale + margin */
  xOffset: number;
  zOffset: number;
  scale: number;
  /** Borde (px) que la imagen lleva a cada lado de `width` x `height`: la imagen mide (width + 2·margin) x (height + 2·margin). */
  margin: number;
  /** Transformación mundo → píxel ya calibrada contra la imagen (autocalibrado): px = a·x + b·z + c; py = d·x + e·z + f. Si existe, manda sobre xOffset/zOffset/scale/margin. */
  affine?: MapAffine;
  /** De dónde sale la transformación: 'ini' (map.ini correcto) o 'fitted' (corregida al comparar la línea de AC con la imagen). */
  fit?: 'ini' | 'fitted';
}

/** Circuito como línea vectorial: `points` = x, z alternados (metros del mundo de AC) y `widthM` = ancho estimado de la carretera. */
export interface TrackRoadDto { points: number[]; widthM: number }

/** [a, b, c, d, e, f]: px = a·x + b·z + c; py = d·x + e·z + f. */
export type MapAffine = [number, number, number, number, number, number];

export interface CarPositionDto {
  carId: number;
  driverId: number;
  x: number;
  z: number;
  speedKmh: number;
}

/** Posiciones en directo de todos los coches en pista (SSE /api/positions, ~10 por segundo). */
export interface PositionsDto {
  cars: CarPositionDto[];
}

// ---- Panel de control (solo disponible desde el PC que aloja el servidor) ----

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface ServerDirCheckDto {
  ok: boolean;
  exe: string | null;
  presets: string[];
  hasPlugin: boolean;
  migrated: boolean;
  tracksDir: string | null;
  problems: string[];
}

export interface AdminSettingsDto {
  serverDir: string;
  http: { port: number };
  admin: { port: number };
  server: { exe: string; preset: string; startWithHowler: boolean; stopWarningSeconds: number };
  acsp: { listenPort: number; serverPort: number; pluginPort: number; pluginCommandPort: number; forward: number[] };
  /** Idioma de los mensajes que genera el servidor (chat, Discord...). */
  language: 'es' | 'en';
}

/** Causa probable de que el servidor de AC no arranque o se caiga, deducida del texto real de su consola (ver `server-diagnosis.ts`). */
export type ServerDiagnosisId =
  | 'track-params' | 'car-checksums' | 'admin-whitelist' | 'port-in-use' | 'missing-file' | 'plugin' | 'plugin-config' | 'csp-version'
  | 'bad-config' | 'no-entries' | 'bad-timezone' | 'udp-plugin' | 'unknown';
export interface ServerDiagnosisDto {
  id: ServerDiagnosisId;
  /** Datos concretos para el texto (circuito, ruta, puerto, mensaje original...). */
  params: Record<string, string>;
  /** Arreglo de un clic que Howler sabe aplicar (null = solo explicación). */
  fix: 'allow-track-params' | 'allow-car-checksums' | null;
}

export interface AdminStateDto {
  server: {
    state: ServerState;
    pid: number | null;
    startedAt: string | null;
    lastExit: { at: string; code: number | null; expected: boolean; diagnosis: ServerDiagnosisDto[] } | null;
    /** Enlace de invitación de Content Manager del servidor en marcha (null si aún no ha salido en la consola). */
    inviteLink: string | null;
  };
  /** Hay un servidor de AC en marcha que no ha arrancado Howler (p. ej. desde Content Manager). */
  externalServerRunning: boolean;
  pluginAlive: boolean;
  check: ServerDirCheckDto;
  online: OnlineDriver[];
  settings: AdminSettingsDto;
}

export interface SessionSettingsDto {
  fuelRate: number;
  damageMultiplier: number;
  tyreWearRate: number;
}

export interface CommandResultDto {
  ok: boolean;
  reply: string;
}

// ---- Climas ----

export interface WeatherChoiceDto {
  /** Nombre de la carpeta en content/weather (lo que va en GRAPHICS=). */
  graphics: string;
  name: string;
}

export interface WeatherSystemDto {
  /** 'default' (AC), 'sol', 'pure'... */
  id: string;
  label: string;
  weathers: WeatherChoiceDto[];
}

export interface WeatherEntryDto extends WeatherChoiceDto {
  /** Posición en la lista del preset: lo que espera /setweather. */
  id: number;
  system: string;
  ambient: number;
  road: number;
}

export interface WeatherStateDto {
  /** true = clima de CSP (tipos libres); false = clásico (lista del preset). */
  fx: boolean;
  systems: WeatherSystemDto[];
  list: WeatherEntryDto[];
  /** ¿Se ve Pure instalado en este PC? (Pure lo instala cada jugador en el suyo; esto solo informa.) */
  pure: { found: boolean; where: string | null; variants: { folder: string; name: string; version: string | null }[] };
}

// ---- Torre de tiempos de la sesión en directo ----

/** morado = mejor de la sesión, verde = mejor personal, amarillo = normal, none = sin dato */
export type SectorKind = 'purple' | 'green' | 'yellow' | 'none';

export interface SectorMarkDto {
  ms: number | null;
  kind: SectorKind;
}

export interface TimingRowDto {
  position: number;
  driverId: number;
  driverName: string;
  /** Hueco del coche en el servidor mientras está conectado; null si ya no está. */
  carId: number | null;
  car: string;
  online: boolean;
  /** Mejor vuelta válida de la sesión. */
  bestMs: number | null;
  gapMs: number | null;
  lastMs: number | null;
  lastValid: boolean;
  /** La última vuelta está pendiente de revisión (no es nula: puede aprobarse). */
  lastPending: boolean;
  laps: number;
  /** Sectores de la última vuelta, coloreados según la sesión. */
  lastSectors: SectorMarkDto[];
}

export interface TimingDto {
  session: SessionSummary | null;
  /** Número de sectores del circuito (0 si aún no hay ninguna vuelta con sectores). */
  sectorCount: number;
  rows: TimingRowDto[];
}

// ---- Últimos récords ----

/**
 * Récord vigente de una combinación (circuito + coche): su mejor vuelta válida. Solo hay uno por combinación.
 * `previousMs` es el récord al que sustituyó (null si fue la primera vuelta válida de la combinación).
 */
export interface RecordDto {
  lapId: number;
  driverId: number;
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  previousMs: number | null;
  previousDriverName: string | null;
  at: string;
}

// ---- Contenido de AC (nombres reales) ----

/** Nombres reales de coches y circuitos leídos de la instalación de AC. Circuitos: clave `circuito|layout`. */
/** Coches y circuitos instalados en Assetto Corsa (para elegirlos aunque aún no se hayan corrido). */
export interface InstalledContentDto {
  cars: { id: string; name: string; brand: string | null; /** Autor según `ui_car.json` (Kunos, modders...). */ author: string | null; country: string | null; cls: string | null; year: string | null; /** RWD, FWD o AWD si las etiquetas lo dicen. */ drive: string | null; tags: string[] }[];
  tracks: { track: string; layout: string; name: string; author: string | null; /** Longitud en km (null si el `ui_track.json` no la trae). */ lengthKm: number | null; country: string | null; city: string | null; pitboxes: number | null; tags: string[] }[];
}

export interface ContentNamesDto {
  cars: Record<string, { name: string; brand: string | null }>;
  tracks: Record<string, { name: string; country: string | null }>;
}

/** Ficha de un coche o circuito para una tarjeta, leída de los archivos de AC instalados. `specs`: etiqueta → valor. */
export interface ContentCardDto {
  name: string;
  subtitle: string | null;
  specs: Record<string, string>;
  /** Solo circuitos: coordenadas de `geotags` (para enseñar dónde está el sol), si el `ui_track.json` las trae. */
  geo?: { lat: number; lon: number } | null;
}

// ---- Sesión: historial de un piloto y progresión del récord ----

/** Una vuelta de un piloto dentro de una sesión, en orden. `lapNo` cuenta desde 1 (incluye las anuladas). */
export interface SessionLapDto {
  lapNo: number;
  lapId: number;
  lapMs: number;
  valid: boolean;
  invalidReason: string | null;
  car: string;
  sectorsMs: (number | null)[];
  maxSpeedKmh: number | null;
  /** Salida de boxes: la vuelta no empezó en la línea de meta. */
  outLap: boolean;
  /** Pendiente de revisión: no cuenta en tiempos, récords ni medias hasta que quien controla Howler la apruebe. */
  pending: boolean;
  tempAir: number | null;
  tempTrack: number | null;
  /** Clima al darse la vuelta (nombre de la carpeta de clima o tipo de CSP); null en vueltas anteriores a que se guardara. */
  weather: string | null;
  aids: LapAids | null;
  at: string;
}

/** «Rey de la colina»: una vuelta válida que bajó el mejor tiempo de la sesión (de cualquier piloto o coche). */
export interface ProgressionStepDto {
  lapId: number;
  driverId: number;
  driverName: string;
  car: string;
  lapMs: number;
  /** Mejor tiempo de la sesión hasta ese momento; null para el primero. */
  previousMs: number | null;
  previousDriverName: string | null;
  at: string;
}

// ---- Fantasmas: reproducción de las mejores vueltas ----

/** Muestras de una vuelta en columnas (una posición por cada ~100 ms), listas para animarlas sobre el mapa. */
export interface TraceDto {
  /** ms desde el inicio de la vuelta; la última muestra es ≤ lapMs. */
  t: number[];
  /** Posición en el mundo de AC (mismas coordenadas que /api/map). */
  x: number[];
  z: number[];
  /** Rumbo en radianes: atan2(vz, vx) en el plano del mapa. */
  h: number[];
  /** km/h. */
  v: number[];
  gear: number[];
  rpm: number[];
  /**
   * Solo si el plugin de Howler estaba activo al grabar la vuelta: acelerador (0..1), freno (0 o 1: solo se sabe si las luces
   * de freno están encendidas) y volante (-1..1, 0 = recto; ±1 = el máximo que manda el juego).
   */
  gas?: number[];
  brake?: number[];
  steer?: number[];
  /** Deslizamiento (-1..1): negativo = rueda bloqueada, positivo = rueda girando de más. Real si el jugador tiene CSP; si no, estimado con la velocidad de las ruedas. */
  slip?: number[];
  /** Con el script de CSP del cliente: `brake` es el pedal real (0..1) y no solo encendido/apagado. */
  brakeAnalog?: boolean;
  /** Fuerzas g reales en ejes del coche (lateral: + = a la derecha; longitudinal: + = acelerando). Solo con el script de CSP del cliente. */
  latG?: number[];
  lonG?: number[];
  /** 1 = ABS / control de tracción actuando. */
  abs?: number[];
  tc?: number[];
  /** Por rueda (FL, FR, RL, RR; una serie por rueda): temperatura (°C) y presión (psi), tal como las manda el juego. */
  temp?: number[][];
  pres?: number[][];
}

export interface ReplayLapDto {
  rank: number;
  lapId: number;
  driverId: number;
  driverName: string;
  car: string;
  lapMs: number;
  maxSpeedKmh: number | null;
  /** Tiempo de cada sector de la vuelta (null donde no se midió) y si son los medidos por el juego. */
  sectorsMs: (number | null)[];
  sectorsExact: boolean;
  at: string;
  /** null si esa vuelta es anterior a la grabación de trazas (no hay nada que reproducir). */
  trace: TraceDto | null;
}

/** Las tres mejores vueltas (la mejor de cada piloto) de un circuito para los coches elegidos. */
export interface ReplayDto {
  track: string;
  layout: string;
  laps: ReplayLapDto[];
}

/** Coches del servidor y si exigen `data.acd` a los jugadores (ver `car-checksums.ts` del servidor). */
export interface CarChecksumsStateDto {
  cars: { model: string; required: boolean; unpacked: boolean; skipped: boolean; missing: boolean; linked: boolean }[];
  /** `IgnoreConfigurationErrors.MissingCarChecksums` activo en el extra_cfg.yml del preset. */
  flag: boolean;
}

/** Un hueco (plaza) de la lista de coches del servidor (`entry_list.ini`). */
export interface EntrySlotDto {
  model: string;
  skin: string;
  driverName: string;
  team: string;
  guid: string;
  ballast: number;
  restrictor: number;
  fixedSetup: string;
  spectator: boolean;
  extras: [string, string][];
  /** Piloto de Howler al que está reservada la plaza (se saca del Steam ID); al guardar, su Steam ID pasa a `guid`. */
  driverId?: number | null;
}
export interface EntryListDto {
  slots: EntrySlotDto[];
  maxClients: number | null;
  /** Circuito y layout del preset, y plazas de boxes que dice AC (null = no se sabe). */
  track: string;
  layout: string;
  pitboxes: number | null;
}

// ---- Copias de seguridad ----
export interface BackupFileDto { name: string; bytes: number; at: string; auto: boolean }
export interface PendingRestoreDto { createdAt: string; howlerVersion: string; schemaVersion: number; hasAvatars: number; hasImages: number }
export interface BackupStateDto {
  settings: { auto: boolean; everyDays: number; keep: number };
  backups: BackupFileDto[];
  /** Copia ya validada que se aplicará al volver a abrir Howler. */
  pending: PendingRestoreDto | null;
}
