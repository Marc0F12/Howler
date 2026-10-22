// Penalizaciones de carrera. Un aviso solo se guarda; los segundos se suman al tiempo total de la carrera del piloto
// (cambian su puesto) y una descalificación lo deja fuera de la clasificación de esa sesión.

export type PenaltyKind = 'warning' | 'time' | 'dsq';

export interface PenaltyDto {
  id: number;
  sessionId: number;
  driverId: number;
  driverName: string;
  kind: PenaltyKind;
  /** Segundos añadidos (solo `time`). */
  seconds: number | null;
  reason: string;
  createdAt: string;
}

export interface PenaltyInput {
  sessionId: number;
  driverId: number;
  kind: PenaltyKind;
  seconds?: number;
  reason: string;
  /** Avisar por el chat del servidor (a todos) de que se ha puesto la penalización. */
  announce?: boolean;
}

/** Penalizaciones automáticas de carrera: segundos por cada corte y por cada choque de al menos cierta velocidad. 0 = no penalizar. */
export interface RacePenaltyRules {
  cutSeconds: number;
  carHitSeconds: number;
  carHitMinKmh: number;
  envHitSeconds: number;
  envHitMinKmh: number;
}
export const NO_RACE_PENALTIES: RacePenaltyRules = { cutSeconds: 0, carHitSeconds: 0, carHitMinKmh: 0, envHitSeconds: 0, envHitMinKmh: 0 };

/** «+5 s», «Aviso», «Descalificado». */
export function formatPenalty(p: { kind: PenaltyKind; seconds: number | null }): string {
  return p.kind === 'dsq' ? 'Descalificado' : p.kind === 'warning' ? 'Aviso' : `+${p.seconds ?? 0} s`;
}

/** Sesión reciente para elegir a quién penalizar. */
export interface PenaltySessionDto {
  id: number;
  track: string;
  layout: string;
  type: number;
  startedAt: string;
  drivers: { id: number; name: string; laps: number }[];
}
