import type { DatabaseSync } from 'node:sqlite';
import { decodeTrace } from '../core/lap-trace';

type Row = Record<string, any>;

/** Una traza de vuelta tal como viaja entre Howlers (`data` = la traza empaquetada, en base64). */
export interface WireTrace { id: number; samples: number; data: string }

/** Tope de una traza empaquetada que se acepta de otro Howler. */
export const MAX_WIRE_TRACE_BYTES = 300_000;

/**
 * Trayectorias (trazas) de las mejores vueltas, intercambiadas entre Howlers para que el comparador y los fantasmas
 * también funcionen con los pilotos de servidores vinculados. Es un «pedir y contestar»: cada lado pide las trazas de las
 * vueltas ajenas que le faltan y contesta con las propias.
 */
export class MhTraces {
  constructor(private db: DatabaseSync, private prune: (track: string, layout: string, car: string) => void) {}

  /**
   * Ids (en el Howler de origen) de las vueltas de `origin` cuya traza me falta: solo la mejor vuelta válida de cada piloto
   * en cada combinación (las demás nunca guardan traza) y que aún no he pedido.
   */
  wanted(origin: string, limit = 8): number[] {
    return (this.db.prepare(
      `SELECT l.origin_id FROM laps l
       WHERE l.origin = ? AND l.valid = 1 AND l.trace_checked = 0
         AND NOT EXISTS (SELECT 1 FROM lap_traces t WHERE t.lap_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM laps o WHERE o.driver_id = l.driver_id AND o.track = l.track AND o.layout = l.layout AND o.car = l.car
                          AND o.valid = 1 AND o.id <> l.id AND (o.lap_ms < l.lap_ms OR (o.lap_ms = l.lap_ms AND o.id < l.id)))
       ORDER BY l.id DESC LIMIT ?`,
    ).all(origin, limit) as Row[]).map((r) => r.origin_id as number);
  }

  /** Contesta a una petición: las trazas de MIS vueltas (no las copias) que existen. `done` = ids ya contestados (con o sin traza). */
  answer(ids: number[], maxBytes = 400_000): { traces: WireTrace[]; done: number[] } {
    const get = this.db.prepare('SELECT t.samples, t.data FROM lap_traces t JOIN laps l ON l.id = t.lap_id WHERE l.id = ? AND l.origin IS NULL');
    const traces: WireTrace[] = [], done: number[] = [];
    let bytes = 0;
    for (const id of ids) {
      const r = get.get(id) as Row | undefined;
      const data = r?.data ? Buffer.from(r.data as Uint8Array) : null;
      if (data && bytes + data.length > maxBytes && traces.length > 0) break; // el resto, en la siguiente ronda
      if (data) { traces.push({ id, samples: r!.samples as number, data: data.toString('base64') }); bytes += data.length; }
      done.push(id);
    }
    return { traces, done };
  }

  /** Guarda las trazas recibidas en las copias de las vueltas de `origin` y marca como «ya pedidas» todas las contestadas. Devuelve cuántas se guardaron. */
  apply(origin: string, traces: WireTrace[], done: number[]): number {
    const find = this.db.prepare('SELECT id, track, layout, car FROM laps WHERE origin = ? AND origin_id = ? AND valid = 1');
    const save = this.db.prepare('INSERT OR REPLACE INTO lap_traces (lap_id, samples, data) VALUES (?, ?, ?)');
    let saved = 0;
    for (const t of traces) {
      const lap = find.get(origin, t.id) as Row | undefined;
      if (!lap) continue;
      const data = Buffer.from(t.data, 'base64');
      if (data.length === 0 || data.length > MAX_WIRE_TRACE_BYTES) continue;
      let samples: number;
      try { samples = decodeTrace(data).t.length; } catch { continue; } // no es una traza válida: se ignora
      if (samples < 10 || samples > 200_000) continue;
      save.run(lap.id, samples, data);
      this.prune(lap.track, lap.layout, lap.car);
      saved++;
    }
    const mark = this.db.prepare('UPDATE laps SET trace_checked = 1 WHERE origin = ? AND origin_id = ?');
    for (const id of done) mark.run(origin, id);
    return saved;
  }
}
