import type { LapChangeDto, LapRules, RevalidationDto } from '@howler/shared';
import type { Repository } from '../db/repository';
import { judgeWithReview } from './lap-rules';

const BATCH = 2000;
const SAMPLES = 30;

/**
 * Vuelve a juzgar todas las vueltas guardadas con unas reglas. Con `dryRun` solo cuenta lo que cambiaría (para
 * comprobar las reglas antes de aplicarlas). Las vueltas con decisión manual del administrador no se tocan.
 * Al aplicar, se actualizan también las trazas de fantasmas (solo las 3 mejores vueltas válidas de cada combinación).
 */
export function revalidate(repo: Repository, rulesFor: (track: string, layout: string) => LapRules, opts: { dryRun: boolean }): RevalidationDto {
  const out: RevalidationDto = { applied: !opts.dryRun, total: 0, toInvalid: 0, toValid: 0, skippedManual: 0, samples: [] };
  const touched = new Map<string, { track: string; layout: string; car: string }>();
  let after = 0;

  for (;;) {
    const laps = repo.lapAdmin.batch(after, BATCH);
    if (laps.length === 0) break;
    after = laps.at(-1)!.id;
    // Al aplicar, cada tanda va en una transacción: todo o nada, y sin un guardado (con sus disparadores) por cada vuelta.
    const work = () => {
      for (const l of laps) {
        out.total++;
        if (l.override) { out.skippedManual++; continue; }
        const verdict = judgeWithReview({ lapMs: l.lapMs, cuts: l.cuts, incidents: l.incidents }, rulesFor(l.track, l.layout), l.outLap);
        if (verdict.valid === l.valid && verdict.pending === l.pending) {
          // Mismo estado: si cambia solo el motivo (texto), se actualiza sin contarlo como cambio.
          if (!opts.dryRun && !verdict.valid && verdict.reason !== l.reason) repo.lapAdmin.setValidity(l.id, false, verdict.reason, verdict.pending);
          continue;
        }
        // Se cuenta por resultado: pasar de «anulada» a «pendiente» (o al revés) no es ni «ahora válida» ni «ahora anulada».
        if (verdict.valid) out.toValid++;
        else if (!verdict.pending) out.toInvalid++;
        if (out.samples.length < SAMPLES) {
          const s: LapChangeDto = { lapId: l.id, driverName: l.driverName, track: l.track, layout: l.layout, car: l.car, lapMs: l.lapMs, nowValid: verdict.valid, reason: verdict.reason };
          out.samples.push(s);
        }
        if (!opts.dryRun) {
          repo.lapAdmin.setValidity(l.id, verdict.valid, verdict.reason, verdict.pending);
          touched.set(`${l.track}|${l.layout}|${l.car}`, { track: l.track, layout: l.layout, car: l.car });
        }
      }
    };
    if (opts.dryRun) work(); else repo.lapAdmin.inTransaction(work);
  }

  for (const c of touched.values()) repo.pruneTraces(c.track, c.layout, c.car);
  return out;
}

export type LapAction = 'void' | 'valid' | 'reset';

/**
 * Decisión manual sobre una vuelta: anularla, darla por buena o devolverla a las reglas.
 * Devuelve la vuelta ya actualizada o null si no existe.
 */
export function applyLapAction(
  repo: Repository, rulesFor: (track: string, layout: string) => LapRules, lapId: number, action: LapAction, note: string | null,
): { valid: boolean; pending: boolean; reason: string | null } | null {
  const lap = repo.lapAdmin.get(lapId);
  if (!lap) return null;
  let valid: boolean;
  let pending = false;
  let reason: string | null;
  if (action === 'reset') {
    repo.lapAdmin.setOverride(lapId, null, null);
    ({ valid, pending, reason } = judgeWithReview({ lapMs: lap.lapMs, cuts: lap.cuts, incidents: lap.incidents }, rulesFor(lap.track, lap.layout), lap.outLap));
  } else if (action === 'void') {
    repo.lapAdmin.setOverride(lapId, 'void', note);
    valid = false;
    reason = note ? `Anulada por el administrador: ${note}` : 'Anulada por el administrador';
  } else {
    // «valid» también es APROBAR una vuelta pendiente: pasa a válida con todos sus efectos (tiempos, récords, medias).
    repo.lapAdmin.setOverride(lapId, 'valid', note);
    valid = true;
    reason = null;
  }
  repo.lapAdmin.setValidity(lapId, valid, reason, pending);
  repo.pruneTraces(lap.track, lap.layout, lap.car);
  return { valid, pending, reason };
}
