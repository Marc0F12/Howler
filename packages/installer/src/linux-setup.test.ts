import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupLinuxServer } from './linux-setup';

let root: string;
let server: string;
let plugin: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'howler-linux-'));
  server = join(root, 'server');
  plugin = join(root, 'pkg', 'plugin', 'HowlerPlugin');
  home = join(root, 'pkg');
  mkdirSync(join(server, 'presets', 'SERVER_00'), { recursive: true });
  mkdirSync(join(server, 'cfg'), { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(server, 'AssettoServer'), 'binario');
  writeFileSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), '[SERVER]\nNAME=Mi servidor\nUDP_PLUGIN_ADDRESS=\nUDP_PLUGIN_LOCAL_PORT=\n');
  writeFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'EnableWeatherFx: true\nEnablePlugins:\n  - OtroPlugin\n');
  writeFileSync(join(plugin, 'HowlerPlugin.dll'), 'dll');
  writeFileSync(join(plugin, 'HowlerPlugin.deps.json'), '{}');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('preparar un servidor de Linux para Howler', () => {
  it('copia el plugin, activa la interfaz y el plugin en cada preset y crea la configuración', () => {
    const r = setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home });
    expect(r).toMatchObject({ exe: 'AssettoServer', preset: 'SERVER_00', config: 'created' });
    expect(existsSync(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'))).toBe(true);
    const cfg = readFileSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8');
    expect(cfg).toContain('UDP_PLUGIN_ADDRESS=127.0.0.1:12000');
    expect(cfg).toContain('UDP_PLUGIN_LOCAL_PORT=11000');
    const extra = readFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'utf8');
    expect(extra).toContain('HowlerPlugin');
    expect(extra).toContain('EnableLegacyPluginInterface: true');
    expect(extra).toContain('EnableWeatherFx: true'); // lo que ya había se conserva
    expect(existsSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini.howler-prev'))).toBe(true);
    const conf = JSON.parse(readFileSync(join(home, 'howler.config.json'), 'utf8'));
    expect(conf.serverDir).toBe(server);
    expect(conf.server).toEqual({ exe: 'AssettoServer', preset: 'SERVER_00' });
  });

  it('repetirlo no cambia nada más y no pisa la configuración de Howler', () => {
    setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home });
    writeFileSync(join(home, 'howler.config.json'), '{"serverDir":"x","http":{"port":9999}}');
    const r = setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home });
    expect(r.config).toBe('kept');
    expect(r.changes.filter((c) => c.includes('server_cfg.ini'))).toEqual([]);
    expect(readFileSync(join(home, 'howler.config.json'), 'utf8')).toContain('9999');
  });

  it('crea extra_cfg.yml si el preset no lo tiene', () => {
    rmSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'));
    setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home });
    expect(readFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'utf8')).toContain('HowlerPlugin');
  });

  it('rechaza lo que no sirve con un mensaje claro', () => {
    expect(() => setupLinuxServer({ serverDir: join(root, 'no-existe'), pluginDir: plugin, installDir: home })).toThrow(/no es válida/);
    rmSync(join(server, 'AssettoServer'));
    writeFileSync(join(server, 'acServer'), 'viejo');
    expect(() => setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home })).toThrow(/pre35/);
    writeFileSync(join(server, 'AssettoServer'), 'x');
    expect(() => setupLinuxServer({ serverDir: server, pluginDir: join(root, 'vacío'), installDir: home })).toThrow(/HowlerPlugin\.dll/);
    expect(() => setupLinuxServer({ serverDir: server, pluginDir: plugin, installDir: home, preset: 'NOPE' })).toThrow(/no existe/);
  });
});
