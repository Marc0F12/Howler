import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, rollback } from './migrate';
import { transformExtraCfg, transformServerCfg } from './transform';

const SERVER_CFG = '﻿[SERVER]\r\nNAME=Patata\r\nREVERSED_GRID_RACE_POSITIONS=-1\r\nUDP_PLUGIN_LOCAL_PORT=11000\r\nUDP_PLUGIN_ADDRESS=primeserver.ddns.net:12000\r\nTCP_PORT=9600\r\n\r\n[PRACTICE]\r\nNAME=Practice\r\n';
const EXTRA_CFG = `﻿# Comentario que debe sobrevivir
UseSteamAuth: false
EnableLegacyPluginInterface: false
EnablePlugins:
  - ScoreTrackerPlugin
ScoreTrackerPlugin:
  DatabasePath: "ScoreTracker.db"
  EnableDiscord: true
IgnoreConfigurationErrors:
  MissingCarChecksums: false
  MissingTrackParams: false
RconPort: 0
`;

describe('server_cfg.ini', () => {
  it('migra el grid, los puertos del plugin y conserva BOM y saltos de línea', () => {
    const r = transformServerCfg(SERVER_CFG, { acspPort: 12000, acspServerPort: 11000 });
    expect(r.text.startsWith('﻿')).toBe(true);
    expect(r.text).toContain('REVERSED_GRID_RACE_POSITIONS=0\r\n');
    expect(r.text).toContain('UDP_PLUGIN_ADDRESS=127.0.0.1:12000\r\n');
    expect(r.text).toContain('NAME=Patata\r\n');
    expect(r.changes).toHaveLength(2);
  });
  it('es idempotente', () => {
    const once = transformServerCfg(SERVER_CFG, { acspPort: 12000, acspServerPort: 11000 });
    const twice = transformServerCfg(once.text, { acspPort: 12000, acspServerPort: 11000 });
    expect(twice.text).toBe(once.text);
    expect(twice.changes).toEqual([]);
  });
  it('sin sección [SERVER] no finge que ha añadido nada: falla con un mensaje claro', () => {
    expect(() => transformServerCfg('NAME=x\n', { acspPort: 12000, acspServerPort: 11000 })).toThrow(/\[SERVER\]/);
    const crlf = transformServerCfg('[SERVER]\r\nNAME=x\r\n', { acspPort: 12000, acspServerPort: 11000 });
    expect(crlf.text).toContain('UDP_PLUGIN_ADDRESS=127.0.0.1:12000\r\n'); // sin mezclar saltos de línea
  });
  it('añade las claves que falten', () => {
    const r = transformServerCfg('[SERVER]\nNAME=x\n', { acspPort: 12000, acspServerPort: 11000 });
    expect(r.text).toContain('UDP_PLUGIN_ADDRESS=127.0.0.1:12000');
    expect(r.text).toContain('UDP_PLUGIN_LOCAL_PORT=11000');
  });
});

describe('extra_cfg.yml', () => {
  const opts = { availablePlugins: ['HowlerPlugin', 'LiveWeatherPlugin'] };
  it('activa la interfaz, cambia los plugins y quita configuraciones antiguas', () => {
    const r = transformExtraCfg(EXTRA_CFG, opts);
    expect(r.text.startsWith('﻿')).toBe(true);
    expect(r.text).toContain('# Comentario que debe sobrevivir');
    expect(r.text).toContain('EnableLegacyPluginInterface: true');
    expect(r.text).toMatch(/EnablePlugins:\s*\n\s*- HowlerPlugin/);
    expect(r.text).not.toContain('ScoreTrackerPlugin');
    expect(r.text).toMatch(/MissingTrackParams: true/);
    expect(r.text).toContain('MissingCarChecksums: false');
    expect(r.warnings.join(' ')).toContain('ScoreTrackerPlugin');
  });
  it('conserva plugins que sí existen y es idempotente', () => {
    const src = 'EnablePlugins:\n  - LiveWeatherPlugin\nEnableLegacyPluginInterface: true\n';
    const r = transformExtraCfg(src, opts);
    expect(r.text).toMatch(/- LiveWeatherPlugin\s*\n\s*- HowlerPlugin/);
    const again = transformExtraCfg(r.text, opts);
    expect(again.text).toBe(r.text);
  });
  it('rechaza YAML roto sin tocar nada', () => {
    expect(() => transformExtraCfg('a: [1, 2\nb: : :', opts)).toThrow();
  });
});

