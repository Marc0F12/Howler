import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SESSIONS } from '@howler/shared';
import { deleteSessionPreset, readSessionPresets, saveSessionPreset } from './session-presets';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'howler-presets-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('presets de sesión propios', () => {
  it('guarda, sustituye por nombre y borra', () => {
    saveSessionPreset(dir, 'Mi liga', { fuelRate: 50 }, DEFAULT_SESSIONS);
    let r = saveSessionPreset(dir, 'mi LIGA', { fuelRate: 70, abs: 0 }, DEFAULT_SESSIONS);
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0]!.values).toEqual({ fuelRate: 70, abs: 0 });
    r = deleteSessionPreset(dir, r.presets[0]!.id);
    expect(r.presets).toEqual([]);
    expect(() => deleteSessionPreset(dir, 'sabcdefabcdef')).toThrow(/No existe/);
  });
  it('omite ajustes inventados o con valores fuera de rango, pero valida las sesiones', () => {
    const r = saveSessionPreset(dir, 'X', { fuelRate: 50, inventado: 1, abs: 9 }, DEFAULT_SESSIONS);
    expect(r.presets[0]!.values).toEqual({ fuelRate: 50 });
    expect(() => saveSessionPreset(dir, 'Y', {}, { practice: {} })).toThrow();
    expect(() => saveSessionPreset(dir, '  ', {}, DEFAULT_SESSIONS)).toThrow(/nombre/);
  });
  it('un archivo roto no tira nada abajo', () => {
    writeFileSync(join(dir, 'session-presets.json'), '{ no es json');
    expect(readSessionPresets(dir).presets).toEqual([]);
    expect(readFileSync(join(dir, 'session-presets.json'), 'utf8')).toContain('no es json');
  });
});
