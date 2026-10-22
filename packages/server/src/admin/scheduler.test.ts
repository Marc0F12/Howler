import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SESSIONS, latestOccurrence, nextOccurrence, parseLocalDateTime, validateScheduleInput } from '@howler/shared';
import { Scheduler, type SchedulerDeps } from './scheduler';
import type { StoredSessionPreset } from './session-presets';

const L = (s: string) => parseLocalDateTime(s)!;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'howler-sched-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('fechas de los eventos', () => {
  it('lee fechas locales y rechaza las que no existen', () => {
    expect(parseLocalDateTime('2026-10-22T21:30')?.getHours()).toBe(21);
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('mañana')).toBeNull();
  });
  it('una sola vez: la próxima antes de la hora, la última después', () => {
    const w = { kind: 'once' as const, at: '2026-10-22T21:30' };
    expect(nextOccurrence(w, L('2026-10-22T20:00'))).toEqual(L('2026-10-22T21:30'));
    expect(latestOccurrence(w, L('2026-10-22T20:00'))).toBeNull();
    expect(nextOccurrence(w, L('2026-10-22T22:00'))).toBeNull();
    expect(latestOccurrence(w, L('2026-10-22T22:00'))).toEqual(L('2026-10-22T21:30'));
  });
  it('semanal: salta al siguiente día elegido y recuerda el último', () => {
    // 2026-10-22 es jueves (4). Martes y sábado a las 21:00.
    const w = { kind: 'weekly' as const, days: [2, 6], time: '21:00' };
    expect(nextOccurrence(w, L('2026-10-22T12:00'))).toEqual(L('2026-10-24T21:00'));
    expect(latestOccurrence(w, L('2026-10-22T12:00'))).toEqual(L('2026-10-20T21:00'));
    expect(nextOccurrence(w, L('2026-10-24T21:00'))).toEqual(L('2026-10-27T21:00')); // la de este mismo instante ya tocó
    expect(latestOccurrence(w, L('2026-10-24T21:00'))).toEqual(L('2026-10-24T21:00'));
  });
});

describe('validación', () => {
  const ok = { name: ' Liga  jueves ', when: { kind: 'weekly', days: [4, 4, 2], time: '21:00' }, announceMinutes: [5, 30, 30] };
  it('limpia y ordena', () => {
    const v = validateScheduleInput(ok);
    expect(v.name).toBe('Liga jueves');
    expect(v.when).toEqual({ kind: 'weekly', days: [2, 4], time: '21:00' });
    expect(v.announceMinutes).toEqual([30, 5]);
    expect(v.enabled).toBe(true);
    expect(v.discord).toBe(true);
    expect(v.entries).toEqual([]);
    expect(validateScheduleInput({ ...ok, entries: [{ car: 'mazda_mx5', count: 2 }, { car: 'mazda_mx5', count: 1 }], track: { track: 'imola', layout: '' } }).entries).toEqual([{ car: 'mazda_mx5', count: 3 }]);
  });
  it('rechaza lo que no vale', () => {
    expect(() => validateScheduleInput({ ...ok, name: '' })).toThrow(/nombre/);
    expect(() => validateScheduleInput({ ...ok, when: { kind: 'weekly', days: [], time: '21:00' } })).toThrow(/día/);
    expect(() => validateScheduleInput({ ...ok, when: { kind: 'weekly', days: [1], time: '25:00' } })).toThrow(/hora/);
    expect(() => validateScheduleInput({ ...ok, stopAfterMinutes: 2 })).toThrow(/parada/);
    expect(() => validateScheduleInput({ ...ok, announceMinutes: [0] })).toThrow(/avisos/);
    expect(() => validateScheduleInput({ ...ok, announceMinutes: [1, 2, 3, 4, 5, 6] })).toThrow(/avisos/);
    expect(() => validateScheduleInput({ ...ok, track: { track: '../etc', layout: '' } })).toThrow(/circuito/);
    expect(() => validateScheduleInput({ ...ok, entries: [{ car: 'a b/c', count: 1 }] })).toThrow(/coches/);
    expect(() => validateScheduleInput({ ...ok, entries: [{ car: 'mazda', count: 0 }] })).toThrow(/coches/);
    expect(() => validateScheduleInput({ ...ok, entries: [{ car: 'mazda', count: 60 }, { car: 'bmw', count: 60 }] })).toThrow(/plazas/);
  });
});

const PRESET: StoredSessionPreset = { id: 's000000000001', name: 'Liga', values: { fuelRate: 50 }, sessions: DEFAULT_SESSIONS };

function harness(startAt: string, presets: StoredSessionPreset[] = [PRESET]) {
  let t = L(startAt);
  const calls: string[] = [];
  const notes: string[] = [];
  const applied: unknown[] = [];
  let state: 'stopped' | 'running' = 'stopped';
  let players = 0;
  const d: SchedulerDeps = {
    dataDir: dir, presets: () => presets, now: () => t,
    apply: (ev, p) => { applied.push(ev.track); if (p) calls.push(`apply:${p.name}`); },
    notify: (k, _ev, m) => notes.push(`${k}:${m}`),
    serverState: () => state,
    start: () => { calls.push('start'); state = 'running'; },
    restart: async () => { calls.push('restart'); },
    stop: async () => { calls.push('stop'); state = 'stopped'; },
    playersOnline: () => players,
    say: async (m) => { calls.push(`say:${m}`); },
    log: () => undefined,
  };
  const s = new Scheduler(d);
  return { s, calls, notes, applied, setNow: (x: string) => { t = L(x); }, setPlayers: (n: number) => { players = n; }, setState: (x: 'stopped' | 'running') => { state = x; } };
}

