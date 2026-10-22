import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES, type LapRules } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { applyLapAction, revalidate } from './revalidate';
import { judgeLap } from './lap-rules';

const R = (id: keyof typeof BUILTIN_PROFILES) => BUILTIN_PROFILES[id]!.rules;

/** Historial con vueltas buenas, con cortes y con choques de distinta fuerza. */
function seed() {
  const repo = new Repository(openDatabase(':memory:'));
  const s = repo.createSession({ track: 'monza', layout: '', name: 'Practice', type: 1 });
  const ana = repo.upsertDriver('7656119000000001', 'Ana');
  const lap = (lapMs: number, o: { cuts?: number; hits?: { kind: 'car' | 'env'; speed: number }[]; track?: string } = {}) => {
    const cuts = o.cuts ?? 0;
    const hits = o.hits ?? [];
    // Se juzga como lo haría el tracker con las reglas de entonces (solo cortes)
    const v = judgeLap({ lapMs, cuts, incidents: hits }, R('cortes'));
    return repo.insertLap(
      { sessionId: s.id, driverId: ana, track: o.track ?? 'monza', layout: '', car: 'mx5', lapMs, sectorsMs: [], cuts, grip: 1, valid: v.valid, invalidReason: v.reason },
      hits.map((h) => ({ ...h, otherDriverId: null })),
    );
  };
  const ids = {
    clean: lap(100_000),
    cut: lap(99_000, { cuts: 1 }),
    soft: lap(98_000, { hits: [{ kind: 'env', speed: 10 }] }),
    hard: lap(97_000, { hits: [{ kind: 'car', speed: 60 }] }),
    other: lap(96_000, { track: 'imola', hits: [{ kind: 'env', speed: 40 }] }),
  };
  return { repo, ids };
}
const valid = (repo: Repository) => new Map(repo.lapAdmin.recent(50).map((l) => [l.id, l.valid]));
const strictEverywhere = () => R('estricto');

describe('revalidate', () => {
  it('probar (dryRun) cuenta lo que cambiaría sin tocar nada', () => {
    const { repo, ids } = seed();
    const before = valid(repo);
    const r = revalidate(repo, strictEverywhere, { dryRun: true });
    expect(r).toMatchObject({ applied: false, total: 5, toInvalid: 3, toValid: 0, skippedManual: 0 });
    expect(r.samples.map((s) => s.lapId).sort()).toEqual([ids.soft, ids.hard, ids.other].sort());
    expect(valid(repo)).toEqual(before);
  });

  it('aplicar cambia la validez, con el motivo, y las vueltas ya anuladas por corte se quedan igual', () => {
    const { repo, ids } = seed();
    const r = revalidate(repo, strictEverywhere, { dryRun: false });
    expect(r.applied).toBe(true);
    const laps = new Map(repo.lapAdmin.recent(50).map((l) => [l.id, l]));
    expect(laps.get(ids.clean)!.valid).toBe(true);
    expect(laps.get(ids.cut)).toMatchObject({ valid: false, reason: 'Anulada por corte' });
    expect(laps.get(ids.soft)).toMatchObject({ valid: false, reason: 'Anulada por choque con el entorno a 10 km/h' });
    expect(laps.get(ids.hard)!.reason).toContain('otro coche a 60 km/h');
  });

  it('con unas reglas más suaves las vueltas anuladas vuelven a ser válidas (se puede ir y volver)', () => {
    const { repo, ids } = seed();
    revalidate(repo, strictEverywhere, { dryRun: false });
    const back = revalidate(repo, () => R('cortes'), { dryRun: false });
    expect(back).toMatchObject({ toValid: 3, toInvalid: 0 });
    expect(valid(repo).get(ids.soft)).toBe(true);
    expect(valid(repo).get(ids.cut)).toBe(false); // el corte sigue anulando
  });

  it('las reglas pueden ser distintas por circuito', () => {
    const { repo, ids } = seed();
    const rulesFor = (track: string): LapRules => (track === 'imola' ? R('estricto') : R('cortes'));
    revalidate(repo, rulesFor, { dryRun: false });
    expect(valid(repo).get(ids.other)).toBe(false);
    expect(valid(repo).get(ids.hard)).toBe(true);
  });

  it('las vueltas con decisión manual del administrador no se tocan', () => {
    const { repo, ids } = seed();
    applyLapAction(repo, () => R('cortes'), ids.clean, 'void', 'atajo');
    applyLapAction(repo, () => R('cortes'), ids.cut, 'valid', null);
    const r = revalidate(repo, strictEverywhere, { dryRun: false });
    expect(r.skippedManual).toBe(2);
    expect(valid(repo).get(ids.clean)).toBe(false); // anulada a mano: sigue anulada
    expect(valid(repo).get(ids.cut)).toBe(true); // dada por buena a mano: sigue buena aunque tenga un corte
  });

  it('una pasada con las mismas reglas no cambia nada', () => {
    const { repo } = seed();
    expect(revalidate(repo, () => R('cortes'), { dryRun: false })).toMatchObject({ toInvalid: 0, toValid: 0 });
  });
});

