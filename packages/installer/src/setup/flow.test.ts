import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTarGz } from '../../../server/src/core/tar';
import { install, uninstall, UNINSTALL_KEY, updatePlugin, type Sys } from './flow';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-flow-')); dirs.push(d); return d; };
const w = (p: string, c: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };

function fakeSys(base: string, running: string[] = []) {
  const calls: string[] = [];
  const sys: Sys = {
    isRunning: async (i) => running.includes(i),
    powershell: async (s, e) => { calls.push(`ps${e ? '!' : ''}:${s.split('\n')[0]}`); },
    regAdd: async (k, v) => { calls.push(`reg+:${k}:${v.DisplayName}`); },
    regDelete: async (k) => { calls.push(`reg-:${k}`); },
    download: async () => { throw new Error('no debería descargar'); },
    unzip: async () => undefined,
    startupDir: () => join(base, 'startup'), desktopDir: () => join(base, 'desktop'), startMenuDir: () => join(base, 'menu'),
  };
  return { sys, calls };
}

async function payload(base: string) {
  const file = join(base, 'payload.tar.gz');
  await writeTarGz(file, [
    { name: 'Howler.exe', data: Buffer.from('EXE') },
    { name: 'app/howler.mjs', data: Buffer.from('app') },
    { name: 'web/index.html', data: Buffer.from('<html>') },
    { name: 'plugin/HowlerPlugin/HowlerPlugin.dll', data: Buffer.from('plugin NUEVO') },
    { name: 'data/howler.db', data: Buffer.from('NO DEBE COPIARSE') },
  ]);
  return file;
}

function oldServer(base: string) {
  const server = join(base, 'server'), fresh = join(base, 'assetto');
  w(join(server, 'acServer.exe'), 'EXE VIEJO');
  w(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), '[SERVER]\nNAME=x\n');
  w(join(server, 'content', 'tracks', '.keep'), '');
  w(join(fresh, 'AssettoServer.exe'), 'EXE NUEVO');
  return { server, fresh };
}

const opts = (installDir: string, payloadFile: string) => ({ installDir, mode: 'manual' as const, firewall: true, shortcuts: true, autostart: false, webPort: 8420, payload: payloadFile, version: '0.1.0' });

