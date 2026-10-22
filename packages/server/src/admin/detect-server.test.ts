import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkServerDir, defaultExe } from './detect-server';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'howler-detect-'));
  mkdirSync(join(dir, 'cfg'));
  writeFileSync(join(dir, 'cfg', 'server_cfg.ini'), '[SERVER]\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('detección del servidor de AC según el sistema', () => {
  it('el nombre habitual del ejecutable depende del sistema', () => {
    expect(defaultExe('win32')).toBe('acServer.exe');
    expect(defaultExe('linux')).toBe('AssettoServer');
  });
  it('encuentra el binario de Linux sin extensión', () => {
    writeFileSync(join(dir, 'AssettoServer'), '');
    const c = checkServerDir(dir, 'AssettoServer');
    expect(c.exe).toBe('AssettoServer');
    expect(c.ok).toBe(true);
  });
  it('encuentra AssettoServer aunque la configuración diga otro nombre, y avisa si no hay ninguno', () => {
    writeFileSync(join(dir, 'AssettoServer.exe'), '');
    expect(checkServerDir(dir, 'AssettoServer').exe).toBe('AssettoServer.exe');
    rmSync(join(dir, 'AssettoServer.exe'));
    const none = checkServerDir(dir, 'AssettoServer');
    expect(none.exe).toBeNull();
    expect(none.problems.join(' ')).toMatch(/No encuentro/);
  });
});
