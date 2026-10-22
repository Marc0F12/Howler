import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { LapRules, SessionSummary } from '@howler/shared';
import type { Repository } from '../db/repository';
import type { Bus } from './bus';
import { judgeLap } from './lap-rules';

/**
 * Al acabar cada sesión el servidor escribe results/*.json con todas las vueltas, y por cada una los
 * sectores medidos por el juego del propio piloto (al milisegundo). Howler los usa para dejar exactos los
 * sectores estimados en directo y para recuperar vueltas que no vio (Howler apagado, reinicio...).
 */

export interface ResultLap {
  driverName: string;
  driverGuid: string;
  carModel: string;
  lapMs: number;
  /** Vacío si el archivo no trae sectores fiables (deben sumar exactamente la vuelta). */
  sectorsMs: number[];
  cuts: number;
}

export function parseResults(raw: string): ResultLap[] {
  const json = JSON.parse(raw);
  const laps: unknown[] = Array.isArray(json?.Laps) ? json.Laps : [];
  const out: ResultLap[] = [];
  for (const l of laps as Record<string, any>[]) {
    if (typeof l?.LapTime !== 'number' || l.LapTime <= 0 || !l.DriverGuid) continue;
    const sectors: number[] = Array.isArray(l.Sectors) ? l.Sectors.filter((n: unknown) => Number.isFinite(n)) : [];
    const sum = sectors.reduce((a, b) => a + b, 0);
    out.push({
      driverName: String(l.DriverName ?? ''),
      driverGuid: String(l.DriverGuid),
      carModel: String(l.CarModel ?? ''),
      lapMs: l.LapTime,
      sectorsMs: sectors.length > 0 && sum === l.LapTime ? sectors : [],
      cuts: Number(l.Cuts) || 0,
    });
  }
  return out;
}

export interface ReconcileResult {
  fixed: number;
  added: number;
}

/** Casa cada vuelta del archivo con las guardadas (piloto + tiempo exacto) y la corrige o la añade. */
export function reconcile(
  repo: Repository, session: SessionSummary, laps: ResultLap[], rulesFor?: (track: string, layout: string) => LapRules,
): ReconcileResult {
  const used = new Set<number>();
  let fixed = 0;
  let added = 0;
  for (const l of laps) {
    const driverId = repo.upsertDriver(l.driverGuid, l.driverName || l.driverGuid);
    const match = repo.lapsByTime(session.id, driverId, l.lapMs).find((c) => !used.has(c.id));
    if (match) {
      used.add(match.id);
      if (!match.exact && l.sectorsMs.length) {
        repo.setExactSectors(match.id, l.sectorsMs);
        fixed++;
      }
    } else {
      const verdict = judgeLap({ lapMs: l.lapMs, cuts: l.cuts, incidents: [] }, rulesFor?.(session.track, session.layout));
      const id = repo.insertLap(
        {
          sessionId: session.id, driverId, track: session.track, layout: session.layout, car: l.carModel,
          lapMs: l.lapMs, sectorsMs: l.sectorsMs, cuts: l.cuts, grip: null, valid: verdict.valid,
          invalidReason: verdict.reason, sectorsExact: l.sectorsMs.length > 0, source: 'results',
        },
        [],
      );
      used.add(id);
      added++;
    }
  }
  return { fixed, added };
}

/** El paquete de fin de sesión da el nombre del archivo; puede ser relativo al servidor o absoluto. */
function locate(serverDir: string, filename: string): string | null {
  const candidates = [
    isAbsolute(filename) ? filename : join(serverDir, filename),
    join(serverDir, 'results', basename(filename)),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lee los resultados de una sesión terminada (con reintentos: el archivo puede tardar un instante en aparecer). */
export async function importSessionResults(o: {
  repo: Repository;
  bus: Bus;
  serverDir: string;
  session: SessionSummary;
  filename: string;
  rulesFor?: (track: string, layout: string) => LapRules;
}): Promise<ReconcileResult | null> {
  if (!o.serverDir) return null;
  for (const wait of [0, 500, 1500, 4000]) {
    await sleep(wait);
    const file = locate(o.serverDir, o.filename);
    if (!file) continue;
    try {
      const result = reconcile(o.repo, o.session, parseResults(readFileSync(file, 'utf8')), o.rulesFor);
      console.log(`[howler] resultados de la sesión ${o.session.id}: ${result.fixed} vueltas con sectores confirmados, ${result.added} añadidas`);
      o.bus.emit({ type: 'results' });
      return result;
    } catch (e) {
      console.warn('[howler] no se pudieron leer los resultados:', (e as Error).message);
    }
  }
  console.warn(`[howler] no encontré el archivo de resultados «${o.filename}» de la sesión ${o.session.id}`);
  return null;
}
