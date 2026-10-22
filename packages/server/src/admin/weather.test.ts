import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPure, listWeatherSystems, saveWeatherFx, setWeatherFxText, parseWeatherList, readWeatherState, saveWeatherList, systemOf, weatherFxEnabled, weatherName, writeWeatherList } from './weather';

const CFG = [
  '[SERVER]', 'NAME=Patata', 'TRACK=castelloli2021', '',
  '[WEATHER_0]', 'GRAPHICS=6_mid_clouds', 'BASE_TEMPERATURE_AMBIENT=15', 'BASE_TEMPERATURE_ROAD=-1', 'VARIATION_AMBIENT=1', 'VARIATION_ROAD=1',
  'WIND_BASE_SPEED_MIN=0', 'WIND_BASE_SPEED_MAX=11.4', 'WIND_BASE_DIRECTION=0', 'WIND_VARIATION_DIRECTION=20', '',
  '[__CM_SERVER]', 'NAME=Patata', '',
].join('\r\n');

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Una instalación de AC falsa: <raíz>/server (con el preset) y <raíz>/content/weather con los climas pedidos. */
function install(weathers: string[], cfg = CFG, extra = 'EnableWeatherFx: false\n') {
  const root = mkdtempSync(join(tmpdir(), 'howler-wx-'));
  dirs.push(root);
  const server = join(root, 'server');
  mkdirSync(join(server, 'presets', 'SERVER_00'), { recursive: true });
  writeFileSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), cfg);
  writeFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), extra);
  for (const w of weathers) mkdirSync(join(root, 'content', 'weather', w), { recursive: true });
  return server;
}

describe('sistemas y nombres', () => {
  it('reconoce el sistema de cada carpeta', () => {
    expect(systemOf('3_clear')).toBe('default');
    expect(systemOf('sol_34_light_rain')).toBe('sol');
    expect(systemOf('pure_clear')).toBe('pure');
  });
  it('da nombres legibles en español', () => {
    expect(weatherName('3_clear')).toBe('Despejado');
    expect(weatherName('sol_34_light_rain')).toBe('Lluvia ligera');
    expect(weatherName('sol_42_thunderstorm')).toBe('Tormenta');
    expect(weatherName('sol_99_algo_raro')).toBe('Algo raro');
  });
  it('lista los sistemas instalados, con el de AC primero y sus climas ordenados', () => {
    const server = install(['sol_35_rain', 'sol_01_clear', '3_clear', '1_heavy_fog', 'pure_snow']);
    const sys = listWeatherSystems(join(server, '..'));
    expect(sys.map((s) => s.id)).toEqual(['default', 'sol', 'pure']);
    expect(sys[0]!.label).toBe('Por defecto de AC');
    expect(sys[0]!.weathers.map((w) => w.graphics)).toEqual(['1_heavy_fog', '3_clear']);
    expect(sys[1]!.weathers.map((w) => w.name)).toEqual(['Despejado', 'Lluvia']);
  });
});

describe('lista de climas del preset', () => {
  it('lee la lista con su sistema y temperaturas', () => {
    expect(parseWeatherList(CFG)).toEqual([{ id: 0, graphics: '6_mid_clouds', name: 'Parcialmente nublado', system: 'default', ambient: 15, road: -1 }]);
  });

  it('cambia la lista conservando el clima que ya estaba y poniendo valores por defecto a los nuevos', () => {
    const out = writeWeatherList(CFG, ['sol_01_clear', '6_mid_clouds', 'sol_35_rain']);
    const list = parseWeatherList(out);
    expect(list.map((e) => [e.id, e.graphics])).toEqual([[0, 'sol_01_clear'], [1, '6_mid_clouds'], [2, 'sol_35_rain']]);
    expect(list[1]).toMatchObject({ ambient: 15, road: -1 }); // lo que ya tenía, intacto
    expect(list[0]).toMatchObject({ ambient: 20, road: 6 }); // nuevo: valores por defecto
    expect(out).toContain('WIND_BASE_SPEED_MAX=11.4');
  });

  it('no toca nada más del archivo y mantiene los saltos de línea', () => {
    const out = writeWeatherList(CFG, ['3_clear']);
    expect(out).toContain('[SERVER]\r\nNAME=Patata\r\nTRACK=castelloli2021');
    expect(out).toContain('[__CM_SERVER]\r\nNAME=Patata');
    expect(out).not.toMatch(/(^|[^\r])\n/); // todo CRLF
    expect(out).not.toContain('6_mid_clouds');
    expect(out.match(/\[WEATHER_\d+\]/g)).toEqual(['[WEATHER_0]']);
  });

  it('conserva la marca BOM', () => {
    expect(writeWeatherList('﻿' + CFG, ['3_clear']).startsWith('﻿[SERVER]')).toBe(true);
  });

  it('exige al menos un clima', () => {
    expect(() => writeWeatherList(CFG, [])).toThrow(/al menos un clima/);
  });

  it('es estable: aplicar la misma lista dos veces da el mismo archivo', () => {
    const once = writeWeatherList(CFG, ['sol_01_clear', '6_mid_clouds']);
    expect(writeWeatherList(once, ['sol_01_clear', '6_mid_clouds'])).toBe(once);
  });
});

