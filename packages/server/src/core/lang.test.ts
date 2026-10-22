import { afterEach, describe, expect, it } from 'vitest';
import { translateMessage } from '@howler/shared';
import { renderEvent, sampleValues, testMessage } from './discord';
import { announcementFor } from './record-announcer';
import { judgeLap } from './lap-rules';
import { serverLang, setServerLang } from './lang';
import { BUILTIN_PROFILES } from '@howler/shared';

afterEach(() => setServerLang('es'));

const scope = { beaten: true, prevMs: 91_000, prevDriver: 'Beto' };
const rec = { driverName: 'Ana', track: 'imola', layout: '', car: 'mx5', lapMs: 90_000, session: scope, combo: scope, global: scope } as never;

describe('idioma de los mensajes del servidor', () => {
  it('por defecto es español', () => {
    expect(serverLang()).toBe('es');
    expect(renderEvent('recordCombo', { webhookUrl: '', publicUrl: '', events: {} }, sampleValues('recordCombo')).embeds[0]!.title).toBe('🏆 Nuevo récord en Imola');
  });
  it('en inglés, los avisos de Discord por defecto salen en inglés con los huecos rellenos', () => {
    setServerLang('en');
    const m = renderEvent('recordCombo', { webhookUrl: '', publicUrl: '', events: {}, serverName: 'Marc' }, sampleValues('recordCombo')).embeds[0]!;
    expect(m.title).toBe('🏆 New record at Imola');
    expect(m.description).toContain('Time: **1:30.000**');
    expect(m.footer?.text).toBe('Server: Marc');
    expect(testMessage().embeds[0]!.title).toContain('connected to this channel');
  });
  it('el texto propio del organizador no se toca', () => {
    setServerLang('en');
    const m = renderEvent('serverUp', { webhookUrl: '', publicUrl: '', events: { serverUp: { title: '¡Arriba {servidor}!' } } }, { servidor: 'X' }).embeds[0]!;
    expect(m.title).toBe('¡Arriba X!');
  });
  it('el aviso de récord del chat sale en el idioma del servidor, y los huecos valen en los dos idiomas', () => {
    expect(announcementFor(rec, { session: false, combo: true, global: false }, { car: 'MX-5', track: 'Imola' })).toBe('Howler: ¡Récord de Imola con MX-5! Ana 1:30.000');
    setServerLang('en');
    expect(announcementFor(rec, { session: false, combo: true, global: false }, { car: 'MX-5', track: 'Imola' })).toBe('Howler: Record at Imola with MX-5! Ana 1:30.000');
    expect(announcementFor(rec, { session: false, combo: true, global: false, messages: { combo: '{driver} · {track}' } }, { car: 'MX-5', track: 'Imola' })).toBe('Ana · Imola');
  });
  it('todos los motivos de vuelta anulada se traducen', () => {
    const rules = BUILTIN_PROFILES.estricto!.rules;
    const reasons = [
      judgeLap({ lapMs: 90_000, cuts: 1, incidents: [] }, rules).reason,
      judgeLap({ lapMs: 90_000, cuts: 3, incidents: [] }, { ...rules, maxCuts: 1 }).reason,
      judgeLap({ lapMs: 90_000, cuts: 0, incidents: [{ kind: 'car', speed: 80, relSpeed: null }] }, rules).reason,
      judgeLap({ lapMs: 90_000, cuts: 0, incidents: [{ kind: 'env', speed: 80, relSpeed: null }] }, rules).reason,
      judgeLap({ lapMs: 5_000, cuts: 0, incidents: [] }, { ...rules, minLapMs: 30_000 }).reason,
      'Pendiente de revisión: salida de boxes', 'Anulada por el administrador', 'Anulada por el administrador: atajo',
    ];
    for (const r of reasons) {
      expect(r).toBeTruthy();
      expect(translateMessage('en', r!), r!).not.toBe(r);
    }
    expect(translateMessage('en', 'Anulada: 3 cortes (se permiten 1)')).toBe('Voided: 3 cuts (1 allowed)');
  });
  it('los errores del servidor con huecos se traducen, también el valor capturado', () => {
    expect(translateMessage('en', 'El servidor ya está en marcha.')).toBe('The server is already running.');
    expect(translateMessage('en', 'No existe settings.ini.')).toBe('settings.ini does not exist.');
  });
});
