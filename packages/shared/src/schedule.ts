/**
 * Eventos programados: un preset de sesión que se aplica y arranca el servidor a una hora (una vez o cada semana).
 * Las horas son las del PC donde corre Howler (hora local, sin zona). Aquí vive el modelo y el cálculo de fechas, que usan
 * el servidor (para ejecutarlos) y el panel (para enseñar la próxima vez).
 */

export type ScheduleWhen =
  | { kind: 'once'; /** `YYYY-MM-DDTHH:mm`, hora local del PC. */ at: string }
  | { kind: 'weekly'; /** 0 = domingo … 6 = sábado. */ days: number[]; /** `HH:mm`. */ time: string };

export interface ScheduledEventInput {
  name: string;
  enabled: boolean;
  /** Preset de sesión que se aplica antes de arrancar; null = no tocar los ajustes. */
  presetId: string | null;
  when: ScheduleWhen;
  /** Parar el servidor tantos minutos después de arrancar; null = lo deja en marcha. */
  stopAfterMinutes: number | null;
  /** Avisos por el chat (si hay jugadores) tantos minutos antes. */
  announceMinutes: number[];
  /** Circuito y layout que se ponen antes de arrancar; null = no tocar el del servidor. */
  track: { track: string; layout: string } | null;
  /** Coches de la lista del servidor (coche y plazas de cada uno); vacío = no tocar la lista. */
  entries: { car: string; count: number }[];
  /** Avisar por Discord (si está configurado y el aviso activado en la pestaña Discord) al acercarse y al empezar. */
  discord: boolean;
}

export type ScheduleStatus = 'disabled' | 'waiting' | 'running' | 'done' | 'missed';

export interface ScheduledEventDto extends ScheduledEventInput {
  id: string;
  presetName: string | null;
  /** Próxima vez (ISO); null si ya pasó o está apagado. */
  nextAt: string | null;
  lastRun: string | null;
  lastResult: 'ran' | 'missed' | null;
  /** Cuándo se parará solo (ISO), si está en marcha con parada programada. */
  stopAt: string | null;
  status: ScheduleStatus;
}

export interface ScheduleStateDto {
  events: ScheduledEventDto[];
  /** Hora actual del PC de Howler (ISO), para enseñar «dentro de…» sin fiarse del reloj del navegador. */
  now: string;
  /** Tolerancia: si Howler estaba apagado y se pasa más de esto, el evento se da por perdido (minutos). */
  graceMinutes: number;
}

export const MAX_SCHEDULED_EVENTS = 40;
export const MAX_SCHEDULE_NAME = 60;
export const SCHEDULE_GRACE_MINUTES = 10;
export const MAX_ANNOUNCES = 5;
export const MAX_EVENT_SLOTS = 100;
/** Nombres de carpeta de AC (coche, circuito, layout): sin rutas ni caracteres raros. */
const AC_ID = /^[\w][\w .-]{0,99}$/;

const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** `YYYY-MM-DDTHH:mm` → fecha local; null si no es una fecha real. */
export function parseLocalDateTime(s: string): Date | null {
  const m = AT.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi ? date : null;
}

function parseTime(s: string): [number, number] | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}

/** Cada vez que ocurre el evento entre `from` (incluido) y `to` (incluido), por orden. */
function occurrencesBetween(when: ScheduleWhen, from: Date, to: Date): Date[] {
  if (when.kind === 'once') {
    const at = parseLocalDateTime(when.at);
    return at && at >= from && at <= to ? [at] : [];
  }
  const t = parseTime(when.time);
  if (!t) return [];
  const out: Date[] = [];
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (; day <= to; day.setDate(day.getDate() + 1)) {
    if (!when.days.includes(day.getDay())) continue;
    const c = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t[0], t[1], 0, 0);
    if (c >= from && c <= to) out.push(c);
  }
  return out;
}

const DAY = 24 * 3_600_000;

