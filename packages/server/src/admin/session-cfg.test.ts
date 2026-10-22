import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS } from '@howler/shared';
import { readSessionPanel, writeSessionPanel } from './session-cfg';

// Forma real del server_cfg.ini que escribe Content Manager: BOM, CRLF, secciones y claves apagadas con __CM_*_OFF.
const CFG = [
  '﻿[SERVER]', 'NAME=Prueba', 'FUEL_RATE=0', 'DAMAGE_MULTIPLIER=200', 'TYRE_WEAR_RATE=30', 'ALLOWED_TYRES_OUT=2', 'ABS_ALLOWED=1',
  'TYRE_BLANKETS_ALLOWED=1', 'SUN_ANGLE=-4', 'CLASE_RARA=pon', '', '[__CM_DYNAMIC_TRACK_OFF]', 'SESSION_START=90', 'RANDOMNESS=2', 'LAP_GAIN=10',
  'SESSION_TRANSFER=90', '', '[WEATHER_0]', 'GRAPHICS=6_mid_clouds', '', '[__CM_QUALIFY_OFF]', 'NAME=Qualify', 'TIME=5', 'IS_OPEN=1', '',
  '[PRACTICE]', 'NAME=Practice', 'TIME=60', 'IS_OPEN=1', '', '[RACE]', 'NAME=Race', 'TIME=0', 'IS_OPEN=1', 'WAIT_TIME=15', 'LAPS=10', '__CM_TIME_OFF=10', '',
].join('\r\n');
const EXTRA = 'EnableWeatherFx: true # clima\r\nEnableCarReset: false\r\nIgnoreConfigurationErrors:\r\n  MissingTrackParams: true\r\n';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'howler-sesion-'));
  mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), CFG);
  writeFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), EXTRA);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const cfg = () => readFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), 'utf8');
const extra = () => readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'utf8');

describe('lectura del panel de sesión', () => {
  it('lee los valores del archivo y usa el de serie en lo que falta', () => {
    const p = readSessionPanel(dir, 'P');
    expect(p.values.fuelRate).toBe(0);
    expect(p.values.damageMultiplier).toBe(200);
    expect(p.values.blankets).toBe(true);
    expect(p.values.tyresOut).toBe(2);
    expect(p.values.sunAngle).toBe(-4);
    expect(p.values.voteQuorum).toBe(70); // no está en el archivo: valor de serie
    expect(p.values.carReset).toBe(false);
    expect(p.values.unlimitedP2P).toBe(true); // no está en el yml: valor de serie
    expect(Object.keys(p.values).sort()).toEqual(SETTINGS.map((s) => s.id).sort());
  });
  it('distingue secciones encendidas, apagadas por Content Manager y el modo de la carrera', () => {
    const p = readSessionPanel(dir, 'P');
    expect(p.values.dynamicTrack).toBe(false);
    expect(p.values.gripStart).toBe(90); // lo lee aunque la sección esté apagada
    expect(p.sessions.practice).toMatchObject({ enabled: true, mode: 'time', minutes: 60 });
    expect(p.sessions.qualify).toMatchObject({ enabled: false, minutes: 5 });
    expect(p.sessions.race).toMatchObject({ enabled: true, mode: 'laps', laps: 10, waitSeconds: 15 });
  });
});

