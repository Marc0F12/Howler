import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySmart, describeSmart } from './smart-settings';

/** Servidor falso: <raiz>/server con preset P, y la «instalación de AC» es la carpeta de arriba. */
function fake(opts: { track?: string; params?: string; weatherScript?: string; acd?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'howler-smart-'));
  const dir = join(root, 'server');
  mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
  mkdirSync(join(dir, 'cfg'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), `[SERVER]\r\nTRACK=${opts.track ?? 'monza'}\r\n`);
  writeFileSync(join(dir, 'presets', 'P', 'entry_list.ini'), '[CAR_0]\r\nMODEL=mod_car\r\n');
  writeFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'EnableWeatherFx: false\n');
  if (opts.params !== undefined) writeFileSync(join(dir, 'cfg', 'data_track_params.ini'), opts.params);
  mkdirSync(join(dir, 'content', 'cars', 'mod_car'), { recursive: true });
  if (opts.acd) writeFileSync(join(dir, 'content', 'cars', 'mod_car', 'data.acd'), 'x');
  if (opts.weatherScript) mkdirSync(join(root, 'extension', 'weather', opts.weatherScript), { recursive: true });
  return dir;
}
const get = (dir: string, key: string, modes = {}) => describeSmart(dir, 'P', modes).find((s) => s.key === key)!;
const extra = (dir: string) => readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'utf8');

describe('ajustes inteligentes (On/Off/Auto)', () => {
  it('sin elegir no se toca nada', () => {
    const dir = fake();
    expect(applySmart(dir, 'P', {})).toEqual([]);
    expect(extra(dir)).toBe('EnableWeatherFx: false\n');
    expect(get(dir, 'weatherFx').mode).toBeNull();
  });

  it('Auto de WeatherFX: encendido solo con Pure o Sol instalado', () => {
    expect(get(fake(), 'weatherFx', { weatherFx: 'auto' }).effective).toBe(false);
    const dir = fake({ weatherScript: 'pure' });
    expect(get(dir, 'weatherFx', { weatherFx: 'auto' }).effective).toBe(true);
    expect(applySmart(dir, 'P', { weatherFx: 'auto' })).toEqual(['weatherFx']);
    expect(extra(dir)).toContain('EnableWeatherFx: true');
    expect(applySmart(dir, 'P', { weatherFx: 'auto' })).toEqual([]); // ya está así
  });

  it('Auto de datos del circuito: encendido si el circuito no tiene sección con zona horaria', () => {
    const sin = fake({ track: 'csp/1/../fn_valencia', params: '[monza]\nTIMEZONE=Europe/Rome\n' });
    const s = get(sin, 'trackParams', { trackParams: 'auto' });
    expect(s.effective).toBe(true);
    expect(s.detail).toBe('fn_valencia');
    applySmart(sin, 'P', { trackParams: 'auto' });
    expect(extra(sin)).toMatch(/MissingTrackParams: true/);
    expect(get(fake({ params: '[monza]\nTIMEZONE=Europe/Rome\n' }), 'trackParams', { trackParams: 'auto' }).effective).toBe(false);
    expect(get(fake(), 'trackParams', { trackParams: 'auto' }).effective).toBe(false); // sin archivo: AssettoServer lo descarga
  });

  it('Auto de data.acd: encendido solo si falta en algún coche de la lista', () => {
    expect(get(fake({ acd: false }), 'carChecksums', { carChecksums: 'auto' }).effective).toBe(true);
    expect(get(fake({ acd: true }), 'carChecksums', { carChecksums: 'auto' }).effective).toBe(false);
  });

  it('On y Off a mano mandan sobre Auto', () => {
    const dir = fake({ weatherScript: 'pure' });
    applySmart(dir, 'P', { weatherFx: 'off' });
    expect(extra(dir)).toContain('EnableWeatherFx: false');
    applySmart(dir, 'P', { carChecksums: 'on' });
    expect(extra(dir)).toMatch(/MissingCarChecksums: true/);
  });
});
