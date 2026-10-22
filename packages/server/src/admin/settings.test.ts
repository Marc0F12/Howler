import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveConfig, schema } from '../config';
import { candidateServerDirs, checkServerDir, defaultExe, detectServers, parseLibraryFolders } from './detect-server';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-adm-')); dirs.push(d); return d; };
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const touch = (p: string, c = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };

describe('configuración', () => {
  it('los valores por defecto son los esperados', () => {
    const c = schema.parse({});
    expect(c.http.port).toBe(8420);
    expect(c.admin.port).toBe(8421);
    expect(c.acsp.pluginCommandPort).toBe(12002);
    expect(c.server).toMatchObject({ exe: defaultExe(), preset: 'SERVER_00', startWithHowler: false, stopWarningSeconds: 10 });
  });

  it('saveConfig mezcla el cambio, valida y conserva lo demás', () => {
    const f = join(tmp(), 'howler.config.json');
    writeFileSync(f, JSON.stringify({ serverDir: 'E:\\x', http: { port: 8420, host: '0.0.0.0' } }));
    saveConfig({ http: { port: 9000 }, server: { preset: 'SERVER_01' } }, f);
    const out = JSON.parse(readFileSync(f, 'utf8'));
    expect(out).toMatchObject({ serverDir: 'E:\\x', http: { port: 9000, host: '0.0.0.0' }, server: { preset: 'SERVER_01' } });
  });

  it('saveConfig no escribe nada si el resultado no es válido', () => {
    const f = join(tmp(), 'howler.config.json');
    const before = JSON.stringify({ http: { port: 8420 } });
    writeFileSync(f, before);
    expect(() => saveConfig({ http: { port: 70000 } }, f)).toThrow();
    expect(() => saveConfig({ server: { stopWarningSeconds: -1 } }, f)).toThrow();
    expect(readFileSync(f, 'utf8')).toBe(before);
  });

  it('crea el archivo si no existe', () => {
    const f = join(tmp(), 'nuevo.json');
    saveConfig({ serverDir: 'E:\\srv' }, f);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ serverDir: 'E:\\srv' });
  });
});

describe('detección del servidor de AC', () => {
  it('lee las bibliotecas de Steam del vdf', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"E:\\\\SteamLibrary"\n\t}\n}';
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'E:\\SteamLibrary']);
  });

  it('encuentra servidores en todas las bibliotecas', () => {
    const root = tmp(), lib2 = tmp();
    touch(join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${lib2.replace(/\\/g, '\\\\')}" } }`);
    const srv = join(lib2, 'steamapps', 'common', 'assettocorsa', 'server');
    touch(join(srv, 'acServer.exe'));
    touch(join(srv, 'presets', 'SERVER_00', 'server_cfg.ini'));
    expect(candidateServerDirs([root])).toContain(srv);
    const found = detectServers([root]);
    expect(found).toHaveLength(1);
    expect(found[0]!.dir).toBe(srv);
    expect(found[0]!.check.presets).toEqual(['SERVER_00']);
  });

  it('valida una carpeta y explica qué falta', () => {
    const d = tmp();
    expect(checkServerDir(join(d, 'no-existe')).problems[0]).toMatch(/no existe/);
    const bad = checkServerDir(d);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(' ')).toMatch(new RegExp(defaultExe().replace('.', '\.')));

    touch(join(d, 'acServer.exe'));
    touch(join(d, 'presets', 'SERVER_00', 'server_cfg.ini'));
    const noPlugin = checkServerDir(d);
    expect(noPlugin.ok).toBe(true);
    expect(noPlugin.hasPlugin).toBe(false);
    expect(noPlugin.problems.join(' ')).toMatch(/plugin de Howler/);

    touch(join(d, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'));
    touch(join(d, 'howler-migration.json'), '{}');
    const ok = checkServerDir(d);
    expect(ok).toMatchObject({ hasPlugin: true, migrated: true });
  });
});
