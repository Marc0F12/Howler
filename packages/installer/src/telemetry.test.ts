import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enableClientTelemetry } from './setup/flow';
import { enableClientTelemetryCfg, ensureClientMessages } from './transform';

describe('telemetría de cliente siempre activa', () => {
  it('añade EnableClientMessages si falta y respeta CRLF', () => {
    expect(ensureClientMessages('A: 1\r\n')).toBe('A: 1\r\nEnableClientMessages: true\r\n');
    expect(ensureClientMessages('A: 1')).toBe('A: 1\nEnableClientMessages: true\n');
  });
  it('lo corrige si estaba en false y no toca lo que ya está bien', () => {
    expect(ensureClientMessages('EnableClientMessages: false\nB: 2\n')).toBe('EnableClientMessages: true\nB: 2\n');
    expect(ensureClientMessages('EnableClientMessages: true # ok\n')).toBeNull();
  });
  it('pasa ClientTelemetry de false a true y no toca el resto', () => {
    expect(enableClientTelemetryCfg('Port: 1\nClientTelemetry: false\n')).toBe('Port: 1\nClientTelemetry: true\n');
    expect(enableClientTelemetryCfg('ClientTelemetry: true\n')).toBeNull();
    expect(enableClientTelemetryCfg('Port: 1\n')).toBeNull();
  });
  it('migra los archivos del servidor y guarda copia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-tel-'));
    mkdirSync(join(dir, 'presets', 'P1'), { recursive: true });
    writeFileSync(join(dir, 'presets', 'P1', 'extra_cfg.yml'), 'EnablePlugins:\n  - HowlerPlugin\n');
    writeFileSync(join(dir, 'presets', 'P1', 'plugin_howler_cfg.yml'), 'ClientTelemetry: false\n');
    enableClientTelemetry(dir);
    expect(readFileSync(join(dir, 'presets', 'P1', 'extra_cfg.yml'), 'utf8')).toContain('EnableClientMessages: true');
    expect(readFileSync(join(dir, 'presets', 'P1', 'plugin_howler_cfg.yml'), 'utf8')).toContain('ClientTelemetry: true');
    expect(readFileSync(join(dir, 'presets', 'P1', 'plugin_howler_cfg.yml.howler-prev'), 'utf8')).toContain('false');
  });
});
