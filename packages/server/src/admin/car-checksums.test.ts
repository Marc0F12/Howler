import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowMissingChecksums, applyCarChecksums, readCarChecksums, setMissingCarChecksumsText } from './car-checksums';

function server() {
  const dir = mkdtempSync(join(tmpdir(), 'howler-acd-'));
  mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), '[SERVER]\r\n');
  writeFileSync(join(dir, 'presets', 'P', 'entry_list.ini'), '[CAR_0]\r\nMODEL=mod_car\r\n[CAR_1]\r\nMODEL=mod_car\r\n[CAR_2]\r\nMODEL=ks_mazda\r\n');
  writeFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'EnableWeatherFx: false\n');
  for (const m of ['mod_car', 'ks_mazda']) { mkdirSync(join(dir, 'content', 'cars', m), { recursive: true }); writeFileSync(join(dir, 'content', 'cars', m, 'data.acd'), 'x'); }
  return dir;
}

describe('data.acd de los coches', () => {
  it('lista los coches distintos y si exigen data.acd', () => {
    const s = readCarChecksums(server(), 'P');
    expect(s.cars.map((c) => [c.model, c.required, c.skipped])).toEqual([['mod_car', true, false], ['ks_mazda', true, false]]);
    expect(s.flag).toBe(false);
  });
  it('distingue un coche con data.acd, uno con la carpeta data sin empaquetar y uno sin nada', () => {
    const dir = server();
    mkdirSync(join(dir, 'content', 'cars', 'mod_car', 'data'));
    expect(readCarChecksums(dir, 'P').cars.find((c) => c.model === 'mod_car')).toMatchObject({ required: true, unpacked: false });
    const acd = join(dir, 'content', 'cars', 'mod_car', 'data.acd');
    writeFileSync(acd, 'x');
    rmSync(acd);
    expect(readCarChecksums(dir, 'P').cars.find((c) => c.model === 'mod_car')).toMatchObject({ required: false, unpacked: true });
  });
  it('desactiva (renombra) y reactiva, y activa MissingCarChecksums en el extra_cfg', () => {
    const dir = server();
    expect(applyCarChecksums(dir, 'P', ['mod_car'], true)).toEqual({ changed: ['mod_car'], refused: [] });
    expect(existsSync(join(dir, 'content', 'cars', 'mod_car', 'data.acd'))).toBe(false);
    expect(existsSync(join(dir, 'content', 'cars', 'mod_car', 'data.acd.howler-off'))).toBe(true);
    const s = readCarChecksums(dir, 'P');
    expect(s.cars[0]).toMatchObject({ skipped: true, required: false });
    expect(s.flag).toBe(true);
    expect(readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'utf8')).toContain('IgnoreConfigurationErrors:\n  MissingCarChecksums: true');
    expect(applyCarChecksums(dir, 'P', ['mod_car'], false).changed).toEqual(['mod_car']);
    expect(readCarChecksums(dir, 'P').cars[0]).toMatchObject({ skipped: false, required: true });
  });
  it('rechaza coches que no están en la lista, o ajenos', () => {
    const dir = server();
    expect(applyCarChecksums(dir, 'P', ['../../x'], true).refused[0]!.reason).toMatch(/no está en la lista/);
  });
  it('no toca una carpeta de coche que es un enlace', () => {
    const dir = server();
    const real = mkdtempSync(join(tmpdir(), 'howler-real-'));
    writeFileSync(join(real, 'data.acd'), 'x');
    mkdirSync(join(dir, 'content', 'cars'), { recursive: true });
    symlinkSync(real, join(dir, 'content', 'cars', 'linked_car'), 'junction');
    writeFileSync(join(dir, 'presets', 'P', 'entry_list.ini'), '[CAR_0]\nMODEL=linked_car\n');
    const r = applyCarChecksums(dir, 'P', ['linked_car'], true);
    expect(r.changed).toEqual([]);
    expect(r.refused[0]!.reason).toMatch(/enlace/);
    expect(existsSync(join(real, 'data.acd'))).toBe(true);
  });
});

describe('allowMissingChecksums', () => {
  it('activa y desactiva la opción sin tocar los coches, guarda copia y no hace nada si ya estaba', () => {
    const dir = server();
    const file = join(dir, 'presets', 'P', 'extra_cfg.yml');
    expect(allowMissingChecksums(dir, 'P', true)).toBe(true);
    expect(readCarChecksums(dir, 'P').flag).toBe(true);
    expect(readFileSync(`${file}.howler-prev`, 'utf8')).toBe('EnableWeatherFx: false\n');
    expect(existsSync(join(dir, 'content', 'cars', 'mod_car', 'data.acd'))).toBe(true);
    expect(allowMissingChecksums(dir, 'P', true)).toBe(false);
    expect(allowMissingChecksums(dir, 'P', false)).toBe(true);
    expect(readCarChecksums(dir, 'P').flag).toBe(false);
    expect(() => allowMissingChecksums(dir, 'NO', true)).toThrow();
  });
});

describe('setMissingCarChecksumsText', () => {
  it('añade el bloque, lo completa o cambia el valor', () => {
    expect(setMissingCarChecksumsText('A: 1\n', true)).toBe('A: 1\nIgnoreConfigurationErrors:\n  MissingCarChecksums: true\n');
    expect(setMissingCarChecksumsText('IgnoreConfigurationErrors:\n  MissingTrackParams: true\nB: 2\n', true)).toBe('IgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\nB: 2\n');
    expect(setMissingCarChecksumsText('IgnoreConfigurationErrors:\n  MissingCarChecksums: false\n', true)).toContain('MissingCarChecksums: true');
    expect(setMissingCarChecksumsText('IgnoreConfigurationErrors: {}\r\nZ: 1\r\n', true)).toBe('IgnoreConfigurationErrors:\r\n  MissingCarChecksums: true\r\nZ: 1\r\n');
    // La forma en línea no pierde lo que ya traía (p. ej. el ajuste que exige la migración)
    expect(setMissingCarChecksumsText('IgnoreConfigurationErrors: { MissingTrackParams: true }\nZ: 1\n', true)).toBe('IgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\nZ: 1\n');
    expect(() => setMissingCarChecksumsText('IgnoreConfigurationErrors: raro\n', true)).toThrow(/inesperado/);
  });
});
