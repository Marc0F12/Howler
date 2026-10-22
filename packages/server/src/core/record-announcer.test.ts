import { describe, expect, it } from 'vitest';
import { announcementFor, startRecordAnnouncer } from './record-announcer';
import { Bus } from './bus';
import { Repository } from '../db/repository';
import { openDatabase } from '../db/database';

const scopes = (session: boolean, combo: boolean, global: boolean) => ({
  driverName: 'Ana', track: 'imola', layout: '', car: 'mx5', lapMs: 90000,
  session: { beaten: session, prevMs: 91000, prevDriver: 'Beto' }, combo: { beaten: combo, prevMs: 91000, prevDriver: 'Beto' }, global: { beaten: global, prevMs: 91000, prevDriver: 'Beto' },
});
const N = { car: 'MX-5', track: 'Imola' };

describe('record announcer', () => {
  it('anuncia el nivel más alto de los activados', () => {
    const all = { session: true, combo: true, global: true };
    expect(announcementFor(scopes(true, true, true), all, N)).toContain('ABSOLUTO');
    expect(announcementFor(scopes(true, true, false), all, N)).toContain('Récord de Imola con MX-5');
    expect(announcementFor(scopes(true, false, false), all, N)).toContain('de la sesión');
    expect(announcementFor(scopes(false, false, false), all, N)).toBeNull();
  });
  it('plantillas propias con huecos; las vacías usan la de Howler', () => {
    const on = { session: true, combo: true, global: true, messages: { combo: '{piloto} bate el récord con {coche}: {tiempo} (antes {anterior}, -{mejora} s) {raro}', global: '  ' } };
    expect(announcementFor(scopes(true, true, false), on, N)).toBe('Ana bate el récord con MX-5: 1:30.000 (antes 1:31.000, -1.000 s) {raro}');
    expect(announcementFor(scopes(true, true, true), on, N)).toContain('ABSOLUTO');
  });
  it('respeta lo desactivado', () => {
    expect(announcementFor(scopes(true, true, true), { session: true, combo: false, global: false }, N)).toContain('de la sesión');
    expect(announcementFor(scopes(true, true, true), { session: false, combo: false, global: false }, N)).toBeNull();
  });
  it('la vuelta de un piloto oculto no se anuncia', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const ana = repo.upsertDriver('s1', 'Ana'), tramp = repo.upsertDriver('s2', 'Tramposo');
    const s1 = repo.createSession({ track: 't', layout: '', name: 'a', type: 3 }).id;
    const lap = (d: number, ms: number) => repo.insertLap({ sessionId: s1, driverId: d, track: 't', layout: '', car: 'mx5', lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null } as never, []);
    lap(ana, 100000);
    repo.driverAdmin.setHidden(tramp, true);
    expect(repo.recordScopes.forLap(lap(tramp, 80000))).toBeNull();
  });
  it('con la base de datos real: sesión, combinación y global por separado', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const ana = repo.upsertDriver('s1', 'Ana');
    const s1 = repo.createSession({ track: 't', layout: '', name: 'a', type: 3 }).id;
    const lap = (car: string, ms: number) => repo.insertLap({ sessionId: s1, driverId: ana, track: 't', layout: '', car, lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null, sectorsExact: true }, []);
    const first = lap('mx5', 100000);
    expect(repo.recordScopes.forLap(first)!.global.beaten).toBe(false); // la primera no bate nada
    const l2 = lap('gt3', 90000); // mejor que todo con otro coche
    expect(repo.recordScopes.forLap(l2)!.global.beaten).toBe(true);
    expect(repo.recordScopes.forLap(l2)!.combo.beaten).toBe(false); // gt3 no tenía nada: no hay qué batir
    const l3 = lap('mx5', 95000); // bate su combinación y la sesión, pero no el global
    const r = repo.recordScopes.forLap(l3)!;
    expect([r.session.beaten, r.combo.beaten, r.global.beaten]).toEqual([false, true, false]);
    const bus = new Bus(); const said: string[] = [];
    startRecordAnnouncer({ bus, settings: () => ({ session: false, combo: true, global: false }), scopes: (id) => repo.recordScopes.forLap(id), say: (m) => said.push(m), carName: (c) => c, trackName: (t) => t });
    bus.emit({ type: 'lap', lapId: l3, valid: true, sessionId: s1, driverId: ana, track: 't', layout: '', car: 'mx5' });
    bus.emit({ type: 'lap', lapId: l2, valid: true, sessionId: s1, driverId: ana, track: 't', layout: '', car: 'gt3' });
    expect(said).toHaveLength(1);
  });
});