describe('applyLapAction', () => {
  it('anular a mano deja el motivo y la vuelta deja de contar en los tiempos', () => {
    const { repo, ids } = seed();
    expect(repo.records('monza', '', ['mx5']).entries[0]!.lapMs).toBe(97_000);
    expect(applyLapAction(repo, () => R('cortes'), ids.hard, 'void', 'atajo por la chicane')).toEqual({ valid: false, pending: false, reason: 'Anulada por el administrador: atajo por la chicane' });
    expect(repo.records('monza', '', ['mx5']).entries[0]!.lapMs).toBe(98_000); // la de 97.000 ya no cuenta: manda la siguiente mejor válida
  });

  it('restaurar a mano da la vuelta por buena y «reset» la devuelve a las reglas', () => {
    const { repo, ids } = seed();
    expect(applyLapAction(repo, () => R('estricto'), ids.cut, 'valid', 'fallo del servidor')).toEqual({ valid: true, pending: false, reason: null });
    expect(applyLapAction(repo, () => R('estricto'), ids.cut, 'reset', null)).toEqual({ valid: false, pending: false, reason: 'Anulada por corte' });
    expect(repo.lapAdmin.get(ids.cut)!.override).toBeNull();
  });

  it('una vuelta que no existe da null', () => {
    const { repo } = seed();
    expect(applyLapAction(repo, () => R('cortes'), 9999, 'void', null)).toBeNull();
  });
});

describe('vueltas pendientes de revisión', () => {
  function seedPending() {
    const repo = new Repository(openDatabase(':memory:'));
    const s = repo.createSession({ track: 'monza', layout: '', name: 'P', type: 1 });
    const ana = repo.upsertDriver('A', 'Ana');
    const add = (lapMs: number, pending = false) =>
      repo.insertLap({ sessionId: s.id, driverId: ana, track: 'monza', layout: '', car: 'mx5', lapMs, sectorsMs: [], cuts: 0, grip: 1, valid: !pending, pending, outLap: pending, invalidReason: pending ? 'Pendiente de revisión: salida de boxes' : null }, []);
    return { repo, normal: add(100_000), pend: add(90_000, true) };
  }

  it('no cuentan en los tiempos hasta que se aprueban; aprobar la hace récord', () => {
    const { repo, pend } = seedPending();
    expect(repo.records('monza', '', ['mx5']).entries[0]!.lapMs).toBe(100_000);
    expect(applyLapAction(repo, () => R('cortes'), pend, 'valid', null)).toMatchObject({ valid: true, pending: false });
    expect(repo.records('monza', '', ['mx5']).entries[0]!.lapMs).toBe(90_000);
  });

  it('«reset» la devuelve a pendiente y «anular» la deja nula', () => {
    const { repo, pend } = seedPending();
    applyLapAction(repo, () => R('cortes'), pend, 'valid', null);
    expect(applyLapAction(repo, () => R('cortes'), pend, 'reset', null)).toMatchObject({ valid: false, pending: true });
    expect(applyLapAction(repo, () => R('cortes'), pend, 'void', null)).toMatchObject({ valid: false, pending: false });
  });

  it('recalcular no cambia las pendientes y recent(.., true) solo lista pendientes', () => {
    const { repo, pend } = seedPending();
    expect(revalidate(repo, () => R('cortes'), { dryRun: false })).toMatchObject({ toInvalid: 0, toValid: 0 });
    expect(repo.lapAdmin.get(pend)).toMatchObject({ pending: true, valid: false });
    expect(repo.lapAdmin.recent(10, true).map((l) => l.id)).toEqual([pend]);
    expect(repo.lapAdmin.recent(10)).toHaveLength(2);
  });
});

describe('vueltas ajenas (copias de otro Howler)', () => {
  it('no se pueden anular ni aprobar desde aquí: solo decide su dueño', () => {
    const { repo, ids } = seed() as any;
    (repo as any).db.prepare("UPDATE laps SET origin = 'otro-howler', origin_id = 1, origin_rev = 1 WHERE id = ?").run(ids.clean);
    expect(applyLapAction(repo, () => R('cortes'), ids.clean, 'void', 'x')).toBeNull();
    expect((repo as any).db.prepare('SELECT valid FROM laps WHERE id = ?').get(ids.clean).valid).toBe(1);
  });
});
