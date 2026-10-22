import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  latestOccurrence, MAX_SCHEDULED_EVENTS, nextOccurrence, SCHEDULE_GRACE_MINUTES, validateScheduleInput,
  type ScheduledEventDto, type ScheduledEventInput, type ScheduleStateDto,
} from '@howler/shared';
import { st } from '../core/lang';
import type { StoredSessionPreset } from './session-presets';

/**
 * Eventos programados (ver shared/schedule.ts): a la hora marcada se aplica un preset de sesión y se arranca (o reinicia) el
 * servidor de AC; opcionalmente se avisa por el chat antes y se para solo al cabo de un rato. Viven en `<dataDir>/schedule.json`.
 */

interface StoredEvent extends ScheduledEventInput {
  id: string;
  /** Última vez (hora prevista, ISO) que Howler ya trató, para no repetirla. */
  lastRun: string | null;
  lastResult: 'ran' | 'missed' | null;
  /** Cuándo se parará solo (ISO). */
  stopAt: string | null;
}

const FILE = 'schedule.json';
const ID = /^e[0-9a-f]{12}$/;
const path = (dataDir: string) => join(dataDir, FILE);

export function readSchedule(dataDir: string): StoredEvent[] {
  try {
    const raw = JSON.parse(readFileSync(path(dataDir), 'utf8')) as { events?: unknown };
    const out: StoredEvent[] = [];
    for (const e of Array.isArray(raw.events) ? raw.events : []) {
      const q = e as Partial<StoredEvent>;
      if (!q || typeof q.id !== 'string' || !ID.test(q.id)) continue;
      try {
        out.push({
          ...validateScheduleInput(q), id: q.id,
          lastRun: typeof q.lastRun === 'string' ? q.lastRun : null,
          lastResult: q.lastResult === 'ran' || q.lastResult === 'missed' ? q.lastResult : null,
          stopAt: typeof q.stopAt === 'string' ? q.stopAt : null,
        });
      } catch { /* evento roto: se salta */ }
    }
    return out.slice(0, MAX_SCHEDULED_EVENTS);
  } catch {
    return [];
  }
}

function write(dataDir: string, events: StoredEvent[]) {
  const file = path(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ events }, null, 2) + '\n');
  renameSync(tmp, file);
}

export interface SchedulerDeps {
  dataDir: string;
  presets: () => StoredSessionPreset[];
  /** Prepara el servidor para el evento: ajustes del preset (si lo hay), circuito y lista de coches. */
  apply: (ev: ScheduledEventInput, preset: StoredSessionPreset | null) => void;
  /** Avisa de que el evento se acerca (`soon`, con los minutos) o empieza (`start`), p. ej. a Discord. */
  notify?: (kind: 'soon' | 'start', ev: ScheduledEventInput, minutes: number) => void;
  serverState: () => 'stopped' | 'starting' | 'running' | 'stopping';
  start: () => void;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  playersOnline: () => number;
  say: (msg: string) => Promise<void>;
  log: (msg: string) => void;
  now?: () => Date;
}