describe('migrar y deshacer', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  const w = (p: string, c: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };
  const hashTree = (root: string, skip: string[] = []) => {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (!skip.some((s) => p.includes(s))) out[p.slice(root.length)] = createHash('sha1').update(readFileSync(p)).digest('hex');
      }
    };
    walk(root);
    return out;
  };

  function fixture() {
    const base = mkdtempSync(join(tmpdir(), 'howler-mig-'));
    dirs.push(base);
    const server = join(base, 'server'), fresh = join(base, 'new'), plugin = join(base, 'plugin');
    w(join(server, 'acServer.exe'), 'EXE VIEJO');
    w(join(server, 'steam_api64.dll'), 'steam viejo');
    w(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), SERVER_CFG);
    w(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), EXTRA_CFG);
    w(join(server, 'presets', 'SERVER_01', 'server_cfg.ini'), SERVER_CFG);
    w(join(server, 'plugins', 'ScoreTrackerPlugin', 'ScoreTrackerPlugin.dll'), 'tercero');
    w(join(fresh, 'AssettoServer.exe'), 'EXE NUEVO');
    w(join(fresh, 'steam_api64.dll'), 'steam nuevo');
    w(join(fresh, 'wwwroot', 'index.html'), '<html>');
    w(join(fresh, 'plugins', 'LiveWeatherPlugin', 'LiveWeatherPlugin.dll'), 'builtin');
    w(join(plugin, 'HowlerPlugin.dll'), 'plugin');
    w(join(plugin, 'HowlerPlugin.deps.json'), '{}');
    return { server, fresh, plugin };
  }

  it('instala la versión nueva, el plugin y migra los presets', () => {
    const { server, fresh, plugin } = fixture();
    const r = migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin });
    expect(readFileSync(join(server, 'acServer.exe'), 'utf8')).toBe('EXE NUEVO');
    expect(existsSync(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'))).toBe(true);
    expect(existsSync(join(server, 'wwwroot', 'index.html'))).toBe(true);
    expect(readFileSync(join(server, 'presets', 'SERVER_01', 'server_cfg.ini'), 'utf8')).toContain('REVERSED_GRID_RACE_POSITIONS=0');
    expect(readFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'utf8')).toContain('HowlerPlugin');
    expect(existsSync(join(r.backupDir, 'acServer.exe'))).toBe(true);
    expect(r.warnings.join(' ')).toContain('ScoreTrackerPlugin');
  });

  it('la marcha atrás deja el servidor idéntico al original, byte a byte', () => {
    const { server, fresh, plugin } = fixture();
    const before = hashTree(server);
    migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin });
    expect(hashTree(server, ['howler-backup', 'howler-migration.json'])).not.toEqual(before);
    const r = rollback(server);
    expect(r.restored).toBeGreaterThan(0);
    expect(hashTree(server, ['howler-backup'])).toEqual(before);
    expect(existsSync(join(server, 'plugins', 'HowlerPlugin'))).toBe(false);
    expect(existsSync(join(server, 'wwwroot'))).toBe(false);
  });

  it('un extra_cfg.yml que no se entiende aborta SIN tocar nada (ni el ejecutable)', () => {
    const { server, fresh, plugin } = fixture();
    w(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'a: [1, 2\nb: : :');
    const before = hashTree(server);
    expect(() => migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin })).toThrow(/No se ha modificado nada/);
    expect(hashTree(server)).toEqual(before);
    expect(existsSync(join(server, 'howler-backup'))).toBe(false);
    expect(existsSync(join(server, 'howler-migration.json'))).toBe(false);
  });

  it('si algo falla a mitad, se deshace solo y todo queda idéntico', () => {
    const { server, fresh, plugin } = fixture();
    const before = hashTree(server);
    for (const n of [0, 1, 3, 6, 8]) {
      expect(() => migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin, failAfterCopies: n })).toThrow(/Se ha deshecho todo/);
      expect(hashTree(server, ['howler-backup'])).toEqual(before);
    }
  });

  it('un fallo antes de tocar nada NO borra las copias de seguridad anteriores', () => {
    const { server, fresh, plugin } = fixture();
    w(join(server, 'howler-backup', 'anterior', 'cfg.ini'), 'copia vieja');
    expect(() => migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin, failAfterCopies: 0 })).toThrow(/Se ha deshecho todo/);
    expect(readFileSync(join(server, 'howler-backup', 'anterior', 'cfg.ini'), 'utf8')).toBe('copia vieja');
  });

  it('copia también un plugin con subcarpetas y no falla sin carpeta plugins en el servidor nuevo', () => {
    const { server, fresh, plugin } = fixture();
    w(join(plugin, 'runtimes', 'x.dll'), 'x');
    rmSync(join(fresh, 'plugins'), { recursive: true, force: true });
    migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin });
    expect(existsSync(join(server, 'plugins', 'HowlerPlugin', 'runtimes', 'x.dll'))).toBe(true);
  });

  it('entiende un extra_cfg.yml con claves repetidas (gana la última)', () => {
    const { server, fresh, plugin } = fixture();
    w(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'EnableClientMessages: false\nEnablePlugins:\n  - ScoreTrackerPlugin\nEnableClientMessages: true\n');
    const r = migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin });
    const out = readFileSync(join(server, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'utf8');
    expect(out.match(/EnableClientMessages/g)).toHaveLength(1);
    expect(out).toContain('EnableClientMessages: true');
    expect(r.changes.join(' ')).toContain('Clave repetida EnableClientMessages');
  });

  it('no migra dos veces ni sin acServer.exe', () => {
    const { server, fresh, plugin } = fixture();
    migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin });
    expect(() => migrate({ serverDir: server, newServerDir: fresh, pluginDir: plugin })).toThrow(/ya está migrado/);
    expect(() => migrate({ serverDir: join(server, 'nada'), newServerDir: fresh, pluginDir: plugin })).toThrow(/acServer\.exe/);
    expect(() => rollback(join(server, 'presets'))).toThrow(/no está migrado/);
  });
});
