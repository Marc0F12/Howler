import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAssettoCorsa, createNewServer, entryList, findAssettoCorsa, pickDefaults, serverCfg } from './new-server';
import { install, type Sys } from './setup/flow';
import { writeTarGz } from '../../server/src/core/tar';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-new-')); dirs.push(d); return d; };
const w = (p: string, c = '') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };

/** Un Assetto Corsa de mentira: un coche con skin, un circuito con layout y los datos de sistema del servidor. */
function fakeAC(base: string, opts: { car?: string; track?: string; boxes?: number } = {}) {
  const ac = join(base, 'assettocorsa');
  const car = opts.car ?? 'ks_mazda_mx5_nd', track = opts.track ?? 'ks_vallelunga';
  w(join(ac, 'content', 'cars', car, 'skins', '00_red', 'preview.jpg'));
  w(join(ac, 'content', 'cars', car, 'skins', '01_blue', 'preview.jpg'));
  w(join(ac, 'content', 'tracks', track, 'ui', 'club', 'ui_track.json'), `{"name":"x","pitboxes":"${opts.boxes ?? 24}"}`);
  w(join(ac, 'server', 'system', 'data', 'surfaces.ini'), '');
  return ac;
}
function fakeAssetto(base: string) {
  const a = join(base, 'assetto');
  w(join(a, 'AssettoServer.exe'), 'EXE');
  w(join(a, 'wwwroot', 'index.html'), '<html>');
  return a;
}

