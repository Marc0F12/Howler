import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareVersions, HOWLER_VERSION, parseVersion, pickNotes } from './updates';

describe('versiones', () => {
  it('HOWLER_VERSION coincide con package.json', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
    expect(HOWLER_VERSION).toBe(JSON.parse(readFileSync(root, 'utf8')).version);
  });
  it('lee versiones con o sin v y rechaza lo que no lo es', () => {
    expect(parseVersion('v1.2.3')?.nums).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')?.nums).toEqual([1, 2, 0]);
    expect(parseVersion('1.2.3-beta.2')?.pre).toEqual(['beta', 2]);
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
  });
  it('compara como semver', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('basura', '1.0.0')).toBe(0);
  });
});

describe('notas por idioma', () => {
  const body = 'Intro\n<!-- lang:es -->\n## Novedades\n- Cosa\n<!-- lang:en -->\n## What is new\n- Thing\n';
  it('elige el idioma pedido y mantiene la introducción', () => {
    expect(pickNotes(body, 'en')).toBe('Intro\n\n## What is new\n- Thing');
    expect(pickNotes(body, 'es')).toBe('Intro\n\n## Novedades\n- Cosa');
  });
  it('si falta un idioma usa el español; sin marcadores, el texto entero', () => {
    expect(pickNotes('<!-- lang:es -->\nSolo español', 'en')).toBe('Solo español');
    expect(pickNotes('Sin marcadores\n- uno', 'en')).toBe('Sin marcadores\n- uno');
  });
});
