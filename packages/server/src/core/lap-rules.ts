import { formatLapTime, BUILTIN_PROFILES, type CollisionRule, type LapRules, type LapRulesConfig } from '@howler/shared';

export interface LapFacts {
  lapMs: number;
  cuts: number;
  /** `relSpeed`: velocidad relativa entre los dos coches (solo choques entre coches, si se pudo medir). */
  incidents: { kind: 'car' | 'env'; speed: number; relSpeed?: number | null }[];
}

export interface LapVerdict {
  valid: boolean;
  /** Texto para la web, p. ej. «Anulada por corte». */
  reason: string | null;
}

const DEFAULT_RULES: LapRules = BUILTIN_PROFILES.cortes!.rules;

/** El golpe más fuerte de un tipo que, según la regla, anula la vuelta (o null si ninguno lo hace). */
function strongestHit(incidents: LapFacts['incidents'], kind: 'car' | 'env', rule: CollisionRule): number | null {
  if (rule.mode !== 'invalidate') return null;
  // Entre coches cuenta la velocidad RELATIVA si se midió: dos coches que van juntos a 120 km/h y se rozan no chocan a 120.
  const speedOf = (i: LapFacts['incidents'][number]) => (kind === 'car' ? i.relSpeed ?? i.speed : i.speed);
  const hits = incidents.filter((i) => i.kind === kind && speedOf(i) >= rule.minSpeedKmh).map(speedOf);
  return hits.length ? Math.max(...hits) : null;
}

/**
 * ÚNICO sitio donde se decide si una vuelta es válida. Solo mira datos que se guardan de cada vuelta (tiempo, cortes y
 * choques con su velocidad), así que se puede volver a ejecutar sobre todo el historial cuando cambian las reglas.
 */
export function judgeLap(facts: LapFacts, rules: LapRules = DEFAULT_RULES): LapVerdict {
  if (facts.cuts > rules.maxCuts) {
    return { valid: false, reason: rules.maxCuts === 0 ? 'Anulada por corte' : `Anulada: ${facts.cuts} cortes (se permiten ${rules.maxCuts})` };
  }
  const car = strongestHit(facts.incidents, 'car', rules.carCollisions);
  if (car != null) return { valid: false, reason: `Anulada por choque con otro coche a ${Math.round(car)} km/h` };
  const env = strongestHit(facts.incidents, 'env', rules.envCollisions);
  if (env != null) return { valid: false, reason: `Anulada por choque con el entorno a ${Math.round(env)} km/h` };
  if (rules.minLapMs > 0 && facts.lapMs < rules.minLapMs) {
    return { valid: false, reason: `Anulada: tiempo imposible (menos de ${formatLapTime(rules.minLapMs)})` };
  }
  return { valid: true, reason: null };
}

export interface ReviewVerdict extends LapVerdict {
  /** Pendiente de revisión: no es nula, pero tampoco cuenta hasta que quien controla Howler la apruebe. */
  pending: boolean;
}

/**
 * Veredicto completo de una vuelta: válida, nula (la anulan las reglas) o **pendiente de revisión**. Una salida de boxes que
 * las reglas no anulan queda pendiente: su tiempo no es el de una vuelta normal, así que hay que mirarla antes de contarla.
 */
export function judgeWithReview(facts: LapFacts, rules: LapRules | undefined, outLap: boolean): ReviewVerdict {
  const v = judgeLap(facts, rules);
  if (v.valid && outLap) {
    if (rules?.autoVoidOutLaps) return { valid: false, pending: false, reason: 'Salida de boxes (anulada automáticamente)' };
    return { valid: false, pending: true, reason: 'Pendiente de revisión: salida de boxes' };
  }
  return { ...v, pending: false };
}

/** Valor de una clave PROPIA del objeto (nada de «constructor» o «toString» heredados de Object). */
const own = <T>(obj: Record<string, T>, key: string): T | undefined => (Object.hasOwn(obj, key) ? obj[key] : undefined);

/** Qué perfil y qué reglas se aplican en un circuito: el suyo (con layout o sin él) o el por defecto. */
export function resolveRules(cfg: LapRulesConfig, track: string, layout: string): { profileId: string; rules: LapRules } {
  const id = own(cfg.tracks, `${track}|${layout}`) ?? own(cfg.tracks, track) ?? cfg.default;
  const profile = own(cfg.profiles, id) ?? own(BUILTIN_PROFILES, id);
  const auto = cfg.autoVoidOutLaps === true;
  if (profile) return { profileId: id, rules: auto ? { ...profile.rules, autoVoidOutLaps: true } : profile.rules };
  return { profileId: 'cortes', rules: auto ? { ...DEFAULT_RULES, autoVoidOutLaps: true } : DEFAULT_RULES }; // perfil que ya no existe: se vuelve al seguro
}