describe('servidor nuevo', () => {
  it('comprueba una carpeta de Assetto Corsa y dice qué le falta', () => {
    const base = tmp();
    expect(checkAssettoCorsa(fakeAC(base))).toEqual({ ok: true, problem: null });
    expect(checkAssettoCorsa(join(base, 'nada')).problem).toMatch(/no existe/);
    const vacia = tmp();
    expect(checkAssettoCorsa(vacia).problem).toMatch(/no parece Assetto Corsa/);
    const sinSistema = tmp();
    mkdirSync(join(sinSistema, 'content', 'cars'), { recursive: true });
    mkdirSync(join(sinSistema, 'content', 'tracks'), { recursive: true });
    expect(checkAssettoCorsa(sinSistema).problem).toMatch(/datos de sistema/);
  });

  it('encuentra Assetto Corsa en las bibliotecas de Steam', () => {
    const steam = tmp();
    fakeAC(join(steam, 'steamapps', 'common'));
    expect(findAssettoCorsa([steam])).toHaveLength(1);
    expect(findAssettoCorsa([tmp()])).toEqual([]);
  });

  it('elige un coche, un skin y un circuito que existen, y limita las plazas a los boxes', () => {
    const base = tmp();
    const ac = fakeAC(base, { boxes: 5 });
    expect(pickDefaults(ac)).toEqual({ car: 'ks_mazda_mx5_nd', skin: '00_red', track: 'ks_vallelunga', layout: 'club', slots: 5 });
    // Sin boxes conocidos: 8 plazas; con más de 8 también.
    expect(pickDefaults(fakeAC(tmp(), { boxes: 40 })).slots).toBe(8);
  });

  it('si no están los de serie, usa lo primero que haya; sin coches avisa', () => {
    const base = tmp();
    const ac = fakeAC(base, { car: 'mi_coche', track: 'mi_circuito' });
    const c = pickDefaults(ac);
    expect([c.car, c.track]).toEqual(['mi_coche', 'mi_circuito']);
    const empty = tmp();
    mkdirSync(join(empty, 'content', 'cars'), { recursive: true });
    mkdirSync(join(empty, 'content', 'tracks'), { recursive: true });
    expect(() => pickDefaults(empty)).toThrow(/ningún coche/);
  });

  it('el preset trae los puertos de Howler y una plaza por coche', () => {
    const c = { car: 'x', skin: 's', track: 't', layout: 'l', slots: 3 };
    const cfg = serverCfg(c, { udp: 9600, tcp: 9600, http: 8081, acsp: 12000, acspServer: 11000 }, 'Mi servidor');
    expect(cfg).toContain('UDP_PLUGIN_ADDRESS=127.0.0.1:12000');
    expect(cfg).toContain('UDP_PLUGIN_LOCAL_PORT=11000');
    expect(cfg).toContain('MAX_CLIENTS=3');
    expect(cfg).toContain('NAME=Mi servidor');
    expect(cfg).toContain('\r\n');
    expect(entryList(c).match(/\[CAR_\d+\]/g)).toHaveLength(3);
  });

  it('crea la carpeta con AssettoServer, enlaces al juego y el preset, sin tocar Assetto Corsa', () => {
    const base = tmp();
    const ac = fakeAC(base), assetto = fakeAssetto(base), target = join(base, 'nuevo');
    const r = createNewServer({ acDir: ac, target, assettoDir: assetto });
    expect(r.preset).toBe('SERVER_00');
    expect(existsSync(join(target, 'AssettoServer.exe'))).toBe(true);
    expect(existsSync(join(target, 'wwwroot', 'index.html'))).toBe(true);
    expect(lstatSync(join(target, 'content')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(target, 'content', 'cars', 'ks_mazda_mx5_nd', 'skins'))).toBe(true);
    expect(existsSync(join(target, 'system', 'data', 'surfaces.ini'))).toBe(true);
    expect(readFileSync(join(target, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'utf8')).toContain('HowlerPlugin');
    expect(existsSync(join(target, 'cfg', 'server_cfg.ini'))).toBe(true);
    // Assetto Corsa no se modifica.
    expect(existsSync(join(ac, 'server', 'cfg'))).toBe(false);
  });

  it('se niega si la carpeta ya tiene archivos o si falta algo', () => {
    const base = tmp();
    const ac = fakeAC(base), assetto = fakeAssetto(base), target = join(base, 'ocupada');
    w(join(target, 'algo.txt'), 'x');
    expect(() => createNewServer({ acDir: ac, target, assettoDir: assetto })).toThrow(/ya tiene archivos/);
    expect(() => createNewServer({ acDir: join(base, 'nada'), target: join(base, 'a'), assettoDir: assetto })).toThrow(/no es válida/);
    expect(() => createNewServer({ acDir: ac, target: join(base, 'b'), assettoDir: join(base, 'sin') })).toThrow(/AssettoServer/);
  });

  it('el instalador crea el servidor nuevo con el AssettoServer incluido y deja el plugin puesto', async () => {
    const base = tmp();
    const ac = fakeAC(base), target = join(base, 'servidor');
    const archive = join(base, 'assetto.tar.gz');
    await writeTarGz(archive, [{ name: 'AssettoServer.exe', data: Buffer.from('EXE') }, { name: 'wwwroot/index.html', data: Buffer.from('<html>') }]);
    const pay = join(base, 'payload.tar.gz');
    await writeTarGz(pay, [{ name: 'Howler.exe', data: Buffer.from('EXE') }, { name: 'plugin/HowlerPlugin/HowlerPlugin.dll', data: Buffer.from('plugin') }]);
    const calls: string[] = [];
    const sys: Sys = {
      isRunning: async () => false, powershell: async () => undefined, regAdd: async () => undefined, regDelete: async () => undefined,
      download: async () => { calls.push('download'); throw new Error('no debería descargar'); },
      unzip: async () => undefined, startupDir: () => join(base, 's'), desktopDir: () => join(base, 'd'), startMenuDir: () => join(base, 'm'),
    };
    const report = await install({ installDir: join(base, 'Howler'), mode: 'new', acDir: ac, copyTo: target, firewall: false, shortcuts: false, autostart: false, webPort: 8420, payload: pay, version: '0.1.1', assettoArchive: () => archive }, sys, () => undefined);
    expect(calls).toEqual([]);
    expect(report.serverDir).toBe(target);
    expect(report.notes).toContain('new-server');
    expect(existsSync(join(target, 'AssettoServer.exe'))).toBe(true);
    expect(readFileSync(join(target, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'), 'utf8')).toBe('plugin');
    const cfg = JSON.parse(readFileSync(join(base, 'Howler', 'howler.config.json'), 'utf8'));
    expect(cfg.serverDir).toBe(target);
    expect(cfg.server.preset).toBe('SERVER_00');
  });

  it('el modo nuevo pide la carpeta de Assetto Corsa y la del servidor', async () => {
    const base = tmp();
    const pay = join(base, 'p.tar.gz');
    await writeTarGz(pay, [{ name: 'Howler.exe', data: Buffer.from('EXE') }]);
    const sys: Sys = { isRunning: async () => false, powershell: async () => undefined, regAdd: async () => undefined, regDelete: async () => undefined, download: async () => undefined, unzip: async () => undefined, startupDir: () => base, desktopDir: () => base, startMenuDir: () => base };
    await expect(install({ installDir: join(base, 'H'), mode: 'new', firewall: false, shortcuts: false, autostart: false, webPort: 8420, payload: pay, version: '0.1.1' }, sys, () => undefined)).rejects.toThrow(/Falta la carpeta/);
  });
});