describe('instalador: flujo', () => {
  it('modo manual: copia el programa sin tocar los datos, crea la configuración y se registra', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    w(join(dir, 'data', 'howler.db'), 'MIS DATOS');
    w(join(dir, 'app', 'viejo.mjs'), 'viejo');
    const { sys, calls } = fakeSys(b);
    const steps: number[] = [];
    const r = await install(opts(dir, await payload(b)), sys, (p) => steps.push(p.percent));
    expect(readFileSync(join(dir, 'Howler.exe'), 'utf8')).toBe('EXE');
    expect(readFileSync(join(dir, 'data', 'howler.db'), 'utf8')).toBe('MIS DATOS');
    expect(existsSync(join(dir, 'app', 'viejo.mjs'))).toBe(false);
    expect(existsSync(join(dir, 'howler.config.json'))).toBe(true);
    expect(calls.some((c) => c.startsWith('ps!:'))).toBe(true);
    expect(calls).toContain(`reg+:${UNINSTALL_KEY}:Howler`);
    expect(r.serverDir).toBeNull();
    expect(Math.max(...steps)).toBe(100);
    expect(steps).toEqual([...steps].sort((a, c) => a - c));
  });

  it('actualizar no pisa la configuración existente', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    w(join(dir, 'howler.config.json'), '{"mio":true}');
    const { sys } = fakeSys(b);
    const r = await install(opts(dir, await payload(b)), sys, () => undefined);
    expect(readFileSync(join(dir, 'howler.config.json'), 'utf8')).toBe('{"mio":true}');
    expect(r.notes).toContain('config-kept');
  });

  it('modo servidor actual: migra con AssettoServer ya descomprimido e instala el plugin', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    const { server, fresh } = oldServer(b);
    const { sys } = fakeSys(b);
    const r = await install({ ...opts(dir, await payload(b)), mode: 'current', serverDir: server, assettoDir: fresh }, sys, () => undefined);
    expect(readFileSync(join(server, 'acServer.exe'), 'utf8')).toBe('EXE NUEVO');
    expect(readFileSync(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'), 'utf8')).toBe('plugin NUEVO');
    expect(r.backupDir).toContain('howler-backup');
    expect(JSON.parse(readFileSync(join(dir, 'howler.config.json'), 'utf8')).server.preset).toBe('SERVER_00');
  });

  it('servidor que ya usa AssettoServer: solo actualiza el plugin, guardando el anterior', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    const { server } = oldServer(b);
    w(join(server, 'howler-migration.json'), '{}');
    w(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'), 'plugin VIEJO');
    const { sys } = fakeSys(b);
    const r = await install({ ...opts(dir, await payload(b)), mode: 'current', serverDir: server }, sys, () => undefined);
    expect(r.notes).toContain('plugin-only');
    expect(readFileSync(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'), 'utf8')).toBe('plugin NUEVO');
    expect(readFileSync(join(r.backupDir!, 'HowlerPlugin.dll'), 'utf8')).toBe('plugin VIEJO');
    expect(readFileSync(join(server, 'acServer.exe'), 'utf8')).toBe('EXE VIEJO');
  });

  it('modo carpeta nueva: el servidor original queda intacto', async () => {
    const b = tmp(), dir = join(b, 'Howler'), copy = join(b, 'copia');
    const { server, fresh } = oldServer(b);
    const { sys } = fakeSys(b);
    const r = await install({ ...opts(dir, await payload(b)), mode: 'copy', serverDir: server, copyTo: copy, assettoDir: fresh }, sys, () => undefined);
    expect(readFileSync(join(server, 'acServer.exe'), 'utf8')).toBe('EXE VIEJO');
    expect(readFileSync(join(copy, 'acServer.exe'), 'utf8')).toBe('EXE NUEVO');
    expect(r.serverDir).toBe(copy);
  });

  it('no instala con Howler o el servidor en marcha', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    const { server } = oldServer(b);
    const p = await payload(b);
    await expect(install(opts(dir, p), fakeSys(b, ['Howler.exe']).sys, () => undefined)).rejects.toThrow('RUNNING_HOWLER');
    await expect(install({ ...opts(dir, p), mode: 'current', serverDir: server }, fakeSys(b, ['AssettoServer.exe']).sys, () => undefined)).rejects.toThrow('RUNNING_SERVER');
    expect(existsSync(join(dir, 'Howler.exe'))).toBe(false);
  });

  it('una carpeta que no es un servidor se rechaza', async () => {
    const b = tmp(), dir = join(b, 'Howler'), nope = join(b, 'nada');
    mkdirSync(nope);
    await expect(install({ ...opts(dir, await payload(b)), mode: 'current', serverDir: nope }, fakeSys(b).sys, () => undefined)).rejects.toThrow(/no es válida/);
  });

  it('si la descarga falla no queda nada a medias en el servidor', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    const { server } = oldServer(b);
    await expect(install({ ...opts(dir, await payload(b)), mode: 'current', serverDir: server }, fakeSys(b).sys, () => undefined)).rejects.toThrow('no debería descargar');
    expect(readFileSync(join(server, 'acServer.exe'), 'utf8')).toBe('EXE VIEJO');
    expect(existsSync(join(server, 'howler-migration.json'))).toBe(false);
  });

  it('desinstalar conserva los datos por defecto y quita accesos y registro', async () => {
    const b = tmp(), dir = join(b, 'Howler');
    const { sys, calls } = fakeSys(b);
    await install({ ...opts(dir, await payload(b)), autostart: true }, sys, () => undefined);
    w(join(dir, 'data', 'howler.db'), 'MIS DATOS');
    w(join(b, 'desktop', 'Howler.lnk'), 'x'); w(join(b, 'startup', 'Howler.lnk'), 'x');
    const r = await uninstall({ installDir: dir, deleteData: false, webPort: 8420 }, sys, () => undefined);
    expect(existsSync(join(dir, 'web'))).toBe(false);
    expect(existsSync(join(dir, 'data', 'howler.db'))).toBe(true);
    expect(existsSync(join(b, 'desktop', 'Howler.lnk'))).toBe(false);
    expect(existsSync(join(b, 'startup', 'Howler.lnk'))).toBe(false);
    expect(calls).toContain(`reg-:${UNINSTALL_KEY}`);
    expect(r.kept).toHaveLength(2);
    await uninstall({ installDir: dir, deleteData: true, webPort: 8420 }, sys, () => undefined);
    expect(existsSync(join(dir, 'data'))).toBe(false);
  });

  it('updatePlugin cuenta lo reemplazado y lo creado', () => {
    const b = tmp();
    w(join(b, 'p', 'a.dll'), 'n'); w(join(b, 'p', 'lua', 'x.lua'), 'n');
    w(join(b, 's', 'plugins', 'HowlerPlugin', 'a.dll'), 'v');
    const r = updatePlugin(join(b, 's'), join(b, 'p'));
    expect(r).toMatchObject({ replaced: 1, created: 1 });
  });
});
