import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, any>;

/** Tipos de sesión de AC (los que guarda Howler en `sessions.type`). */
const SESSION_TYPE = ['Reserva', 'Práctica', 'Clasificación', 'Carrera'];

const COLUMNS = ['id', 'fecha', 'sesion', 'tipo_sesion', 'circuito', 'layout', 'coche', 'piloto', 'tiempo_ms', 'tiempo', 'estado', 'motivo', 'cortes', 'sectores_ms', 'velocidad_max_kmh', 'temp_aire_c', 'temp_pista_c', 'clima', 'agarre', 'origen'] as const;

const fmt = (ms: number) => {
  const m = Math.floor(ms / 60000), s = ms % 60000;
  return `${m}:${(s / 1000).toFixed(3).padStart(6, '0')}`;
};

/** Escapa un campo CSV (comillas, comas, saltos) y neutraliza fórmulas de hoja de cálculo (=, +, -, @) en textos. */
export function csvField(v: unknown): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Exportación de todas las vueltas guardadas a filas planas (CSV o JSON). Sin Steam ID: solo el nombre del piloto, igual que la web.
 * Las vueltas de otros Howler se marcan con su origen.
 */
export class LapExport {
  constructor(private db: DatabaseSync) {}

  columns(): readonly string[] { return COLUMNS; }

  /** Filas de 500 en 500 (no carga toda la base de datos en memoria). */
  *rows(opts: { onlyValid?: boolean } = {}): Generator<Record<string, string | number | null>> {
    const q = this.db.prepare(
      `SELECT l.id, l.created_at, l.track, l.layout, l.car, l.lap_ms, l.valid, l.pending, l.invalid_reason, l.cuts, l.max_speed, l.temp_air, l.temp_track,
              l.weather, l.grip, l.origin, s.id AS session_id, s.name AS session_name, s.type AS session_type, d.name AS driver_name, o.name AS origin_name
       FROM laps l JOIN drivers d ON d.id = l.driver_id JOIN sessions s ON s.id = l.session_id LEFT JOIN mh_origins o ON o.uuid = l.origin
       WHERE l.id > ? ${opts.onlyValid ? 'AND l.valid = 1' : ''} ORDER BY l.id LIMIT 500`,
    );
    let last = 0;
    for (;;) {
      const batch = q.all(last) as Row[];
      if (batch.length === 0) return;
      const ids = batch.map((r) => r.id as number);
      const secs = new Map<number, number[]>();
      for (const r of this.db.prepare(`SELECT lap_id, idx, ms FROM lap_sectors WHERE lap_id IN (${ids.map(() => '?').join(',')}) ORDER BY lap_id, idx`).all(...ids) as Row[]) {
        const a = secs.get(r.lap_id) ?? [];
        a[r.idx] = r.ms;
        secs.set(r.lap_id, a);
      }
      for (const r of batch) {
        yield {
          id: r.id, fecha: r.created_at, sesion: r.session_id, tipo_sesion: SESSION_TYPE[r.session_type] ?? String(r.session_type),
          circuito: r.track, layout: r.layout, coche: r.car, piloto: r.driver_name, tiempo_ms: r.lap_ms, tiempo: fmt(r.lap_ms),
          estado: r.valid ? 'válida' : r.pending ? 'pendiente' : 'nula', motivo: r.invalid_reason ?? '', cortes: r.cuts,
          sectores_ms: (secs.get(r.id) ?? []).map((v) => v ?? '').join(' '),
          velocidad_max_kmh: r.max_speed == null ? null : Math.round(r.max_speed), temp_aire_c: r.temp_air, temp_pista_c: r.temp_track,
          clima: r.weather ?? '', agarre: r.grip, origen: r.origin ? (r.origin_name ?? 'otro Howler') : 'este Howler',
        };
        last = r.id;
      }
    }
  }

  *csv(opts: { onlyValid?: boolean } = {}): Generator<string> {
    yield '﻿' + COLUMNS.join(';') + '\r\n'; // BOM + «;»: Excel en español lo abre bien
    for (const row of this.rows(opts)) yield COLUMNS.map((c) => csvField(row[c])).join(';') + '\r\n';
  }

  /** JSON en líneas (una vuelta por línea): sirve para cualquier tamaño sin cargarlo entero. */
  *jsonLines(opts: { onlyValid?: boolean } = {}): Generator<string> {
    for (const row of this.rows(opts)) yield JSON.stringify(row) + '\n';
  }
}
