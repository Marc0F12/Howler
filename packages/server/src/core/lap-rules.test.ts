import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, type LapRulesConfig } from '@howler/shared';
import { judgeLap, resolveRules, type LapFacts } from './lap-rules';

const facts = (o: Partial<LapFacts> = {}): LapFacts =>
  ({ lapMs: 100_000, cuts: 0, incidents: [], ...o });
const R = (id: keyof typeof BUILTIN_PROFILES) => BUILTIN_PROFILES[id]!.rules;

describe('judgeLap', () => {
  it('por defecto (solo cortes) conserva el comportamiento anterior', () => {
    expect(judgeLap(facts())).toEqual({ valid: true, reason: null });
    expect(judgeLap(facts({ cuts: 1 }))).toEqual({ valid: false, reason: 'Anulada por corte' });
    // los choques no anulan en este perfil
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 90 }, { kind: 'car', speed: 90 }] })).valid).toBe(true);
  });

  it('estricto: cualquier choque anula, y el motivo dice con qué y a qué velocidad', () => {
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 3.4 }] }), R('estricto')).reason).toBe('Anulada por choque con otro coche a 3 km/h');
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 52.3 }] }), R('estricto')).reason).toBe('Anulada por choque con el entorno a 52 km/h');
  });

  it('estándar: los roces por debajo del umbral no anulan, los golpes fuertes sí', () => {
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 24.9 }] }), R('estandar')).valid).toBe(true);
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 25 }] }), R('estandar')).valid).toBe(false);
    // varios golpes: manda el más fuerte
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 30 }, { kind: 'car', speed: 80 }] }), R('estandar')).reason).toContain('80 km/h');
  });

  it('cada tipo de choque tiene su propia regla', () => {
    const rules = { ...R('cortes'), carCollisions: { mode: 'invalidate' as const, minSpeedKmh: 0 } };
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 99 }] }), rules).valid).toBe(true);
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 1 }] }), rules).valid).toBe(false);
  });

  it('entre coches cuenta la velocidad RELATIVA: un roce a 120 km/h yendo juntos no es un choque a 120', () => {
    const rules = R('estandar'); // anula choques desde 25 km/h
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 120, relSpeed: 4 }] }), rules).valid).toBe(true);
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 120, relSpeed: 80 }] }), rules).reason).toBe('Anulada por choque con otro coche a 80 km/h');
    // sin velocidad relativa medida se usa la del juego
    expect(judgeLap(facts({ incidents: [{ kind: 'car', speed: 120, relSpeed: null }] }), rules).valid).toBe(false);
    // con el entorno no hay relativa: manda siempre la del juego
    expect(judgeLap(facts({ incidents: [{ kind: 'env', speed: 60, relSpeed: 1 }] }), rules).valid).toBe(false);
  });

  it('se pueden tolerar algunos cortes', () => {
    const rules = { ...R('cortes'), maxCuts: 2 };
    expect(judgeLap(facts({ cuts: 2 }), rules).valid).toBe(true);
    expect(judgeLap(facts({ cuts: 3 }), rules)).toEqual({ valid: false, reason: 'Anulada: 3 cortes (se permiten 2)' });
  });

  it('tiempo mínimo: una vuelta imposible se anula', () => {
    const rules = { ...R('cortes'), minLapMs: 90_000 };
    expect(judgeLap(facts({ lapMs: 89_999 }), rules).reason).toBe('Anulada: tiempo imposible (menos de 1:30.000)');
    expect(judgeLap(facts({ lapMs: 90_000 }), rules).valid).toBe(true);
    expect(judgeLap(facts({ lapMs: 1_000 }), R('cortes')).valid).toBe(true); // 0 = sin límite
  });
});

describe('resolveRules', () => {
  const cfg: LapRulesConfig = {
    default: 'cortes',
    profiles: { drift: { name: 'Mis reglas', rules: { ...R('cortes'), maxCuts: 5 } } },
    tracks: { monza: 'estricto', 'imola|gp': 'estandar', 'spa|': 'drift' },
  };

  it('el circuito manda sobre el perfil por defecto, y el layout concreto sobre el circuito', () => {
    expect(resolveRules(cfg, 'monza', '').profileId).toBe('estricto');
    expect(resolveRules(cfg, 'monza', 'junior').profileId).toBe('estricto'); // vale para todos sus layouts
    expect(resolveRules(cfg, 'imola', 'gp').profileId).toBe('estandar');
    expect(resolveRules(cfg, 'imola', 'otro').profileId).toBe('cortes');
    expect(resolveRules(cfg, 'spa', '').rules.maxCuts).toBe(5); // perfil propio
  });

  it('un perfil que ya no existe vuelve al seguro (solo cortes) en vez de romper', () => {
    expect(resolveRules({ default: 'borrado', profiles: {}, tracks: {} }, 'x', '')).toMatchObject({ profileId: 'cortes' });
  });

  it('un perfil propio puede usarse como perfil por defecto', () => {
    expect(resolveRules({ ...cfg, default: 'drift' }, 'otro', '').rules.maxCuts).toBe(5);
  });
});

describe('resolveRules con nombres heredados de Object', () => {
  it('un perfil llamado «constructor» no existe: vuelve al perfil seguro', () => {
    const cfg = { default: 'constructor', profiles: {}, tracks: { toString: 'x' } } as never;
    expect(resolveRules(cfg, 'monza', '').profileId).toBe('cortes');
    expect(resolveRules(cfg, 'toString', '').rules).toBeDefined();
  });
});

describe('salidas de boxes', () => {
  const facts = { lapMs: 90_000, cuts: 0, incidents: [] };
  it('por defecto quedan pendientes de revisión', async () => {
    const { judgeWithReview } = await import('./lap-rules');
    expect(judgeWithReview(facts, undefined, true)).toMatchObject({ valid: false, pending: true });
  });
  it('con anulación automática salen nulas y no pendientes', async () => {
    const { judgeWithReview, resolveRules } = await import('./lap-rules');
    const rules = resolveRules({ default: 'cortes', profiles: {}, tracks: {}, autoVoidOutLaps: true }, 'monza', '').rules;
    expect(judgeWithReview(facts, rules, true)).toMatchObject({ valid: false, pending: false, reason: 'Salida de boxes (anulada automáticamente)' });
    expect(judgeWithReview(facts, rules, false)).toMatchObject({ valid: true, pending: false });
  });
});
