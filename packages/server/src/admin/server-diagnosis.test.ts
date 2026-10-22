import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIgnoreFlag, diagnoseLogs, hasTrackParams, preflightDiagnosis, serverTrackKey } from './server-diagnosis';
import { readIgnoreFlagText, setIgnoreFlagText } from './extra-cfg-flags';

// Salida real de un servidor que no arrancaba (circuito de mod sin datos de ubicación)
const REAL = [
  '[22:38:17 INF] Initialized 2 track checksums',
  '[22:38:17 DBG] Added checksum for bmw_m3_gt2',
  '[22:38:17 INF] Initialized 1 car checksums',
  '[22:38:17 INF] Switching session to id 0',
  '[22:38:17 FTL] Fatal exception occurred',
  'AssettoServer.Server.Configuration.ConfigurationException: No track params found for csp/2651/../g/../fn_valencia. More info: https://assettoserver.org/docs/common-configuration-errors#missing-track-params',
  'at AssettoServer.Server.Weather.WeatherManager.StartingAsync(CancellationToken cancellationToken) in AssettoServer/Server/Weather/WeatherManager.cs:line 207',
  'No track params found for csp/2651/../g/../fn_valencia. More info: https://assettoserver.org/docs/common-configuration-errors#missing-track-params',
];

describe('diagnoseLogs', () => {
  it('reconoce el circuito sin datos de ubicación (y no culpa a data.acd)', () => {
    expect(diagnoseLogs(REAL)).toEqual([{ id: 'track-params', params: { track: 'fn_valencia' }, fix: 'allow-track-params' }]);
  });
  it('ignora los mismos textos cuando solo son un aviso (interruptor activo, arranque normal)', () => {
    expect(diagnoseLogs(['[10:00:00 WRN] No data.acd found for x. This will allow players to cheat. More info: https://a#missing-car-checksums', '[10:00:01 INF] Server startup completed'])).toEqual([]);
  });
  it('reconoce otras causas habituales', () => {
    const one = (l: string) => diagnoseLogs(['[1:00:00 FTL] Fatal exception occurred', l])[0];
    expect(one('X.ConfigurationException: Admin whitelist is enabled but Steam auth is disabled. More info')?.id).toBe('admin-whitelist');
    expect(one('X.ConfigurationException: No plugin found with name ScoreTracker')).toMatchObject({ id: 'plugin', params: { plugin: 'ScoreTracker' } });
    expect(one('System.IO.IOException: Only one usage of each socket address (protocol/network address/port) is normally permitted.')?.id).toBe('port-in-use');
    expect(one("System.IO.FileNotFoundException: Could not find file 'C:\\srv\\presets\\X\\entry_list.ini'.")).toMatchObject({ id: 'missing-file', params: { path: 'C:\\srv\\presets\\X\\entry_list.ini' } });
    expect(one('X.ConfigurationException: Entry list must contain one or more entries')?.id).toBe('no-entries');
    expect(one('X.ConfigurationException: Client messages need a minimum required CSP version of 0.1.77 (1937)')).toMatchObject({ id: 'csp-version', params: { build: '1937' } });
    expect(one('System.InvalidOperationException: algo raro pasó')).toMatchObject({ id: 'unknown', params: { type: 'System.InvalidOperationException' } });
  });
});

describe('interruptores del extra_cfg.yml', () => {
  it('añade, cambia y conserva los demás valores', () => {
    expect(setIgnoreFlagText('A: 1\n', 'MissingTrackParams', true)).toBe('A: 1\nIgnoreConfigurationErrors:\n  MissingTrackParams: true\n');
    expect(setIgnoreFlagText('IgnoreConfigurationErrors:\n  MissingCarChecksums: true\nB: 2\n', 'MissingTrackParams', true)).toBe('IgnoreConfigurationErrors:\n  MissingTrackParams: true\n  MissingCarChecksums: true\nB: 2\n');
    const inline = setIgnoreFlagText('IgnoreConfigurationErrors: { MissingCarChecksums: true }\r\n', 'MissingTrackParams', true);
    expect(inline).toContain('MissingCarChecksums: true');
    expect(readIgnoreFlagText(inline, 'MissingTrackParams')).toBe(true);
    expect(readIgnoreFlagText('IgnoreConfigurationErrors: { MissingTrackParams: true }', 'MissingTrackParams')).toBe(true);
    expect(readIgnoreFlagText('A: 1', 'MissingTrackParams')).toBe(false);
  });
});

describe('comprobación previa', () => {
  const make = (params: string | null, extra = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-diag-'));
    mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
    mkdirSync(join(dir, 'cfg'));
    writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), '[SERVER]\r\nTRACK=csp/2651/../g/../fn_valencia\r\nCONFIG_TRACK=gp\r\n');
    writeFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), extra);
    if (params !== null) writeFileSync(join(dir, 'cfg', 'data_track_params.ini'), params);
    return dir;
  };
  it('avisa si el circuito no está en data_track_params.ini y lo arregla con un clic', () => {
    const dir = make('[imola]\nTIMEZONE=Europe/Berlin\n');
    expect(serverTrackKey(dir, 'P')).toBe('fn_valencia');
    expect(preflightDiagnosis(dir, 'P')).toEqual([{ id: 'track-params', params: { track: 'fn_valencia' }, fix: 'allow-track-params' }]);
    expect(applyIgnoreFlag(dir, 'P', 'MissingTrackParams')).toBe(true);
    expect(readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'utf8')).toContain('MissingTrackParams: true');
    expect(preflightDiagnosis(dir, 'P')).toEqual([]);
  });
  it('no avisa si el circuito sí está, ni si el archivo aún no existe', () => {
    expect(preflightDiagnosis(make('[fn_valencia]\nLATITUDE=39\nLONGITUDE=-0.3\nTIMEZONE=Europe/Madrid\n'), 'P')).toEqual([]);
    expect(hasTrackParams(make('[fn_valencia]\nLATITUDE=39\n'), 'fn_valencia')).toBe(false); // sin huso horario
    expect(preflightDiagnosis(make(null), 'P')).toEqual([]);
  });
});
