import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from './config';

const dirs: string[] = [];
const env = process.env.HOWLER_CONFIG;
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); if (env === undefined) delete process.env.HOWLER_CONFIG; else process.env.HOWLER_CONFIG = env; });

describe('configuración', () => {
  it('lee un howler.config.json con BOM (lo añaden Notepad y PowerShell) y lo puede guardar de nuevo', () => {
    const d = mkdtempSync(join(tmpdir(), 'howler-cfg-')); dirs.push(d);
    const file = join(d, 'howler.config.json');
    writeFileSync(file, '﻿{"http":{"port":9000}}');
    process.env.HOWLER_CONFIG = file;
    expect(loadConfig().http.port).toBe(9000);
    saveConfig({ language: 'en' }, file);
    expect(loadConfig().language).toBe('en');
    expect(loadConfig().http.port).toBe(9000);
  });

  it('conserva el tema del panel (panelTheme) junto al de la web al guardar y volver a cargar', () => {
    const d = mkdtempSync(join(tmpdir(), 'howler-cfg-')); dirs.push(d);
    const file = join(d, 'howler.config.json');
    writeFileSync(file, '{}');
    process.env.HOWLER_CONFIG = file;
    saveConfig({ appearance: { layouts: {}, theme: 'gt', panelTheme: 'original' } }, file, ['appearance']);
    expect(loadConfig().appearance).toMatchObject({ theme: 'gt', panelTheme: 'original' });
  });
});
