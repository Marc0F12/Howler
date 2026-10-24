// Fichas de piloto, circuito y coche, y sus listados. Los pilotos se identifican siempre por `driverId` interno:
// el Steam ID no sale nunca por la API.

/** Totales de un conjunto de vueltas (las de un piloto, un circuito o un coche). */
export interface TotalsDto {
  laps: number;
  validLaps: number;
  /** Vueltas pendientes de revisión (p. ej. salidas de boxes): no cuentan hasta que se aprueban. */
  pendingLaps: number;
  /** Cortes de pista acumulados. */
  cuts: number;
  /** Suma de los tiempos de vuelta, sin contar las salidas de boxes: el tiempo que se ha pasado dando vueltas (ms). */
  timeMs: number;
  sessions: number;
  /** Circuitos (con su layout) y coches distintos. */
  tracks: number;
  cars: number;
  /** Pilotos distintos. */
  drivers: number;
  /** Velocidad máxima registrada (km/h). */
  maxSpeedKmh: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

/** Cuántas vueltas dio algo o alguien en un día (últimos 90 días). */
export interface ActivityDayDto {
  day: string;
  laps: number;
}

export interface BusyDriverDto {
  driverId: number;
  driverName: string;
  laps: number;
}

// ---- Piloto ----

export interface DriverListItemDto {
  id: number;
  name: string;
  laps: number;
  validLaps: number;
  tracks: number;
  cars: number;
  lastSeen: string;
}

/** Cómo le va a un piloto con un coche en un circuito. */
export interface DriverComboStatDto {
  track: string;
  layout: string;
  car: string;
  laps: number;
  validLaps: number;
  /** Mejor vuelta válida; null si todas están anuladas. */
  bestMs: number | null;
  /** Media de sus vueltas válidas y su desviación típica (cuanto menor, más regular). */
  avgMs: number | null;
  stdMs: number | null;
  /** Salidas de boxes (no cuentan en la media ni en la regularidad). */
  outLaps: number;
  maxSpeedKmh: number | null;
  /** Puesto entre todos los pilotos de esa combinación (por mejor vuelta válida) y cuántos hay. */
  rank: number | null;
  drivers: number;
  /** Récord de la combinación (de cualquier piloto). */
  recordMs: number | null;
  lastAt: string;
}

export interface DriverSessionStatDto {
  id: number;
  track: string;
  layout: string;
  name: string;
  type: number;
  startedAt: string;
  laps: number;
  validLaps: number;
  bestMs: number | null;
  /** Puesto en esa sesión por mejor vuelta válida, y cuántos pilotos tuvieron tiempo. */
  position: number | null;
  drivers: number;
  cars: string[];
}

export interface DriverProfileDto {
  id: number;
  name: string;
  firstSeen: string;
  lastSeen: string;
  totals: TotalsDto;
  /** Choques con otros coches y con el entorno. */
  carCollisions: number;
  envCollisions: number;
  /** Récords vigentes (puesto 1 de su combinación) y podios (top 3, incluidos los récords). */
  records: number;
  podiums: number;
  favoriteTrack: { track: string; layout: string; laps: number } | null;
  favoriteCar: { car: string; laps: number } | null;
  combos: DriverComboStatDto[];
  /** Evolución del mejor tiempo personal por combinación: un punto cada vez que lo mejoró (el primero es su primera vuelta válida). */
  progress: DriverProgressDto[];
  sessions: DriverSessionStatDto[];
  activity: ActivityDayDto[];
  /** Kilómetros recorridos en vueltas completas (vueltas × longitud del circuito de AC); null si no se conoce ninguna. */
  km?: number | null;
}

export interface DriverProgressDto {
  track: string;
  layout: string;
  car: string;
  points: { at: string; ms: number }[];
}

// ---- Circuito ----

export interface TrackListItemDto {
  track: string;
  layout: string;
  laps: number;
  drivers: number;
  cars: number;
  lastAt: string;
  recordMs: number | null;
  recordDriverId: number | null;
  recordDriverName: string | null;
  recordCar: string | null;
}

/** Una fila de una clasificación de tiempos: la mejor vuelta válida de un piloto. */
export interface TopTimeDto {
  position: number;
  driverId: number;
  driverName: string;
  car: string;
  lapMs: number;
  /** Diferencia con el primero. */
  gapMs: number;
  /** Vueltas que ha dado ese piloto con ese coche allí. */
  laps: number;
  maxSpeedKmh: number | null;
  at: string;
}

/** El mejor tiempo de un coche en un circuito. */
export interface TrackCarRecordDto {
  car: string;
  bestMs: number | null;
  driverId: number | null;
  driverName: string | null;
  laps: number;
  drivers: number;
}

export interface TrackProfileDto {
  track: string;
  layout: string;
  totals: TotalsDto;
  /** La mejor vuelta del circuito, de cualquier piloto y coche. */
  record: TopTimeDto | null;
  /** Hasta 50 mejores tiempos, uno por piloto (con su mejor coche). La web enseña los 5, 10, 25 o 50 primeros. */
  top: TopTimeDto[];
  cars: TrackCarRecordDto[];
  busiest: BusyDriverDto[];
  activity: ActivityDayDto[];
}

// ---- Coche ----

export interface CarListItemDto {
  car: string;
  laps: number;
  drivers: number;
  tracks: number;
  lastAt: string;
}

/** El mejor tiempo con un coche en un circuito. */
export interface CarTrackRecordDto {
  track: string;
  layout: string;
  bestMs: number | null;
  driverId: number | null;
  driverName: string | null;
  laps: number;
  drivers: number;
  at: string | null;
}

export interface CarProfileDto {
  car: string;
  totals: TotalsDto;
  tracks: CarTrackRecordDto[];
  busiest: BusyDriverDto[];
  activity: ActivityDayDto[];
}

// ---- Rankings ----

export interface RankingEntryDto { driverId: number; driverName: string; value: number }

/** Clasificaciones de pilotos (top N de cada una; 10 por defecto). */
export interface RankingsDto {
  /** Más vueltas dadas. */
  laps: RankingEntryDto[];
  /** Más récords vigentes (combinaciones de circuito y coche donde tiene el mejor tiempo; solo cuentan las que corrió más de un piloto). */
  records: RankingEntryDto[];
  /** Más tiempo dando vueltas (ms). */
  timeMs: RankingEntryDto[];
  /** Mayor porcentaje de vueltas válidas (0-100), con al menos 20 vueltas. */
  cleanPct: RankingEntryDto[];
  /** Más circuitos distintos. */
  tracks: RankingEntryDto[];
  /** Más vueltas válidas. */
  validLaps: RankingEntryDto[];
  /** Velocidad máxima alcanzada (km/h). */
  topSpeed: RankingEntryDto[];
  /** Más sesiones distintas. */
  sessions: RankingEntryDto[];
  /** Más coches distintos. */
  cars: RankingEntryDto[];
  /** Más días distintos con actividad. */
  daysActive: RankingEntryDto[];
  /** Más podios (top 3 de circuito y coche con rivales). */
  podiums: RankingEntryDto[];
}

// ---- Historial de sesiones ----

/** Una sesión (práctica, clasificación o carrera) en el listado del historial. */
export interface SessionHistoryItemDto {
  id: number;
  /** Insignia del servidor donde se dio la sesión (este u otro Howler vinculado). */
  serverBadge: string;
  serverBadgeBg: string;
  serverBadgeFg: string;
  track: string;
  layout: string;
  name: string;
  /** 1 práctica, 2 clasificación, 3 carrera. */
  type: number;
  startedAt: string;
  endedAt: string | null;
  laps: number;
  validLaps: number;
  drivers: number;
  /** Hasta 6 pilotos, de más a menos vueltas. */
  driverNames: { id: number; name: string }[];
  cars: string[];
  bestMs: number | null;
  bestDriverName: string | null;
}

export interface SessionHistoryPageDto {
  total: number;
  items: SessionHistoryItemDto[];
}
