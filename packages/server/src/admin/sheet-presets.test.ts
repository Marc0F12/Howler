import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteSheetPreset, MAX_SHEET_PRESETS, readSheetPresets, saveSheetPreset, setDefaultSheetPreset } from './sheet-presets';

const dir = () => mkdtempSync(join(tmpdir(), 'howler-presets-'));

describe('presets de la ficha', () => {
  it('sin archivo no hay presets ni defecto', () => {
    expect(readSheetPresets(dir())).toEqual({ presets: [], defaultId: null });
  });
  it('guarda un preset limpiando el BBCode y lo lee', () => {
    const d = dir();
    const r = saveSheetPreset(d, '  Mi   preset ', '[b]hola[/b][center]x[/center]');
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0]).toMatchObject({ name: 'Mi preset', description: '[b]hola[/b]x' });
    expect(r.presets[0]!.id).toMatch(/^u[0-9a-f]{12}$/);
    expect(readSheetPresets(d)).toEqual(r);
  });
  it('guardar con el mismo nombre lo sustituye en vez de duplicarlo', () => {
    const d = dir();
    saveSheetPreset(d, 'Normas', 'uno');
    const r = saveSheetPreset(d, 'normas', 'dos');
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0]!.description).toBe('dos');
  });
  it('rechaza nombres vacíos o largos y pone un tope de presets', () => {
    const d = dir();
    expect(() => saveSheetPreset(d, '  ', 'x')).toThrow(/nombre/);
    expect(() => saveSheetPreset(d, 'x'.repeat(41), 'x')).toThrow(/largo/);
    for (let i = 0; i < MAX_SHEET_PRESETS; i++) saveSheetPreset(d, `p${i}`, 'x');
    expect(() => saveSheetPreset(d, 'otro', 'x')).toThrow(/presets/);
  });
  it('el preset por defecto puede ser de serie o propio, y se olvida al borrarlo', () => {
    const d = dir();
    const id = saveSheetPreset(d, 'Mío', 'x').presets[0]!.id;
    expect(setDefaultSheetPreset(d, id).defaultId).toBe(id);
    expect(setDefaultSheetPreset(d, 'rules').defaultId).toBe('rules');
    expect(setDefaultSheetPreset(d, 'howler').defaultId).toBeNull();
    expect(() => setDefaultSheetPreset(d, 'uinventado')).toThrow(/no existe/);
    setDefaultSheetPreset(d, id);
    expect(deleteSheetPreset(d, id)).toEqual({ presets: [], defaultId: null });
    expect(() => deleteSheetPreset(d, id)).toThrow(/no existe/);
  });
  it('un archivo estropeado o con datos raros no rompe nada', () => {
    const d = dir();
    writeFileSync(join(d, 'sheet-presets.json'), '{ no es json');
    expect(readSheetPresets(d)).toEqual({ presets: [], defaultId: null });
    writeFileSync(join(d, 'sheet-presets.json'), JSON.stringify({ presets: [{ id: '../x', name: 'a', description: 'b' }, 5, null, { id: 'u0123456789ab', name: 'ok', description: 'd' }], defaultId: 7 }));
    expect(readSheetPresets(d)).toEqual({ presets: [{ id: 'u0123456789ab', name: 'ok', description: 'd' }], defaultId: null });
    expect(readFileSync(join(d, 'sheet-presets.json'), 'utf8')).toContain('u0123456789ab');
  });
});