/** La vez más reciente que ya ha tocado (≤ `now`), o null. */
export function latestOccurrence(when: ScheduleWhen, now: Date): Date | null {
  if (when.kind === 'once') { const a = occurrencesBetween(when, new Date(0), now); return a[0] ?? null; }
  const a = occurrencesBetween(when, new Date(now.getTime() - 8 * DAY), now);
  return a.at(-1) ?? null;
}

/** La primera vez que toca después de `now`, o null (una vez que ya pasó). */
export function nextOccurrence(when: ScheduleWhen, now: Date): Date | null {
  const later = new Date(now.getTime() + 1);
  if (when.kind === 'once') { const a = occurrencesBetween(when, later, new Date(8640000000000000)); return a[0] ?? null; }
  return occurrencesBetween(when, later, new Date(now.getTime() + 8 * DAY))[0] ?? null;
}

/** Valida lo que llega del panel; lanza con un mensaje claro. Devuelve el objeto limpio. */
export function validateScheduleInput(raw: unknown): ScheduledEventInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : '';
  if (name === '') throw new Error('El evento necesita un nombre.');
  if (name.length > MAX_SCHEDULE_NAME) throw new Error(`El nombre es demasiado largo (máximo ${MAX_SCHEDULE_NAME} letras).`);
  const w = (r.when ?? {}) as Record<string, unknown>;
  let when: ScheduleWhen;
  if (w.kind === 'once') {
    if (typeof w.at !== 'string' || parseLocalDateTime(w.at) === null) throw new Error('La fecha y hora no son válidas.');
    when = { kind: 'once', at: w.at };
  } else if (w.kind === 'weekly') {
    const days = Array.isArray(w.days) ? [...new Set(w.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort() : [];
    if (days.length === 0) throw new Error('Elige al menos un día de la semana.');
    if (typeof w.time !== 'string' || parseTime(w.time) === null) throw new Error('La hora no es válida.');
    when = { kind: 'weekly', days, time: w.time };
  } else throw new Error('Elige si el evento es una sola vez o semanal.');
  let stopAfterMinutes: number | null = null;
  if (r.stopAfterMinutes != null) {
    const n = Number(r.stopAfterMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 1440) throw new Error('La parada automática va de 5 minutos a 24 horas.');
    stopAfterMinutes = n;
  }
  const ann = Array.isArray(r.announceMinutes) ? r.announceMinutes : [];
  const announceMinutes = [...new Set(ann.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 1440).sort((a, b) => b - a);
  if (announceMinutes.length !== new Set(ann.map(Number)).size) throw new Error('Los avisos van de 1 minuto a 24 horas.');
  if (announceMinutes.length > MAX_ANNOUNCES) throw new Error(`Como mucho ${MAX_ANNOUNCES} avisos por evento.`);
  const presetId = typeof r.presetId === 'string' && r.presetId !== '' ? r.presetId : null;
  let track: ScheduledEventInput['track'] = null;
  if (r.track != null) {
    const t = r.track as Record<string, unknown>;
    const layout = typeof t.layout === 'string' ? t.layout : '';
    if (typeof t.track !== 'string' || !AC_ID.test(t.track) || (layout !== '' && !AC_ID.test(layout))) throw new Error('El circuito no es válido.');
    track = { track: t.track, layout };
  }
  const rawEntries = Array.isArray(r.entries) ? r.entries : [];
  const entries: ScheduledEventInput['entries'] = [];
  for (const e of rawEntries) {
    const q = e as Record<string, unknown>;
    const count = Number(q.count);
    if (typeof q.car !== 'string' || !AC_ID.test(q.car) || !Number.isInteger(count) || count < 1) throw new Error('La lista de coches no es válida.');
    const same = entries.find((x) => x.car === q.car);
    if (same) same.count += count; else entries.push({ car: q.car, count });
  }
  if (entries.reduce((n, e) => n + e.count, 0) > MAX_EVENT_SLOTS) throw new Error('Demasiadas plazas en la lista de coches.');
  return { name, enabled: r.enabled !== false, presetId, when, stopAfterMinutes, announceMinutes, track, entries, discord: r.discord !== false };
}
