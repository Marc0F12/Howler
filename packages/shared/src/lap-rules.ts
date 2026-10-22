// Reglas de vuelta válida: qué hace que una vuelta se anule. Se evalúan siempre con los mismos datos guardados de cada
// vuelta (cortes, choques con su velocidad y tiempo), así que cambiar las reglas permite recalcular todo el historial.

/** Qué hacer con los choques de un tipo. */
export interface CollisionRule {
  /** `ignore`: no anulan la vuelta; `invalidate`: la anulan si el golpe es de al menos `minSpeedKmh`. */
  mode: 'ignore' | 'invalidate';
  /** Velocidad mínima del golpe (km/h) para que cuente; 0 = cualquier golpe. */
  minSpeedKmh: number;
}

export interface LapRules {
  /** Cortes de pista que se toleran en una vuelta (0 = cualquier corte la anula). */
  maxCuts: number;
  /** Choques con otros coches y con el entorno (muros, vallas...). */
  carCollisions: CollisionRule;
  envCollisions: CollisionRule;
  /** Se anulan las vueltas más rápidas que esto (ms): tiempos imposibles por atajos o fallos. 0 = sin límite. */
  minLapMs: number;
  /** Avisar por el chat del servidor al piloto cuando se le anula una vuelta. */
  notifyDriver: boolean;
  /** Las salidas de boxes se anulan solas en vez de quedar pendientes de revisión. Lo pone la configuración global, no el perfil. */
  autoVoidOutLaps?: boolean;
}

export interface RuleProfile {
  name: string;
  description?: string;
  rules: LapRules;
}

export interface LapRulesConfig {
  /** Perfil que se aplica en los circuitos sin uno propio. */
  default: string;
  /** Perfiles propios (se suman a los predefinidos). */
  profiles: Record<string, RuleProfile>;
  /** Perfil de un circuito: la clave es `circuito` (todos sus layouts) o `circuito|layout`. */
  tracks: Record<string, string>;
  /** Anular automáticamente las salidas de boxes (apagado = quedan pendientes de revisión). */
  autoVoidOutLaps?: boolean;
}

const none: CollisionRule = { mode: 'ignore', minSpeedKmh: 0 };

/** Perfiles que vienen con Howler. «cortes» es el por defecto: es lo que Howler hacía hasta ahora. */
export const BUILTIN_PROFILES: Record<string, RuleProfile> = {
  cortes: {
    name: 'Solo cortes',
    description: 'Se anula la vuelta si hay algún corte de pista. Los choques no la anulan.',
    rules: { maxCuts: 0, carCollisions: none, envCollisions: none, minLapMs: 0, notifyDriver: false },
  },
  estandar: {
    name: 'Estándar',
    description: 'Cortes y choques fuertes (a partir de 25 km/h) anulan la vuelta; los roces no.',
    rules: { maxCuts: 0, carCollisions: { mode: 'invalidate', minSpeedKmh: 25 }, envCollisions: { mode: 'invalidate', minSpeedKmh: 25 }, minLapMs: 0, notifyDriver: false },
  },
  estricto: {
    name: 'Estricto (como stracker)',
    description: 'Cualquier corte o choque, por leve que sea, anula la vuelta.',
    rules: { maxCuts: 0, carCollisions: { mode: 'invalidate', minSpeedKmh: 0 }, envCollisions: { mode: 'invalidate', minSpeedKmh: 0 }, minLapMs: 0, notifyDriver: false },
  },
};


// ---- Panel: respuestas de la API de reglas ----

export interface LapRulesStateDto {
  config: LapRulesConfig;
  builtins: Record<string, RuleProfile>;
}

/** Una vuelta cuya validez cambiaría (o ha cambiado) con unas reglas. */
export interface LapChangeDto {
  lapId: number;
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  nowValid: boolean;
  reason: string | null;
}

/** Resultado de probar (o aplicar) unas reglas sobre todo el historial. */
export interface RevalidationDto {
  applied: boolean;
  total: number;
  toInvalid: number;
  toValid: number;
  /** Vueltas que el administrador decidió a mano: no se tocan. */
  skippedManual: number;
  /** Las primeras vueltas que cambian, para comprobar que las reglas hacen lo que se espera. */
  samples: LapChangeDto[];
}

/** Vuelta reciente para gestionarla a mano. */
export interface AdminLapDto {
  id: number;
  driverName: string;
  track: string;
  layout: string;
  car: string;
  lapMs: number;
  valid: boolean;
  reason: string | null;
  cuts: number;
  collisions: number;
  /** Salida de boxes: no empezó en la línea de meta. */
  outLap: boolean;
  /** Pendiente de revisión: no cuenta hasta que se apruebe. */
  pending: boolean;
  /** Decisión manual del administrador, si la hay. */
  override: 'valid' | 'void' | null;
  at: string;
}
