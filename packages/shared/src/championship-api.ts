// DTOs de campeonatos (web pública y panel). El Steam ID nunca aparece: los pilotos van por su id interno.
import type { BadgeDesign } from './badge';
import type { ScoringConfig, Standings } from './championship';

export type ChampionshipFormat = 'individual' | 'pairs' | 'teams';
export type ChampionshipStatus = 'draft' | 'active' | 'finished';

/** `car` y `track` salen como tarjetas con su ficha; el resto, solo como botón de descarga. */
export type ChampionshipModKind = 'car' | 'track' | 'weather' | 'skins' | 'other';
export interface ChampionshipModInput {
  name: string;
  kind: ChampionshipModKind;
  /** Enlace de descarga (el botón de la web lleva aquí). */
  url: string;
  note?: string | null;
  imageUrl?: string | null;
  /** Etiqueta → valor: potencia, peso, tracción, marchas, país, longitud... */
  specs?: Record<string, string>;
}
export interface ChampionshipModDto { id: number; name: string; kind: ChampionshipModKind; url: string; note: string | null; imageUrl: string | null; specs: Record<string, string> }
/** Una cita del fin de semana de una prueba (línea de tiempo de la web). */
export const SCHEDULE_KINDS = ['practice', 'quali', 'race', 'post', 'custom'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export interface ScheduleItem {
  kind: ScheduleKind;
  /** Fecha y hora de inicio (ISO); sin ella se enseña la duración. */
  at: string | null;
  /** Título propio; si no, el del tipo. */
  title?: string;
  /** Duración libre: «20 minutos», «15 - 20 minutos». */
  duration?: string;
  /** Descripción opcional. */
  text?: string;
}
/** Cómo encaja la imagen del campeonato en su marco: `cover` llena el marco (foto), `contain` la enseña entera (insignia, copa). */
export type CupImageFit = 'cover' | 'contain';
export interface ChampionshipTeamDto { id: number; name: string; color: string }
/** `car` y `skin` son lo que el administrador asignó (o, si no, lo que tenga el piloto en la lista de coches del servidor); null = sin asignar. */
export interface ChampionshipEntryDto { driverId: number; name: string; teamId: number | null; color: string | null; car: string | null; skin: string | null }

export interface ChampionshipRoundDto {
  id: number;
  number: number;
  track: string;
  layout: string;
  cars: string[];
  practiceAt: string | null;
  qualiAt: string | null;
  raceAt: string | null;
  /** Clima de la carrera (nombre de clima de AC o tipo de CSP); null = sin decir (la web enseña sol con nube). */
  weather: string | null;
  /** Calendario completo (horarios con descripción, post carrera...); null = solo las tres fechas de arriba. */
  schedule: ScheduleItem[] | null;
  raceSessionId: number | null;
  qualiSessionId: number | null;
  played: boolean;
  mods: ChampionshipModDto[];
  /** Resultado de la carrera de cada inscrito que corrió, con los puntos que le dio. Vacío si aún no se ha corrido. */
  results: {
    driverId: number; finishPos: number | null; qualiPos: number | null; bestLapMs: number | null; laps: number; points: number;
    /** Tiempo total de carrera con las penalizaciones ya sumadas (ms) y lo que estas suponen; `dsq` = descalificado. */
    totalMs: number | null; penaltyMs: number; dsq: boolean; notes: string[];
  }[];
}

export interface ChampionshipSummaryDto {
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  imageFit: CupImageFit | null;
  /** Diseño de la insignia hecha en el creador del panel (null = imagen propia o sin imagen); sirve para enlazar los créditos de los emblemas. */
  badgeDesign: BadgeDesign | null;
  /** Colores de los primeros equipos (#rrggbb): la insignia automática de un campeonato sin imagen los usa. */
  teamColors: string[];
  format: ChampionshipFormat;
  status: ChampionshipStatus;
  /** Nombre del Howler del que viene (copia de solo lectura); null si es de aquí. */
  sharedFrom: string | null;
  rounds: number;
  played: number;
  participants: number;
  /** Solo en el panel: solicitudes de inscripción sin revisar. */
  pendingSignups?: number;
  next: { number: number; track: string; layout: string; raceAt: string | null } | null;
  leader: { driverId: number; name: string } | null;
}

export interface ChampionshipDto extends ChampionshipSummaryDto {
  scoring: ScoringConfig;
  teams: ChampionshipTeamDto[];
  entries: ChampionshipEntryDto[];
  roundList: ChampionshipRoundDto[];
  mods: ChampionshipModDto[];
  standings: Standings;
  adjustments: { id: number; driverId: number; round: number; points: number; reason: string }[];
}

/** Lo que manda el asistente al crear o editar. `teamKey` enlaza a un equipo de `teams`; `id` conserva una carrera existente. */
export interface ChampionshipInput {
  name: string;
  description?: string;
  imageUrl?: string | null;
  imageFit?: CupImageFit | null;
  badgeDesign?: BadgeDesign | null;
  format: ChampionshipFormat;
  status?: ChampionshipStatus;
  scoring: ScoringConfig;
  teams: { key: string; name: string; color: string }[];
  entries: { driverId: number; teamKey: string | null; color?: string | null; car?: string | null; skin?: string | null }[];
  rounds: {
    id?: number;
    track: string;
    layout?: string;
    cars?: string[];
    practiceAt?: string | null;
    qualiAt?: string | null;
    raceAt?: string | null;
    weather?: string | null;
    schedule?: ScheduleItem[] | null;
    mods?: ChampionshipModInput[];
  }[];
  mods?: ChampionshipModInput[];
}

/** Sesiones de carrera aún sin asignar a ninguna prueba, para confirmarlas a mano. */
export interface SessionCandidateDto {
  sessionId: number;
  track: string;
  layout: string;
  type: number;
  startedAt: string;
  enrolledDrivers: number;
  suggestedRound: number | null;
}

/** Ruta de una imagen subida desde el panel; la otra opción válida es un enlace http(s). */
export const CHAMPIONSHIP_IMAGE_PATH = /^\/api\/championship-images\/[0-9a-f]{32}\.(?:png|jpg|webp|gif)$/;
/** ¿Es una imagen de campeonato utilizable (subida o enlace externo)? */
export const isChampionshipImageRef = (u: string | null | undefined): u is string => !!u && (CHAMPIONSHIP_IMAGE_PATH.test(u) || /^https?:\/\/\S+$/i.test(u));