export class Scheduler {
  private busy = false;
  /** Avisos ya mandados (evento|hora|minutos), para no repetirlos en cada vuelta del reloj. */
  private announced = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private d: SchedulerDeps) {}

  private now() { return (this.d.now ?? (() => new Date()))(); }

  start(everyMs = 20_000) {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, everyMs);
    this.timer.unref?.();
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  state(): ScheduleStateDto {
    const now = this.now();
    const presets = this.d.presets();
    const events = readSchedule(this.d.dataDir).map((e): ScheduledEventDto => {
      const next = e.enabled ? nextOccurrence(e.when, now) : null;
      const stopAt = e.stopAt && new Date(e.stopAt) > now ? e.stopAt : null;
      const status = !e.enabled ? 'disabled' : stopAt ? 'running' : next ? 'waiting' : e.lastResult === 'missed' ? 'missed' : 'done';
      return { ...e, presetName: presets.find((p) => p.id === e.presetId)?.name ?? null, nextAt: next?.toISOString() ?? null, stopAt, status };
    });
    return { events, now: now.toISOString(), graceMinutes: SCHEDULE_GRACE_MINUTES };
  }

  save(id: string | null, raw: unknown): ScheduleStateDto {
    const input = validateScheduleInput(raw);
    const now = this.now();
    if (input.when.kind === 'once' && nextOccurrence(input.when, now) === null) throw new Error('Esa fecha y hora ya han pasado.');
    // Lo que ya tocó antes de guardar no se ejecuta: si no, crear un evento «a las 10:00» a las 10:05 lo lanzaría al momento.
    const baseline = { lastRun: latestOccurrence(input.when, now)?.toISOString() ?? null, lastResult: null };
    const cur = readSchedule(this.d.dataDir);
    if (id !== null) {
      const old = cur.find((e) => e.id === id);
      if (!old) throw new Error('No existe ese evento.');
      const keep = JSON.stringify(old.when) === JSON.stringify(input.when) && (old.enabled || !input.enabled);
      write(this.d.dataDir, cur.map((e) => (e.id === id ? { ...e, ...input, ...(keep ? {} : baseline) } : e)));
    } else {
      if (cur.length >= MAX_SCHEDULED_EVENTS) throw new Error(`Ya hay ${MAX_SCHEDULED_EVENTS} eventos: borra alguno antes de añadir otro.`);
      write(this.d.dataDir, [...cur, { ...input, id: `e${randomBytes(6).toString('hex')}`, ...baseline, stopAt: null }]);
    }
    return this.state();
  }

  remove(id: string): ScheduleStateDto {
    const cur = readSchedule(this.d.dataDir);
    if (!cur.some((e) => e.id === id)) throw new Error('No existe ese evento.');
    write(this.d.dataDir, cur.filter((e) => e.id !== id));
    return this.state();
  }

  /** «Ejecutar ahora»: aplica el preset y arranca o reinicia el servidor sin esperar a la hora. */
  async runNow(id: string): Promise<ScheduleStateDto> {
    const ev = readSchedule(this.d.dataDir).find((e) => e.id === id);
    if (!ev) throw new Error('No existe ese evento.');
    await this.run(ev, null);
    return this.state();
  }

  private patch(id: string, p: Partial<StoredEvent>) {
    write(this.d.dataDir, readSchedule(this.d.dataDir).map((e) => (e.id === id ? { ...e, ...p } : e)));
  }

  private async run(ev: StoredEvent, occ: Date | null) {
    const preset = ev.presetId ? this.d.presets().find((p) => p.id === ev.presetId) : null;
    if (ev.presetId && !preset) this.d.log(`[howler] ${st('Evento «{name}»: el preset ya no existe; se arranca sin cambiar los ajustes.', { name: ev.name })}`);
    this.d.apply(ev, preset ?? null);
    if (ev.discord) this.d.notify?.('start', ev, 0);
    this.d.log(`[howler] ${st('Evento «{name}»: arrancando el servidor.', { name: ev.name })}`);
    if (this.d.serverState() === 'stopped') this.d.start();
    else await this.d.restart();
    const stopAt = ev.stopAfterMinutes ? new Date(this.now().getTime() + ev.stopAfterMinutes * 60_000).toISOString() : null;
    // Un evento que arranca releva al anterior: su parada programada ya no tiene sentido (pararía el servidor de este).
    for (const other of readSchedule(this.d.dataDir)) if (other.id !== ev.id && other.stopAt) this.patch(other.id, { stopAt: null });
    this.patch(ev.id, { stopAt, ...(occ ? { lastRun: occ.toISOString(), lastResult: 'ran' as const } : {}) });
  }

  /** Una vuelta del reloj: ejecuta lo que toque, avisa y para lo que haya que parar. Nunca lanza. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.now();
      for (const ev of readSchedule(this.d.dataDir)) {
        try {
          if (ev.stopAt && new Date(ev.stopAt) <= now) {
            this.patch(ev.id, { stopAt: null });
            if (this.d.serverState() !== 'stopped') {
              this.d.log(`[howler] ${st('Evento «{name}»: hora de parar el servidor.', { name: ev.name })}`);
              await this.d.stop();
            }
          }
          if (!ev.enabled) continue;
          const latest = latestOccurrence(ev.when, now);
          if (latest && (!ev.lastRun || latest > new Date(ev.lastRun))) {
            if (now.getTime() - latest.getTime() <= SCHEDULE_GRACE_MINUTES * 60_000) await this.run(ev, latest);
            else this.patch(ev.id, { lastRun: latest.toISOString(), lastResult: 'missed' });
            continue;
          }
          await this.announce(ev, now);
        } catch (e) {
          this.d.log(`[howler] ${st('Evento «{name}»: {msg}', { name: ev.name, msg: e instanceof Error ? e.message : String(e) })}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async announce(ev: StoredEvent, now: Date) {
    const next = nextOccurrence(ev.when, now);
    if (!next || ev.announceMinutes.length === 0) return;
    for (const m of ev.announceMinutes) {
      const at = next.getTime() - m * 60_000;
      const key = `${ev.id}|${next.toISOString()}|${m}`;
      // Solo en los 2 minutos siguientes a la hora del aviso: si Howler arranca tarde, el aviso ya no tiene sentido.
      if (now.getTime() < at || now.getTime() >= at + 120_000 || this.announced.has(key)) continue;
      this.announced.add(key);
      if (ev.discord) this.d.notify?.('soon', ev, m);
      if (this.d.serverState() !== 'running' || this.d.playersOnline() === 0) continue;
      await this.d.say(st('Howler: «{name}» empieza en {n} min; el servidor se reiniciará.', { name: ev.name, n: m }));
    }
    if (this.announced.size > 500) this.announced.clear();
  }
}