describe('estado y guardado', () => {
  it('detecta si el clima de CSP está activo (por defecto sí, como AssettoServer)', () => {
    expect(weatherFxEnabled('EnableWeatherFx: false\n')).toBe(false);
    expect(weatherFxEnabled('EnableWeatherFx: true\n')).toBe(true);
    expect(weatherFxEnabled('UseSteamAuth: false\n')).toBe(true);
  });

  it('lee el estado completo del preset', () => {
    const server = install(['3_clear', '6_mid_clouds', 'sol_01_clear']);
    const s = readWeatherState(server, 'SERVER_00');
    expect(s.fx).toBe(false);
    expect(s.systems.map((x) => x.id)).toEqual(['default', 'sol']);
    expect(s.list).toHaveLength(1);
  });

  it('guarda la lista, deja copia anterior y solo admite climas instalados', () => {
    const server = install(['3_clear', '6_mid_clouds', 'sol_01_clear']);
    const list = saveWeatherList(server, 'SERVER_00', ['sol_01_clear', '3_clear']);
    expect(list.map((e) => e.graphics)).toEqual(['sol_01_clear', '3_clear']);
    expect(readFileSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini.howler-prev'), 'utf8')).toBe(CFG);
    expect(() => saveWeatherList(server, 'SERVER_00', ['pure_nieve_inexistente'])).toThrow(/no instalado/);
    expect(() => saveWeatherList(server, 'SERVER_00', ['3_clear', '3_clear'])).toThrow(/repetidos/);
    expect(() => saveWeatherList(server, '../x', ['3_clear'])).toThrow(/no válido/);
  });
});

describe('CSP WeatherFX y Pure', () => {
  it('setWeatherFxText cambia solo esa línea y la añade si falta, respetando CRLF', () => {
    expect(setWeatherFxText('A: 1\nEnableWeatherFx: false\nB: 2\n', true)).toBe('A: 1\nEnableWeatherFx: true\nB: 2\n');
    expect(setWeatherFxText('A: 1\r\nB: 2', true)).toBe('A: 1\r\nB: 2\r\nEnableWeatherFx: true\r\n');
    expect(setWeatherFxText('', false)).toBe('EnableWeatherFx: false\n');
    expect(setWeatherFxText('# EnableWeatherFx: false\n', true)).toContain('\nEnableWeatherFx: true'); // el comentario no cuenta
  });
  it('saveWeatherFx escribe el archivo del preset y guarda copia; sin cambios no toca nada', () => {
    const server = install([]);
    const file = join(server, 'presets', 'SERVER_00', 'extra_cfg.yml');
    saveWeatherFx(server, 'SERVER_00', true);
    expect(readFileSync(file, 'utf8')).toBe('EnableWeatherFx: true\n');
    expect(readFileSync(`${file}.howler-prev`, 'utf8')).toBe('EnableWeatherFx: false\n');
    expect(readWeatherState(server, 'SERVER_00').fx).toBe(true);
    saveWeatherFx(server, 'SERVER_00', true);
    expect(() => saveWeatherFx(server, 'NO_EXISTE', true)).toThrow();
  });
  it('detectPure lee las variantes de extension/weather (con su manifiesto) y dice que no si no hay', () => {
    const server = install([]);
    const root = join(server, '..');
    expect(detectPure(root)).toEqual({ found: false, where: null, variants: [] });
    mkdirSync(join(root, 'extension', 'weather', 'pure'), { recursive: true });
    writeFileSync(join(root, 'extension', 'weather', 'pure', 'manifest.ini'), '[ABOUT]\r\nNAME = Pure Gamma\r\nVERSION = 3.59\r\n');
    mkdirSync(join(root, 'extension', 'weather', 'Pure LCS'), { recursive: true });
    mkdirSync(join(root, 'extension', 'weather', 'sol'), { recursive: true });
    const d = detectPure(root);
    expect(d.found).toBe(true);
    expect(d.variants).toEqual(expect.arrayContaining([{ folder: 'pure', name: 'Pure Gamma', version: '3.59' }, { folder: 'Pure LCS', name: 'Pure LCS', version: null }]));
    expect(d.variants).toHaveLength(2);
    expect(readWeatherState(server, 'SERVER_00').pure.found).toBe(true);
  });
});
