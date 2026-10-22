// DTOs de la importación desde otras herramientas (stracker). El Steam ID (o su hash) nunca sale del servidor:
// los jugadores se identifican por el número que tienen en el archivo importado.

export interface StrackerPlayerDto {
  id: number;
  name: string;
  laps: number;
  sessions: number;
  /** Piloto de Howler con el mismo nombre (si hay uno solo), propuesto para enlazar. */
  suggestedDriverId: number | null;
}
export interface StrackerTrackDto {
  /** Nombre tal cual en stracker (p. ej. «csp/0/../ks_silverstone-gp»). */
  raw: string;
  track: string;
  layout: string;
  laps: number;
  /** ¿Howler (o el contenido de AC instalado) reconoce este circuito y layout? Si no, conviene revisarlo. */
  known: boolean;
}
export interface StrackerSeasonDto { id: number; name: string; sessions: number }

export interface StrackerPreviewDto {
  uploadId: string;
  /** Versión del esquema del archivo (user_version). */
  version: number;
  sessions: number;
  laps: number;
  /** Vueltas del archivo que traen temperatura, y vueltas que traen alguna ayuda (con AssettoServer, stracker no las suele guardar). */
  lapsWithTemps: number;
  lapsWithAids: number;
  /** Sesiones del archivo que traen ajustes de combustible, daños o desgaste. */
  sessionsWithSettings: number;
  /** Sesiones de este archivo que ya estaban importadas (se saltarán). */
  alreadyImported: number;
  from: string | null;
  to: string | null;
  players: StrackerPlayerDto[];
  tracks: StrackerTrackDto[];
  seasons: StrackerSeasonDto[];
  existingDrivers: { id: number; name: string }[];
}

export type PlayerChoice = { mode: 'new' } | { mode: 'link'; driverId: number } | { mode: 'skip' };

export interface StrackerApplyInput {
  uploadId: string;
  /** Por número de jugador del archivo. */
  players: Record<string, PlayerChoice>;
  /** Por nombre de circuito de stracker. */
  tracks: Record<string, { track: string; layout: string }>;
  /** Crear como borradores los campeonatos que tuviera stracker. */
  championships: boolean;
}

export interface ImportReportDto {
  sessionsImported: number;
  sessionsSkipped: number;
  laps: number;
  lapsValid: number;
  lapsInvalid: number;
  lapsPending: number;
  /** Vueltas que stracker marcó como inválidas y que con las reglas de Howler cuentan (o al revés). */
  validityChanged: number;
  /** Sesiones ya importadas a las que se añadieron los ajustes (combustible, daños, desgaste) que faltaban. */
  sessionsUpdated: number;
  /** Vueltas de sesiones ya importadas a las que se añadieron temperaturas o ayudas que faltaban. */
  lapsUpdated: number;
  driversCreated: number;
  driversLinked: number;
  championshipsCreated: number;
  notes: string[];
}
