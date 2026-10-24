import { describe, expect, it } from 'vitest';
import { cleanSignupInput, cleanSignupSettings, parseSteamRef, SIGNUP_MAX_QUESTIONS } from './signup';

const form = { info: '', askEmail: true, askTeam: true, cars: ['a', 'b'], questions: ['¿Discord?', '¿Experiencia?'] };

describe('inscripción: validación', () => {
  it('reconoce perfiles de Steam en sus formas y los normaliza', () => {
    expect(parseSteamRef('76561190000000001')).toBe('https://steamcommunity.com/profiles/76561190000000001');
    expect(parseSteamRef('steamcommunity.com/profiles/76561190000000001/')).toBe('https://steamcommunity.com/profiles/76561190000000001');
    expect(parseSteamRef('https://www.steamcommunity.com/id/mi_nombre?l=spanish')).toBe('https://steamcommunity.com/id/mi_nombre');
    for (const bad of ['', 'hola', 'https://evil.com/profiles/76561190000000001', 'https://steamcommunity.com.evil.com/id/x', 'javascript:alert(1)', 'https://steamcommunity.com/id/a']) expect(parseSteamRef(bad)).toBeNull();
  });
  it('limpia los ajustes: máximo de preguntas, textos recortados, sin caracteres de control', () => {
    const s = cleanSignupSettings({ enabled: true, questions: ['a', 'b', 'c', 'd', 'e', 'f', ''], info: 'hola\u0000 mundo', askTeam: 1 });
    expect(s.questions).toHaveLength(SIGNUP_MAX_QUESTIONS);
    expect(s).toMatchObject({ enabled: true, askTeam: false, info: 'hola mundo' });
    expect(cleanSignupSettings(null)).toMatchObject({ enabled: false, questions: [] });
  });
  it('valida lo que manda quien se inscribe', () => {
    const ok = cleanSignupInput({ name: ' Ana ', steam: '76561190000000001', team: 'Rojos', car: 'a', email: 'a@b.es', answers: ['x', 'y', 'sobra'] }, form);
    expect(ok).toEqual({ ok: true, value: { name: 'Ana', steam: 'https://steamcommunity.com/profiles/76561190000000001', team: 'Rojos', car: 'a', email: 'a@b.es', answers: ['x', 'y'] } });
    for (const bad of [{ name: 'A', steam: '76561190000000001' }, { name: 'Ana', steam: 'no' }, { name: 'Ana', steam: '76561190000000001', car: 'zzz' }, { name: 'Ana', steam: '76561190000000001', email: 'no-es-correo' }]) {
      expect(cleanSignupInput(bad, form).ok).toBe(false);
    }
    // sin pedir equipo ni correo, se ignoran aunque los manden
    expect(cleanSignupInput({ name: 'Ana', steam: '76561190000000001', team: 'X', email: 'a@b.es' }, { ...form, askTeam: false, askEmail: false })).toMatchObject({ ok: true, value: { team: '', email: '' } });
  });
});