describe('escritura del panel de sesión', () => {
  it('cambia solo lo pedido y conserva BOM, CRLF y las claves desconocidas', () => {
    writeSessionPanel(dir, 'P', { values: { fuelRate: 50, blankets: false, abs: 2 } });
    const t = cfg();
    expect(t.startsWith('﻿[SERVER]')).toBe(true);
    expect(t).toContain('FUEL_RATE=50\r\n');
    expect(t).toContain('TYRE_BLANKETS_ALLOWED=0\r\n');
    expect(t).toContain('ABS_ALLOWED=2\r\n');
    expect(t).toContain('CLASE_RARA=pon\r\n');
    expect(t).not.toMatch(/[^\r]\n/);
  });
  it('crea las claves que faltan dentro de su sección y guarda la copia anterior', () => {
    writeSessionPanel(dir, 'P', { values: { startRule: 2, pitStart: 20 } });
    expect(readSessionPanel(dir, 'P').values).toMatchObject({ startRule: 2, pitStart: 20 });
    expect(readFileSync(join(dir, 'presets', 'P', 'server_cfg.ini.howler-prev'), 'utf8')).toBe(CFG);
  });
  it('enciende el agarre dinámico sin perder sus valores y escribe en el yml sin tocar lo demás', () => {
    writeSessionPanel(dir, 'P', { values: { dynamicTrack: true, gripStart: 80, carReset: true, kickMinPlayers: 5 } });
    const t = cfg();
    expect(t).toContain('[DYNAMIC_TRACK]');
    expect(t).not.toContain('__CM_DYNAMIC_TRACK_OFF');
    expect(t).toContain('SESSION_START=80');
    expect(t).toContain('LAP_GAIN=10');
    const e = extra();
    expect(e).toContain('EnableCarReset: true');
    expect(e).toContain('VoteKickMinimumConnectedPlayers: 5');
    expect(e).toContain('EnableWeatherFx: true # clima');
    expect(e).toContain('  MissingTrackParams: true');
  });
  it('activa la clasificación y pasa la carrera de vueltas a tiempo y viceversa', () => {
    const base = readSessionPanel(dir, 'P').sessions;
    writeSessionPanel(dir, 'P', { sessions: { ...base, qualify: { ...base.qualify, enabled: true, minutes: 12 }, race: { ...base.race, mode: 'time', minutes: 30 } } });
    let p = readSessionPanel(dir, 'P').sessions;
    expect(p.qualify).toMatchObject({ enabled: true, minutes: 12 });
    expect(p.race).toMatchObject({ mode: 'time', minutes: 30 });
    expect(cfg()).toContain('__CM_LAPS_OFF=10'); // CM apaga la clave que no se usa, sin perderla
    writeSessionPanel(dir, 'P', { sessions: { ...p, race: { ...p.race, mode: 'laps', laps: 20 } } });
    p = readSessionPanel(dir, 'P').sessions;
    expect(p.race).toMatchObject({ mode: 'laps', laps: 20 });
    expect(cfg()).toContain('__CM_TIME_OFF=30');
  });
  it('guardar sin cambios un archivo de CM con TIME y __CM_TIME_OFF a la vez no duplica claves (AssettoServer no lo leería)', () => {
    const base = readSessionPanel(dir, 'P').sessions;
    writeSessionPanel(dir, 'P', { sessions: base });
    const all = cfg().split(/\r?\n/);
    const race = all.slice(all.indexOf('[RACE]'));
    for (const key of ['TIME', '__CM_TIME_OFF', 'LAPS', '__CM_LAPS_OFF']) expect(race.filter((l) => l.startsWith(key + '=')).length, key).toBeLessThanOrEqual(1);
    expect(readSessionPanel(dir, 'P').sessions.race).toMatchObject({ mode: 'laps', laps: 10 });
  });
  it('apagar una sesión la renombra a __CM_*_OFF en vez de borrarla', () => {
    const base = readSessionPanel(dir, 'P').sessions;
    writeSessionPanel(dir, 'P', { sessions: { ...base, practice: { ...base.practice, enabled: false } } });
    expect(cfg()).toContain('[__CM_PRACTICE_OFF]');
    expect(cfg()).toContain('TIME=60');
    expect(readSessionPanel(dir, 'P').sessions.practice.enabled).toBe(false);
  });
  it('no escribe nada si algo no es válido', () => {
    expect(() => writeSessionPanel(dir, 'P', { values: { fuelRate: 50, abs: 9 } })).toThrow(/ABS/);
    expect(() => writeSessionPanel(dir, 'P', { values: { inventado: 1 } })).toThrow(/desconocido/);
    expect(() => writeSessionPanel(dir, 'P', { values: { legalTyres: 'SV\r\n[SERVER]' } })).toThrow(/no válido/);
    expect(() => writeSessionPanel(dir, 'P', { values: { tyresOut: 2.5 } })).toThrow(/entero/);
    expect(cfg()).toBe(CFG);
  });
});
