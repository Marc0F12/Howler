import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { passwordProblem, readPasswordText, readServerPassword, setPasswordText, writeServerPassword } from './server-password';

const INI = '﻿[SERVER]\r\nNAME=Prueba\r\nPASSWORD=abc\r\nADMIN_PASSWORD=zzz\r\n\r\n[PRACTICE]\r\nNAME=Practice\r\nTIME=10\r\n';

describe('contraseña del servidor', () => {
  it('lee solo la de [SERVER], no ADMIN_PASSWORD', () => {
    expect(readPasswordText(INI)).toBe('abc');
    expect(readPasswordText('[SERVER]\nNAME=x\n')).toBe('');
  });

  it('cambia, quita y añade la clave conservando BOM y saltos de línea', () => {
    expect(setPasswordText(INI, 'nueva')).toBe(INI.replace('PASSWORD=abc', 'PASSWORD=nueva'));
    expect(setPasswordText(INI, '')).toContain('\r\nPASSWORD=\r\n');
    expect(setPasswordText('[SERVER]\nNAME=x\n', 'k')).toBe('[SERVER]\nPASSWORD=k\nNAME=x\n');
  });

  it('no acepta contraseñas con saltos de línea, espacios en los bordes o demasiado largas', () => {
    expect(passwordProblem('a\nb')).not.toBeNull();
    expect(passwordProblem(' a')).not.toBeNull();
    expect(passwordProblem('x'.repeat(65))).not.toBeNull();
    expect(passwordProblem('')).toBeNull();
    expect(passwordProblem('con espacio dentro')).toBeNull();
  });

  it('escribe en el preset y guarda la copia anterior', () => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-pw-'));
    mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
    const file = join(dir, 'presets', 'P', 'server_cfg.ini');
    writeFileSync(file, INI);
    expect(writeServerPassword(dir, 'P', 'otra')).toEqual({ password: 'otra', hasPassword: true });
    expect(readFileSync(`${file}.howler-prev`, 'utf8')).toBe(INI);
    expect(writeServerPassword(dir, 'P', '')).toEqual({ password: '', hasPassword: false });
    expect(readServerPassword(dir, 'P').hasPassword).toBe(false);
    expect(() => writeServerPassword(dir, 'P', 'a\nb')).toThrow();
  });
});
