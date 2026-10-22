import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTarGz } from '../../../server/src/core/tar';
import { dryRunSys } from './flow';
import { startSetupServer, type UiAssets } from './server';

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => { closers.splice(0).forEach((c) => c()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });

const ui: UiAssets = { 'index.html': { type: 'text/html', data: '<html>ok</html>' } };

async function boot(over: Partial<Parameters<typeof startSetupServer>[0]> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'howler-srv-'));
  dirs.push(base);
  const payload = join(base, 'p.tar.gz');
  await writeTarGz(payload, [{ name: 'Howler.exe', data: Buffer.from('EXE') }, { name: 'plugin/HowlerPlugin/HowlerPlugin.dll', data: Buffer.from('p') }]);
  const exits: number[] = [];
  const h = await startSetupServer({ kind: 'install', ui, sys: dryRunSys(base), version: '0.1.0', lang: 'es', defaultDir: join(base, 'Howler'), payload, onExit: () => exits.push(1), servers: () => [], browse: async () => null, launch: () => undefined, idleExitSeconds: 0, ...over });
  closers.push(h.close);
  const call = (path: string, body?: unknown, token = h.token, host?: string) =>
    fetch(`http://127.0.0.1:${h.port}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Setup-Token': token, 'Content-Type': 'application/json', ...(host ? { Host: host } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { h, base, call, exits };
}

describe('servidor del asistente', () => {
  it('sirve la interfaz y exige la clave en la API', async () => {
    const { h, call } = await boot();
    expect(await (await fetch(`http://127.0.0.1:${h.port}/`)).text()).toContain('ok');
    expect((await fetch(`http://127.0.0.1:${h.port}/nada`)).status).toBe(404);
    expect((await call('init', undefined, 'mala')).status).toBe(401);
    expect((await call('init')).status).toBe(200);
  });

  it('init dice si ya hay instalación y qué puerto usa', async () => {
    const { base, call } = await boot();
    mkdirSync(join(base, 'Howler'));
    writeFileSync(join(base, 'Howler', 'howler.config.json'), JSON.stringify({ serverDir: 'X:\\srv', http: { port: 9000 } }));
    const init = await (await call('init')).json();
    expect(init.existing).toMatchObject({ exists: true, serverDir: 'X:\\srv' });
    expect(init.lang).toBe('es');
  });

  it('instala en modo manual y el progreso llega a hecho', async () => {
    const { base, call } = await boot();
    const dir = join(base, 'Howler');
    expect((await call('install', { mode: 'manual', installDir: dir, firewall: false, shortcuts: false, autostart: false })).status).toBe(200);
    let job: { state: string; percent: number } = { state: 'running', percent: 0 };
    for (let i = 0; i < 50 && job.state === 'running'; i++) { await new Promise((r) => setTimeout(r, 50)); job = await (await call('progress')).json(); }
    expect(job).toMatchObject({ state: 'done', percent: 100 });
    expect(existsSync(join(dir, 'Howler.exe'))).toBe(true);
  });

  it('un error de instalación llega al asistente con su código', async () => {
    const { call } = await boot({ sys: { ...dryRunSys(tmpdir()), isRunning: async (i: string) => i === 'Howler.exe' } });
    await call('install', { mode: 'manual', installDir: join(tmpdir(), 'howler-nope') });
    let job: { state: string; error: string | null } = { state: 'running', error: null };
    for (let i = 0; i < 50 && job.state === 'running'; i++) { await new Promise((r) => setTimeout(r, 50)); job = await (await call('progress')).json(); }
    expect(job).toMatchObject({ state: 'error', error: 'RUNNING_HOWLER' });
  });

  it('comprueba carpetas de servidor y rechaza las que no lo son', async () => {
    const { base, call } = await boot();
    mkdirSync(join(base, 'vacia'));
    const r = await (await call('check', { dir: join(base, 'vacia') })).json();
    expect(r.ok).toBe(false);
  });

  it('comprueba carpetas de Assetto Corsa y enseña en «init» si AssettoServer va incluido', async () => {
    const { base, call } = await boot();
    mkdirSync(join(base, 'noac'));
    expect(await (await call('checkac', { dir: join(base, 'noac') })).json()).toMatchObject({ ok: false });
    const init = await (await call('init')).json();
    expect(init).toMatchObject({ acDirs: expect.any(Array), bundled: expect.any(Boolean) });
    expect(init).not.toHaveProperty('lan');
  });

  it('«exit» avisa a quien lo lanzó', async () => {
    const { call, exits } = await boot();
    await call('exit', {});
    await new Promise((r) => setTimeout(r, 120));
    expect(exits).toHaveLength(1);
  });

  it('desinstalar solo existe en el modo desinstalar', async () => {
    const { call } = await boot();
    expect((await call('uninstall', { deleteData: false })).status).toBe(404);
  });
});