describe('planificador', () => {
  const ev = (when: object, extra: object = {}) => ({ name: 'Liga', presetId: PRESET.id, when, ...extra });

  it('a la hora aplica el preset y arranca, y no lo repite', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }));
    await h.s.tick();
    expect(h.calls).toEqual([]);
    h.setNow('2026-10-22T21:00');
    await h.s.tick();
    await h.s.tick();
    expect(h.calls).toEqual(['apply:Liga', 'start']);
    expect(h.s.state().events[0]!.status).toBe('done');
  });

  it('con el servidor en marcha lo reinicia', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }));
    h.setState('running');
    h.setNow('2026-10-22T21:01');
    await h.s.tick();
    expect(h.calls).toEqual(['apply:Liga', 'restart']);
  });

  it('crear un semanal justo después de su hora no lo lanza al momento', async () => {
    const h = harness('2026-10-22T10:05'); // jueves
    h.s.save(null, ev({ kind: 'weekly', days: [4], time: '10:00' }));
    await h.s.tick();
    expect(h.calls).toEqual([]);
    expect(h.s.state().events[0]!.nextAt).toBe(L('2026-10-29T10:00').toISOString());
  });

  it('si Howler estaba apagado más de la tolerancia, se da por perdido', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }));
    h.setNow('2026-10-22T21:30');
    await h.s.tick();
    expect(h.calls).toEqual([]);
    expect(h.s.state().events[0]!.status).toBe('missed');
  });

  it('para el servidor pasado el tiempo indicado', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { stopAfterMinutes: 90 }));
    h.setNow('2026-10-22T21:00');
    await h.s.tick();
    expect(h.s.state().events[0]!.status).toBe('running');
    h.setNow('2026-10-22T22:29');
    await h.s.tick();
    expect(h.calls).toEqual(['apply:Liga', 'start']);
    h.setNow('2026-10-22T22:30');
    await h.s.tick();
    expect(h.calls.at(-1)).toBe('stop');
    expect(h.s.state().events[0]!.stopAt).toBeNull();
  });

  it('avisa por el chat solo si hay jugadores y una sola vez', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { announceMinutes: [10] }));
    h.setState('running');
    h.setPlayers(2);
    h.setNow('2026-10-22T20:49');
    await h.s.tick();
    expect(h.calls).toEqual([]);
    h.setNow('2026-10-22T20:50');
    await h.s.tick();
    await h.s.tick();
    expect(h.calls.filter((c) => c.startsWith('say:'))).toHaveLength(1);
    expect(h.calls[0]).toContain('10 min');
  });

  it('un preset borrado no impide arrancar; un evento apagado no corre', async () => {
    const h = harness('2026-10-22T20:00', []);
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }));
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { enabled: false, name: 'Apagado' }));
    h.setNow('2026-10-22T21:00');
    await h.s.tick();
    expect(h.calls).toEqual(['start']);
  });

  it('rechaza fechas pasadas, borra y «ejecutar ahora» no marca la hora como tratada', async () => {
    const h = harness('2026-10-22T20:00');
    expect(() => h.s.save(null, ev({ kind: 'once', at: '2026-10-22T19:00' }))).toThrow(/pasado/);
    const id = h.s.save(null, ev({ kind: 'weekly', days: [5], time: '22:00' })).events[0]!.id;
    await h.s.runNow(id);
    expect(h.calls).toEqual(['apply:Liga', 'start']);
    expect(h.s.state().events[0]!.status).toBe('waiting');
    expect(h.s.remove(id).events).toEqual([]);
  });

  it('pasa el circuito al preparar el servidor y avisa (Discord) al acercarse y al empezar, salvo que se apague', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { announceMinutes: [10], track: { track: 'monza', layout: 'gp' } }));
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { name: 'Mudo', announceMinutes: [10], discord: false }));
    h.setNow('2026-10-22T20:50');
    await h.s.tick();
    expect(h.notes).toEqual(['soon:10']);
    h.setNow('2026-10-22T21:00');
    await h.s.tick();
    expect(h.notes).toEqual(['soon:10', 'start:0']);
    expect(h.applied).toContainEqual({ track: 'monza', layout: 'gp' });
  });

  it('un evento que arranca anula la parada programada del anterior', async () => {
    const h = harness('2026-10-22T20:00');
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T20:30' }, { name: 'Práctica', stopAfterMinutes: 90 }));
    h.s.save(null, ev({ kind: 'once', at: '2026-10-22T21:00' }, { name: 'Carrera' }));
    h.setNow('2026-10-22T20:30');
    await h.s.tick();
    expect(h.s.state().events.find((e) => e.name === 'Práctica')!.status).toBe('running');
    h.setNow('2026-10-22T21:00');
    await h.s.tick();
    expect(h.s.state().events.find((e) => e.name === 'Práctica')!.stopAt).toBeNull();
    h.setNow('2026-10-22T22:30');
    await h.s.tick();
    expect(h.calls).not.toContain('stop'); // la práctica ya no para el servidor de la carrera
  });
});
