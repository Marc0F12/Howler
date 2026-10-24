import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCORING_PRESETS } from '@howler/shared';
import { DatabaseSync } from 'node:sqlite';
import { createImageStore } from '../core/championship-images';
import { schema, type HowlerConfig } from '../config';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { registerAdminRoutes, type AdminDeps } from './admin-routes';
import { AuthService } from './auth';
import type { PluginCommander } from './plugin-commander';
import { ServerProcess } from './server-process';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const HOST = '127.0.0.1:8421';
const H = { host: HOST, 'x-howler-admin': '1', 'content-type': 'application/json' };

class FakeChild extends EventEmitter {
  pid = 99; exitCode: number | null = null; stdout = new EventEmitter(); stderr = new EventEmitter();
}

async function setup(over: Partial<AdminDeps> = {}, online: { carId: number; driverId: number; name: string; car: string }[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'howler-routes-'));
  dirs.push(root);
  const dir = join(root, 'server'); // como en una instalación real: <AC>/server y <AC>/content
  mkdirSync(join(dir, 'presets', 'SERVER_00'), { recursive: true });
  writeFileSync(join(dir, 'acServer.exe'), 'x');
  writeFileSync(join(dir, 'presets', 'SERVER_00', 'server_cfg.ini'), '[SERVER]\r\nFUEL_RATE=100\r\nDAMAGE_MULTIPLIER=100\r\nTYRE_WEAR_RATE=100\r\n');

  let config: HowlerConfig = { ...schema.parse({ serverDir: dir, server: { exe: 'acServer.exe' } }), dataDir: dir };
  const saved: Record<string, unknown>[] = [];
  const repo = new Repository(openDatabase(':memory:'));
  const changed = vi.fn();
  const exec = vi.fn(async (_cmd: string) => ({ ok: true, reply: 'hecho' }));
  const commander = { exec, requestStop: vi.fn(async () => true), enabled: true } as unknown as PluginCommander;
  const child = new FakeChild();
  const serverProcess = new ServerProcess({ serverDir: dir, exe: 'acServer.exe', preset: 'SERVER_00', spawnFn: vi.fn(() => child) as never, sleep: async () => {}, requestStop: async () => { setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 1); return true; } });
  const app = Fastify();
  registerAdminRoutes(app, {
    getConfig: () => config,
    saveConfig: (patch) => { saved.push(patch); config = { ...config, ...(patch as object) } as HowlerConfig; },
    repo,
    saveLapRules: (cfg) => { config = { ...config, lapRules: cfg } as HowlerConfig; },
    saveWorldMap: (cfg) => { config = { ...config, worldMap: cfg } as HowlerConfig; },
    saveAppearance: (a) => { config = { ...config, appearance: a } as HowlerConfig; },
    onLapsChanged: changed,
    process: serverProcess,
    commander,
    online: () => online,
    pluginAlive: () => true,
    externalServerRunning: async () => false,
    allowedHosts: [HOST, 'localhost:8421'],
    ...over,
  });
  await app.ready();
  return { app, exec, saved, serverProcess, dir, child, commander, repo, changed, get config() { return config; } };
}

const post = (app: Awaited<ReturnType<typeof setup>>['app'], url: string, payload: unknown, headers: Record<string, string> = H) =>
  app.inject({ method: 'POST', url, headers, payload: JSON.stringify(payload) });

describe('mapa del mundo', () => {
  it('guarda las ubicaciones a mano y rechaza coordenadas imposibles', async () => {
    const ctx = await setup();
    const { app } = ctx;
    const ok = await app.inject({ method: 'PUT', url: '/admin/api/world-map', headers: H, payload: JSON.stringify({ online: true, manual: { 'monza|': { lat: 45.6, lon: 9.29 } } }) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().online).toBe(true);
    expect(ctx.config.worldMap.manual['monza|']).toEqual({ lat: 45.6, lon: 9.29 });
    const bad = await app.inject({ method: 'PUT', url: '/admin/api/world-map', headers: H, payload: JSON.stringify({ online: false, manual: { x: { lat: 120, lon: 0 } } }) });
    expect(bad.statusCode).toBe(400);
  });
});

describe('apariencia', () => {
  it('guarda la disposición limpia y la devuelve', async () => {
    const { app, config } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/admin/api/appearance', headers: H, payload: JSON.stringify({ layouts: { home: [{ id: 'podium', size: 'half' }, { id: 'inventado' }], nada: [] } }) });
    expect(put.statusCode).toBe(200);
    expect(put.json().layouts).toEqual({ home: [{ id: 'podium', size: 'half' }] });
    expect((await app.inject({ method: 'GET', url: '/admin/api/appearance', headers: H })).json().layouts.home).toHaveLength(1);
    // idioma, hora y medidas: se guardan aparte y una orden sin ellos los conserva
    const disp = await app.inject({ method: 'PUT', url: '/admin/api/appearance', headers: H, payload: JSON.stringify({ layouts: {}, display: { lang: 'en', clock: '12h', dateOrder: 'mdy', units: 'imperial' } }) });
    expect(disp.json().display).toEqual({ lang: 'en', clock: '12h', dateOrder: 'mdy', units: 'imperial' });
    const again = await app.inject({ method: 'PUT', url: '/admin/api/appearance', headers: H, payload: JSON.stringify({ layouts: {} }) });
    expect(again.json().display.units).toBe('imperial');
    void config;
  });
  it('exige la cabecera del panel para cambiarla', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'PUT', url: '/admin/api/appearance', headers: { host: HOST, 'content-type': 'application/json' }, payload: '{}' });
    expect(r.statusCode).toBe(403);
  });
});

describe('seguridad del panel', () => {
  it('rechaza un Host que no sea el local (anti DNS-rebinding)', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/admin/api/ping', headers: { host: 'evil.example.com' } });
    expect(r.statusCode).toBe(403);
  });

  it('rechaza peticiones que vienen de otra página web', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/admin/api/state', headers: { host: HOST, origin: 'http://evil.example.com' } });
    expect(r.statusCode).toBe(403);
  });

  it('las órdenes (POST) exigen la cabecera del panel', async () => {
    const { app, exec } = await setup();
    const r = await post(app, '/admin/api/control/time', { time: '12:00' }, { host: HOST, 'content-type': 'application/json' });
    expect(r.statusCode).toBe(403);
    expect(exec).not.toHaveBeenCalled();
  });

  it('acepta el Host local y su propio origen', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/admin/api/ping', headers: { host: HOST, origin: `http://${HOST}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/admin/api/ping', headers: { host: 'localhost:8421' } })).json()).toMatchObject({ admin: true });
  });
});

describe('estado y ajustes', () => {
  it('el estado resume servidor, plugin, comprobación de la carpeta y ajustes', async () => {
    const { app } = await setup({}, [{ carId: 1, driverId: 5, name: 'Marc', car: 'x' }]);
    const s = (await app.inject({ method: 'GET', url: '/admin/api/state', headers: { host: HOST } })).json();
    expect(s.server.state).toBe('stopped');
    expect(s.pluginAlive).toBe(true);
    expect(s.check).toMatchObject({ ok: true, presets: ['SERVER_00'] });
    expect(s.online).toHaveLength(1);
    expect(s.settings.http.port).toBe(8420);
    expect(s.settings.server.preset).toBe('SERVER_00');
  });

  it('guarda ajustes válidos y avisa de lo que necesita reiniciar Howler', async () => {
    const { app, saved } = await setup();
    const r = await post(app, '/admin/api/settings', { server: { preset: 'SERVER_01', stopWarningSeconds: 20 }, http: { port: 9000 } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, restartRequired: ['http.port'] });
    expect(saved).toEqual([{ server: { preset: 'SERVER_01', stopWarningSeconds: 20 }, http: { port: 9000 } }]);
  });

  it('rechaza ajustes no válidos o no permitidos desde el panel', async () => {
    const { app, saved } = await setup();
    expect((await post(app, '/admin/api/settings', { http: { port: 80 } })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/settings', { server: { exe: '..\\..\\cmd.exe' } })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/settings', { dataDir: 'C:\\otra' })).statusCode).toBe(400); // clave no permitida
    expect((await post(app, '/admin/api/settings', { acsp: { pluginHost: '10.0.0.5' } })).statusCode).toBe(400);
    expect(saved).toEqual([]);
  });
});

describe('control en directo', () => {
  it('traduce cada orden al comando del servidor', async () => {
    const { app, exec } = await setup();
    await post(app, '/admin/api/control/time', { time: '15:30' });
    await post(app, '/admin/api/control/weather', { type: 'LightRain', durationSeconds: 60 });
    await post(app, '/admin/api/control/kick', { carId: 3 });
    await post(app, '/admin/api/control/ballast', { carId: 2, kg: 40 });
    await post(app, '/admin/api/control/session', { action: 'next' });
    await post(app, '/admin/api/control/say', { message: 'Hola a todos' });
    expect(exec.mock.calls.map((c) => c[0])).toEqual(['/settime 15:30', '/setcspweather LightRain 60', '/kick_id 3', '/ballast 2 40', '/next_session', '/say Hola a todos']);
  });

  it('no manda nada al servidor si la orden no es válida', async () => {
    const { app, exec } = await setup();
    expect((await post(app, '/admin/api/control/time', { time: '99:99' })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/control/kick', { carId: -5 })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/control/weather', { type: 'Rain; /exception' })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/control/say', {})).statusCode).toBe(400);
    expect(exec).not.toHaveBeenCalled();
  });

  it('si el plugin no responde, lo dice con un 502', async () => {
    const { app, exec } = await setup();
    exec.mockResolvedValueOnce({ ok: false, reply: 'El plugin de Howler no responde.' });
    const r = await post(app, '/admin/api/control/time', { time: '10:00' });
    expect(r.statusCode).toBe(502);
    expect(r.json().reply).toMatch(/no responde/);
  });
});

describe('servidor de AC', () => {
  it('arranca el servidor con el preset configurado', async () => {
    const { app, serverProcess } = await setup();
    expect((await post(app, '/admin/api/server/start', {})).statusCode).toBe(200);
    expect(serverProcess.snapshot().state).toBe('starting');
  });

  it('no arranca si ya hay otro servidor en marcha fuera de Howler', async () => {
    const { app, serverProcess } = await setup({ externalServerRunning: async () => true });
    const r = await post(app, '/admin/api/server/start', {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/Content Manager/);
    expect(serverProcess.snapshot().state).toBe('stopped');
  });

  it('si el servidor lo arrancó Howler, un segundo «Arrancar» no lo toma por uno externo', async () => {
    let external = false;
    const { app, serverProcess } = await setup({ externalServerRunning: async () => external });
    await post(app, '/admin/api/server/start', {});
    external = true; // el sistema ve el proceso, pero es el de Howler
    const r = await post(app, '/admin/api/server/start', {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error).not.toMatch(/Content Manager/);
    expect(serverProcess.snapshot().state).toBe('starting');
  });

  it('parar con jugadores avisa por el chat; sin jugadores no espera ni avisa', async () => {
    const withPlayers = await setup({}, [{ carId: 0, driverId: 1, name: 'A', car: 'x' }]);
    await post(withPlayers.app, '/admin/api/server/start', {});
    const r = await post(withPlayers.app, '/admin/api/server/stop', {});
    expect(r.statusCode).toBe(202);
    await vi.waitFor(() => expect(withPlayers.serverProcess.snapshot().state).toBe('stopped'));
    expect(withPlayers.exec.mock.calls.map((c) => c[0])).toEqual(['/say El servidor se parará en 10 segundos.']);

    const alone = await setup();
    await post(alone.app, '/admin/api/server/start', {});
    await post(alone.app, '/admin/api/server/stop', {});
    await vi.waitFor(() => expect(alone.serverProcess.snapshot().state).toBe('stopped'));
    expect(alone.exec).not.toHaveBeenCalled();
  });
});

describe('hora y climas', () => {
  it('lee la hora actual del servidor', async () => {
    const { app, exec } = await setup();
    exec.mockResolvedValueOnce({ ok: true, reply: 'It is currently 7:05.' });
    expect((await app.inject({ method: 'GET', url: '/admin/api/control/time', headers: { host: HOST } })).json()).toEqual({ time: '07:05' });
    exec.mockResolvedValueOnce({ ok: false, reply: 'no responde' });
    expect((await app.inject({ method: 'GET', url: '/admin/api/control/time', headers: { host: HOST } })).json()).toEqual({ time: null });
  });

  it('cambia de clima por su posición en la lista del preset', async () => {
    const { app, exec } = await setup();
    await post(app, '/admin/api/control/weather-id', { id: 2 });
    expect(exec).toHaveBeenCalledWith('/setweather 2');
    expect((await post(app, '/admin/api/control/weather-id', { id: -1 })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/control/weather-id', { id: 1.5 })).statusCode).toBe(400);
  });

  it('enseña los sistemas instalados y la lista del preset, y permite cambiar la lista', async () => {
    const { app, dir } = await setup();
    for (const w of ['3_clear', '6_mid_clouds', 'sol_01_clear', 'sol_35_rain']) mkdirSync(join(dir, '..', 'content', 'weather', w), { recursive: true });
    writeFileSync(join(dir, 'presets', 'SERVER_00', 'server_cfg.ini'), '[SERVER]\r\nNAME=x\r\n\r\n[WEATHER_0]\r\nGRAPHICS=6_mid_clouds\r\nBASE_TEMPERATURE_AMBIENT=15\r\nBASE_TEMPERATURE_ROAD=2\r\n');
    writeFileSync(join(dir, 'presets', 'SERVER_00', 'extra_cfg.yml'), 'EnableWeatherFx: false\n');
    const s = (await app.inject({ method: 'GET', url: '/admin/api/weather', headers: { host: HOST } })).json();
    expect(s.fx).toBe(false);
    expect(s.systems.map((x: { id: string }) => x.id)).toEqual(['default', 'sol']);
    expect(s.list).toHaveLength(1);

    const r = await post(app, '/admin/api/weather/list', { graphics: ['sol_01_clear', '6_mid_clouds', 'sol_35_rain'] });
    expect(r.statusCode).toBe(200);
    expect(r.json().list.map((e: { graphics: string }) => e.graphics)).toEqual(['sol_01_clear', '6_mid_clouds', 'sol_35_rain']);
    expect((await post(app, '/admin/api/weather/list', { graphics: ['no_instalado'] })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/weather/list', { graphics: [] })).statusCode).toBe(400);
  });
});

describe('ajustes de sesión (entre sesiones)', () => {
  it('lee y cambia combustible, daños y desgaste', async () => {
    const { app, dir } = await setup();
    expect((await app.inject({ method: 'GET', url: '/admin/api/session-settings', headers: { host: HOST } })).json()).toEqual({ fuelRate: 100, damageMultiplier: 100, tyreWearRate: 100 });
    const r = await post(app, '/admin/api/session-settings', { damageMultiplier: 50, tyreWearRate: 150 });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toEqual({ fuelRate: 100, damageMultiplier: 50, tyreWearRate: 150 });
    expect(readFileSync(join(dir, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8')).toContain('DAMAGE_MULTIPLIER=50\r\n');
  });

  it('rechaza valores fuera de rango sin tocar el archivo', async () => {
    const { app, dir } = await setup();
    const before = readFileSync(join(dir, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8');
    expect((await post(app, '/admin/api/session-settings', { damageMultiplier: 5000 })).statusCode).toBe(400);
    expect(readFileSync(join(dir, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8')).toBe(before);
  });

  it('"aplicar y reiniciar" reinicia el servidor si estaba en marcha', async () => {
    const { app, serverProcess } = await setup();
    await post(app, '/admin/api/server/start', {});
    const r = await post(app, '/admin/api/session-settings', { fuelRate: 50, applyAndRestart: true });
    expect(r.json().restarting).toBe(true);
    await vi.waitFor(() => expect(serverProcess.snapshot().state).toBe('starting')); // volvió a arrancar tras parar
  });
});

describe('reglas de vuelta válida', () => {
  /** Una vuelta con un choque de 40 km/h contra el entorno: válida con «solo cortes», anulada con «estricto». */
  function addLap(repo: Repository, o: { cuts?: number } = {}) {
    const session = repo.createSession({ track: 'monza', layout: '', name: 'P', type: 1 });
    const driverId = repo.upsertDriver('7656119000000001', 'Ana');
    return repo.insertLap(
      { sessionId: session.id, driverId, track: 'monza', layout: '', car: 'mx5', lapMs: 100_000, sectorsMs: [], cuts: o.cuts ?? 0, grip: 1, valid: (o.cuts ?? 0) === 0, invalidReason: null },
      [{ kind: 'env', speed: 40, otherDriverId: null }],
    );
  }
  const strictConfig = { default: 'estricto', profiles: {}, tracks: {} };

  it('GET devuelve la configuración y los perfiles predefinidos', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: '/admin/api/lap-rules', headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.json().config.default).toBe('cortes');
    expect(Object.keys(r.json().builtins)).toEqual(['cortes', 'estandar', 'estricto']);
  });

  it('probar no cambia nada y dice cuántas vueltas cambiarían; aplicar sí las cambia y avisa a la web', async () => {
    const { app, repo, changed } = await setup();
    const id = addLap(repo);
    const preview = await post(app, '/admin/api/lap-rules/preview', { config: strictConfig });
    expect(preview.json()).toMatchObject({ applied: false, total: 1, toInvalid: 1 });
    expect(repo.lapAdmin.get(id)!.valid).toBe(true);

    expect((await post(app, '/admin/api/lap-rules', strictConfig)).statusCode).toBe(200);
    const applied = await post(app, '/admin/api/lap-rules/apply', {});
    expect(applied.json()).toMatchObject({ applied: true, toInvalid: 1 });
    expect(repo.lapAdmin.get(id)!.valid).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it('rechaza reglas inválidas o perfiles que no existen, sin guardar nada', async () => {
    const { app } = await setup();
    expect((await post(app, '/admin/api/lap-rules', { default: 'inventado', profiles: {}, tracks: {} })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/lap-rules', { default: 'cortes', profiles: {}, tracks: { monza: 'nope' } })).statusCode).toBe(400);
    const bad = { default: 'x', profiles: { x: { name: 'x', rules: { maxCuts: -1, carCollisions: { mode: 'ignore', minSpeedKmh: 0 }, envCollisions: { mode: 'ignore', minSpeedKmh: 0 }, minLapMs: 0, notifyDriver: false } } }, tracks: {} };
    expect((await post(app, '/admin/api/lap-rules', bad)).statusCode).toBe(400);
  });

  it('anular, restaurar y devolver a las reglas una vuelta a mano', async () => {
    const { app, repo } = await setup();
    const id = addLap(repo);
    const voided = await post(app, `/admin/api/laps/${id}/void`, { note: 'atajo' });
    expect(voided.json()).toMatchObject({ ok: true, valid: false, reason: 'Anulada por el administrador: atajo' });
    expect(repo.lapAdmin.get(id)!.override).toBe('void');
    expect((await post(app, `/admin/api/laps/${id}/reset`, {})).json()).toMatchObject({ valid: true });
    expect(repo.lapAdmin.get(id)!.override).toBeNull();
    expect((await post(app, '/admin/api/laps/9999/void', {})).statusCode).toBe(404);
    expect((await post(app, `/admin/api/laps/${id}/inventar`, {})).statusCode).toBe(400);
  });

  it('la lista de vueltas recientes trae el estado de cada una', async () => {
    const { app, repo } = await setup();
    addLap(repo, { cuts: 1 });
    const r = await app.inject({ method: 'GET', url: '/admin/api/laps?limit=5', headers: H });
    expect(r.json()[0]).toMatchObject({ driverName: 'Ana', track: 'monza', valid: false, cuts: 1, collisions: 1, override: null });
  });

  it('las órdenes de reglas exigen la cabecera del panel', async () => {
    const { app } = await setup();
    expect((await post(app, '/admin/api/lap-rules/apply', {}, { host: HOST, 'content-type': 'application/json' })).statusCode).toBe(403);
  });
});

describe('campeonatos (panel)', () => {
  const scoring = SCORING_PRESETS.f1!.config;
  const payload = (driverId: number) => ({
    name: 'Copa', format: 'individual', status: 'active', scoring, teams: [], entries: [{ driverId, teamKey: null }],
    rounds: [{ track: 'monza', raceAt: '2026-10-24T21:45:00Z', mods: [{ name: 'MX-5', kind: 'car', url: 'https://example.com/mx5' }] }],
  });

  it('crea, lista, edita, cambia el estado y borra', async () => {
    const { app, repo } = await setup();
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const created = await post(app, '/admin/api/championships', payload(ana));
    expect(created.statusCode).toBe(200);
    const { id } = created.json();
    expect((await app.inject({ method: 'GET', url: '/admin/api/championships', headers: H })).json()[0]).toMatchObject({ id, name: 'Copa', rounds: 1, participants: 1 });
    const edit = await app.inject({ method: 'PUT', url: `/admin/api/championships/${id}`, headers: H, payload: JSON.stringify({ ...payload(ana), name: 'Copa 2' }) });
    expect(edit.body).toContain('id');
    expect(edit.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/admin/api/championships/${id}`, headers: H })).json()).toMatchObject({ name: 'Copa 2' });
    expect((await post(app, `/admin/api/championships/${id}/status`, { status: 'finished' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/admin/api/championships/${id}`, headers: H, payload: '{}' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/admin/api/championships/${id}`, headers: H })).statusCode).toBe(404);
  });

  it('rechaza enlaces que no sean http(s), colores mal escritos y órdenes sin la cabecera del panel', async () => {
    const { app, repo } = await setup();
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const bad = payload(ana);
    bad.rounds[0]!.mods[0]!.url = 'javascript:alert(1)';
    expect((await post(app, '/admin/api/championships', bad)).statusCode).toBe(400);
    expect((await post(app, '/admin/api/championships', { ...payload(ana), teams: [{ key: 'a', name: 'A', color: 'rojo' }] })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/championships', payload(ana), { host: HOST, 'content-type': 'application/json' })).statusCode).toBe(403);
  });

  it('asigna una sesión a una carrera, anota un ajuste y lo borra', async () => {
    const { app, repo } = await setup();
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const id = (await post(app, '/admin/api/championships', payload(ana))).json().id;
    const s = repo.createSession({ track: 'monza', layout: '', name: 'R', type: 3 });
    repo.insertLap({ sessionId: s.id, driverId: ana, track: 'monza', layout: '', car: 'mx5', lapMs: 90_000, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    const c = (await app.inject({ method: 'GET', url: `/admin/api/championships/${id}`, headers: H })).json();
    const round = c.roundList[0].id;
    expect(c.roundList[0].raceSessionId).toBe(s.id); // activo: se asignó sola
    const adj = await post(app, `/admin/api/championships/${id}/adjustments`, { roundId: round, driverId: ana, points: -5, reason: 'Choque' });
    expect(adj.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: `/admin/api/championships/${id}`, headers: H })).json();
    expect(after.standings.drivers[0].total).toBe(21); // 25 + 1 de vuelta rápida - 5
    expect((await app.inject({ method: 'DELETE', url: `/admin/api/championships/${id}/adjustments/${adj.json().id}`, headers: H, payload: '{}' })).statusCode).toBe(200);
    expect((await post(app, `/admin/api/championships/${id}/assign`, { roundId: round, kind: 'quali', sessionId: s.id })).statusCode).toBe(400); // no es una clasificación
  });

  it('el SteamID no sale en ninguna respuesta de campeonatos', async () => {
    const { app, repo } = await setup();
    const ana = repo.upsertDriver('76561190000000042', 'Ana');
    const id = (await post(app, '/admin/api/championships', payload(ana))).json().id;
    const txt = (await app.inject({ method: 'GET', url: `/admin/api/championships/${id}`, headers: H })).body;
    expect(txt).not.toContain('76561190000000042');
  });
});

describe('imagen de campeonato (subida)', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const up = (app: Awaited<ReturnType<typeof setup>>['app'], body: Buffer | string, type = 'image/png', headers: Record<string, string> = H) =>
    app.inject({ method: 'POST', url: '/admin/api/championship-image', headers: { ...headers, 'content-type': type }, payload: body });
  const withStore = async () => {
    const root = mkdtempSync(join(tmpdir(), 'howler-champimg-'));
    dirs.push(root);
    return setup({ images: createImageStore(join(root, 'img')) });
  };

  it('sube una imagen, devuelve su ruta y se puede usar en un campeonato', async () => {
    const { app, repo } = await withStore();
    const r = await up(app, PNG);
    expect(r.statusCode).toBe(200);
    const { imageUrl } = r.json();
    expect(imageUrl).toMatch(/^\/api\/championship-images\/[0-9a-f]{32}\.png$/);
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const c = await post(app, '/admin/api/championships', { name: 'Copa', format: 'individual', scoring: SCORING_PRESETS.f1!.config, teams: [], entries: [{ driverId: ana, teamKey: null }], rounds: [{ track: 'monza' }], imageUrl });
    expect(c.statusCode).toBe(200);
    expect(repo.championships.imageRefs()).toEqual([imageUrl]);
  });

  it('rechaza lo que no es una imagen aunque el navegador diga que lo es, y exige la cabecera del panel', async () => {
    const { app } = await withStore();
    expect((await up(app, '<svg onload=alert(1)></svg>')).statusCode).toBe(400);
    expect((await up(app, PNG, 'image/png', { host: HOST })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/api/championship-image', headers: { ...H, 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(400);
  });

  it('un campeonato no acepta una ruta de imagen inventada', async () => {
    const { app, repo } = await withStore();
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const base = { name: 'Copa', format: 'individual', scoring: SCORING_PRESETS.f1!.config, teams: [], entries: [{ driverId: ana, teamKey: null }], rounds: [{ track: 'monza' }] };
    expect((await post(app, '/admin/api/championships', { ...base, imageUrl: '/api/championship-images/../../etc/passwd' })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/championships', { ...base, imageUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
  });
});

describe('importar de stracker (panel)', () => {
  function tinyStracker() {
    const dir = mkdtempSync(join(tmpdir(), 'howler-strk-'));
    dirs.push(dir);
    const path = join(dir, 's.db3');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE Players (PlayerId INTEGER PRIMARY KEY, SteamGuid TEXT, Name TEXT); CREATE TABLE Tracks (TrackId INTEGER PRIMARY KEY, Track TEXT); CREATE TABLE Cars (CarId INTEGER PRIMARY KEY, Car TEXT);
      CREATE TABLE Session (SessionId INTEGER PRIMARY KEY, TrackId INTEGER, SessionType TEXT, StartTimeDate INTEGER, EndTimeDate INTEGER);
      CREATE TABLE PlayerInSession (PlayerInSessionId INTEGER PRIMARY KEY, SessionId INTEGER, PlayerId INTEGER, CarId INTEGER);
      CREATE TABLE Lap (LapId INTEGER PRIMARY KEY, PlayerInSessionId INTEGER, LapCount INTEGER, LapTime INTEGER, Valid INTEGER, Cuts INTEGER, CollisionsCar INTEGER, CollisionsEnv INTEGER, MaxSpeed_KMH REAL, GripLevel REAL, Timestamp INTEGER);
      INSERT INTO Players VALUES (1, 'sha256:zzzz', 'Ana'); INSERT INTO Tracks VALUES (1, 'csp/0/../monza'); INSERT INTO Cars VALUES (1, 'mx5');
      INSERT INTO Session VALUES (1, 1, 'Practice', 1767285783, 1767286707); INSERT INTO PlayerInSession VALUES (1, 1, 1, 1);
      INSERT INTO Lap VALUES (1, 1, 2, 100000, 1, 0, 0, 0, 200, 1, 1767285900), (2, 1, 3, 99000, 1, 0, 0, 0, 200, 1, 1767286000);
    `);
    db.close();
    return readFileSync(path);
  }
  const withImports = async () => {
    const root = mkdtempSync(join(tmpdir(), 'howler-imp-'));
    dirs.push(root);
    return setup({ importsDir: join(root, 'imports') });
  };
  const upload = (app: Awaited<ReturnType<typeof setup>>['app'], body: Buffer | string, headers: Record<string, string> = H) =>
    app.inject({ method: 'POST', url: '/admin/api/import/stracker/upload', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: body });

  /** Lanza la importación y espera a que el trabajo en segundo plano termine; devuelve su estado final. */
  async function applyAndWait(app: Awaited<ReturnType<typeof setup>>['app'], body: unknown) {
    const start = await post(app, '/admin/api/import/stracker/apply', body);
    expect(start.statusCode).toBe(200);
    const { jobId } = start.json();
    for (let i = 0; i < 200; i++) {
      const j = (await app.inject({ method: 'GET', url: `/admin/api/import/stracker/jobs/${jobId}`, headers: H })).json();
      if (j.state !== 'running') return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('la importación no terminó');
  }

  it('sube un archivo, enseña el resumen sin el hash de Steam, e importa enlazando al piloto elegido', async () => {
    const { app, repo } = await withImports();
    const mine = repo.upsertDriver('7656119000000009', 'Ana Real');
    const up = await upload(app, tinyStracker());
    expect(up.statusCode).toBe(200);
    const prev = up.json();
    expect(prev).toMatchObject({ sessions: 1, laps: 2, players: [{ name: 'Ana', laps: 2, suggestedDriverId: null }] });
    expect(up.body).not.toContain('sha256');
    const done = await applyAndWait(app, { uploadId: prev.uploadId, players: { '1': { mode: 'link', driverId: mine } }, tracks: {}, championships: false });
    expect(done).toMatchObject({ state: 'done', done: 1, total: 1, report: { sessionsImported: 1, laps: 2, driversLinked: 1 } });
    expect(repo.profiles.driverProfile(mine)!.totals.laps).toBe(2);
    // el archivo temporal se borró: no se puede aplicar dos veces
    expect((await post(app, '/admin/api/import/stracker/apply', { uploadId: prev.uploadId, players: {}, tracks: {}, championships: false })).statusCode).toBe(404);
  });

  it('rechaza lo que no es de stracker, exige la cabecera del panel y valida lo que llega', async () => {
    const { app } = await withImports();
    expect((await upload(app, 'esto no es sqlite')).statusCode).toBe(400);
    expect((await upload(app, tinyStracker(), { host: HOST })).statusCode).toBe(403);
    expect((await post(app, '/admin/api/import/stracker/apply', { uploadId: '../../etc/passwd', players: {}, tracks: {}, championships: false })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/import/stracker/apply', { uploadId: 'a'.repeat(32), players: { x: { mode: 'new' } }, tracks: {}, championships: false })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/admin/api/import/stracker/${'b'.repeat(32)}`, headers: H, payload: '{}' })).statusCode).toBe(200);
  });

  it('lista los pilotos importados y los une con uno real', async () => {
    const { app, repo } = await withImports();
    const prev = (await upload(app, tinyStracker())).json();
    await applyAndWait(app, { uploadId: prev.uploadId, players: {}, tracks: {}, championships: false });
    const real = repo.upsertDriver('7656119000000009', 'Ana Real');
    const list = (await app.inject({ method: 'GET', url: '/admin/api/import/drivers', headers: H })).json();
    expect(list.imported).toEqual([{ id: expect.any(Number), name: 'Ana', laps: 2 }]);
    expect((await post(app, '/admin/api/import/merge', { fromId: real, intoId: list.imported[0].id })).statusCode).toBe(400); // el real no se puede unir
    expect((await post(app, '/admin/api/import/merge', { fromId: list.imported[0].id, intoId: real })).statusCode).toBe(200);
    expect(repo.profiles.driverProfile(real)!.totals.laps).toBe(2);
  });
});

describe('penalizaciones (panel)', () => {
  function raceWith(repo: Repository) {
    const ana = repo.upsertDriver('7656119000000001', 'Ana');
    const s = repo.createSession({ track: 'monza', layout: '', name: 'R', type: 3 });
    repo.insertLap({ sessionId: s.id, driverId: ana, track: 'monza', layout: '', car: 'mx5', lapMs: 90_000, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    return { ana, sid: s.id };
  }

  it('pone un aviso, +segundos y una descalificación, los lista y los quita; los segundos exigen un valor', async () => {
    const { app, repo } = await setup();
    const { ana, sid } = raceWith(repo);
    expect((await post(app, '/admin/api/penalties', { sessionId: sid, driverId: ana, kind: 'time', reason: 'x' })).statusCode).toBe(400);
    const t = await post(app, '/admin/api/penalties', { sessionId: sid, driverId: ana, kind: 'time', seconds: 5, reason: 'Salida en falso' });
    expect(t.statusCode).toBe(200);
    await post(app, '/admin/api/penalties', { sessionId: sid, driverId: ana, kind: 'warning', reason: 'Ojo' });
    const list = (await app.inject({ method: 'GET', url: `/admin/api/penalties?sessionId=${sid}`, headers: H })).json();
    expect(list.map((p: any) => [p.kind, p.seconds, p.driverName])).toEqual([['time', 5, 'Ana'], ['warning', null, 'Ana']]);
    expect((await app.inject({ method: 'DELETE', url: `/admin/api/penalties/${t.json().id}`, headers: H, payload: '{}' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/admin/api/penalties/999', headers: H, payload: '{}' })).statusCode).toBe(404);
    expect((await post(app, '/admin/api/penalties', { sessionId: 999, driverId: ana, kind: 'dsq', reason: '' })).statusCode).toBe(400);
  });

  it('avisa por el chat del servidor solo si se pide', async () => {
    const { app, repo, exec } = await setup();
    const { ana, sid } = raceWith(repo);
    await post(app, '/admin/api/penalties', { sessionId: sid, driverId: ana, kind: 'time', seconds: 5, reason: 'Choque', announce: false });
    expect(exec).not.toHaveBeenCalled();
    await post(app, '/admin/api/penalties', { sessionId: sid, driverId: ana, kind: 'time', seconds: 5, reason: 'Choque', announce: true });
    expect(exec).toHaveBeenCalledWith('/say Howler: Ana, +5 s. Choque');
  });

  it('guarda y lee las reglas automáticas, y rechaza valores absurdos', async () => {
    const { app, saved } = await setup();
    expect((await app.inject({ method: 'GET', url: '/admin/api/race-penalties', headers: H })).json()).toEqual({ cutSeconds: 0, carHitSeconds: 0, carHitMinKmh: 0, envHitSeconds: 0, envHitMinKmh: 0 });
    const r = await post(app, '/admin/api/race-penalties', { cutSeconds: 5, carHitSeconds: 10, carHitMinKmh: 20, envHitSeconds: 0, envHitMinKmh: 0 });
    expect(r.statusCode).toBe(200);
    expect(saved.at(-1)).toEqual({ racePenalties: { cutSeconds: 5, carHitSeconds: 10, carHitMinKmh: 20, envHitSeconds: 0, envHitMinKmh: 0 } });
    expect((await post(app, '/admin/api/race-penalties', { cutSeconds: -1 })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/race-penalties', { cutSeconds: 99999 })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/race-penalties', { cutSeconds: 5 }, { host: HOST, 'content-type': 'application/json' })).statusCode).toBe(403);
  });

  it('avisos de récords en el chat: todo apagado por defecto y se guarda lo elegido', async () => {
    const { app, saved } = await setup();
    expect((await app.inject({ method: 'GET', url: '/admin/api/record-announce', headers: H })).json()).toEqual({ session: false, combo: false, global: false, messages: { session: '', combo: '', global: '' } });
    expect((await post(app, '/admin/api/record-announce', { session: true, combo: false, global: true, messages: { combo: '{piloto} gana' } })).statusCode).toBe(200);
    expect(saved.at(-1)).toEqual({ recordAnnounce: { session: true, combo: false, global: true, messages: { session: '', combo: '{piloto} gana', global: '' } } });
    expect((await post(app, '/admin/api/record-announce', { messages: { combo: 'x'.repeat(151) } })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/record-announce', { session: 'si' })).statusCode).toBe(400);
  });

  it('Discord: solo acepta webhooks de Discord, nunca devuelve el enlace entero y guarda cada aviso por separado', async () => {
    const { app, saved } = await setup();
    expect((await app.inject({ method: 'GET', url: '/admin/api/discord', headers: H })).json()).toMatchObject({ configured: false, events: {} });
    expect((await post(app, '/admin/api/discord', { webhookUrl: 'https://evil.com/api/webhooks/1/x' })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/discord', { publicUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await post(app, '/admin/api/discord', { events: { inventado: { enabled: true } } })).statusCode).toBe(400);
    const ok = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABCDEF';
    const r = await post(app, '/admin/api/discord', { webhookUrl: ok, events: { driverJoin: { enabled: true, message: '{piloto} entra' } } });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toContain('abcdefghij');
    expect(saved.at(-1)).toEqual({ discord: { webhookUrl: ok, events: { driverJoin: { enabled: true, message: '{piloto} entra' } } } });
    expect((await post(app, '/admin/api/discord/test', {})).statusCode).toBe(400); // sin webhook guardado en la prueba
  });

  it('lista las sesiones recientes con sus pilotos', async () => {
    const { app, repo } = await setup();
    const { sid } = raceWith(repo);
    const s = (await app.inject({ method: 'GET', url: '/admin/api/penalties/sessions', headers: H })).json();
    expect(s[0]).toMatchObject({ id: sid, type: 3, drivers: [{ name: 'Ana', laps: 1 }] });
  });
});

describe('cuentas y acceso remoto', () => {
  const PW = 'una-contraseña-larga';
  type App = Awaited<ReturnType<typeof setup>>['app'];
  const make = async (remote: boolean) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'howler-auth-'));
    dirs.push(dataDir);
    const auth = new AuthService({ dataDir, remoteEnabled: () => remote });
    const s = await setup({ auth });
    return { ...s, auth };
  };
  const local = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: H, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
  const remoteReq = (app: App, method: 'GET' | 'POST', url: string, opts: { payload?: unknown; cookie?: string; ip?: string; headers?: Record<string, string> } = {}) =>
    app.inject({
      method, url, remoteAddress: opts.ip ?? '203.0.113.7',
      headers: { host: 'panel.example.com', 'x-howler-admin': '1', 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
      ...(opts.payload === undefined ? {} : { payload: JSON.stringify(opts.payload) }),
    });
  const login = async (app: App, name: string, password = PW) => {
    const r = await remoteReq(app, 'POST', '/admin/api/login', { payload: { name, password } });
    return { r, cookie: String(r.headers['set-cookie'] ?? '').split(';')[0]! };
  };

  it('desde el propio PC sigue sin contraseña y se crean cuentas desde ahí', async () => {
    const { app } = await make(false);
    expect((await local(app, 'GET', '/admin/api/ping')).json()).toMatchObject({ admin: true, local: true, role: 'admin' });
    const c = await local(app, 'POST', '/admin/api/accounts', { name: 'marc', password: PW, role: 'admin' });
    expect(c.statusCode).toBe(200);
    expect(c.json().accounts).toHaveLength(1);
    expect(JSON.stringify(c.json())).not.toMatch(/hash|salt|password/i);
    expect((await local(app, 'POST', '/admin/api/accounts', { name: 'MARC', password: PW, role: 'viewer' })).statusCode).toBe(400);
    expect((await local(app, 'POST', '/admin/api/accounts', { name: 'ana', password: 'corta', role: 'viewer' })).statusCode).toBe(400);
  });

  it('con el acceso remoto apagado, desde fuera o con cabeceras de túnel no se entra', async () => {
    const { app, auth } = await make(false);
    await auth.create({ name: 'marc', password: PW, role: 'admin' });
    expect((await remoteReq(app, 'GET', '/admin/api/state')).statusCode).toBe(403);
    // un túnel local llega desde 127.0.0.1 pero con la cabecera del proxy: no cuenta como el propio PC
    expect((await remoteReq(app, 'GET', '/admin/api/state', { ip: '127.0.0.1', headers: { host: '127.0.0.1:8421', 'cf-connecting-ip': '198.51.100.9' } })).statusCode).toBe(403);
    expect((await remoteReq(app, 'POST', '/admin/api/login', { payload: { name: 'marc', password: PW } })).statusCode).toBe(403);
  });

  it('con el acceso remoto: sin sesión 401, con usuario y contraseña entra, y cada rol hace lo suyo', async () => {
    const { app, auth } = await make(true);
    await auth.create({ name: 'marc', password: PW, role: 'admin' });
    await auth.create({ name: 'moda', password: PW, role: 'moderator' });
    await auth.create({ name: 'miron', password: PW, role: 'viewer' });
    expect((await remoteReq(app, 'GET', '/admin/api/state')).statusCode).toBe(401);
    expect((await remoteReq(app, 'GET', '/admin/api/ping')).json()).toMatchObject({ admin: false, login: true });
    expect((await login(app, 'marc', 'mala-contraseña-larga')).r.statusCode).toBe(400);

    const admin = await login(app, 'marc');
    expect(admin.r.statusCode).toBe(200);
    expect(admin.r.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await remoteReq(app, 'GET', '/admin/api/ping', { cookie: admin.cookie })).json()).toMatchObject({ admin: true, role: 'admin', name: 'marc', local: false });
    expect((await remoteReq(app, 'GET', '/admin/api/state', { cookie: admin.cookie })).statusCode).toBe(200);
    // lo que cambia el programa o las cuentas solo se hace desde el PC, aunque seas administrador
    for (const [m, u] of [['POST', '/admin/api/settings'], ['GET', '/admin/api/accounts'], ['POST', '/admin/api/update/apply'], ['GET', '/admin/api/backup']] as const)
      expect((await remoteReq(app, m, u, { cookie: admin.cookie })).statusCode, u).toBe(403);

    const mod = await login(app, 'moda');
    expect((await remoteReq(app, 'GET', '/admin/api/state', { cookie: mod.cookie })).statusCode).toBe(200);
    expect((await remoteReq(app, 'POST', '/admin/api/control/say', { cookie: mod.cookie, payload: { message: 'hola' } })).statusCode).not.toBe(403);
    expect((await remoteReq(app, 'POST', '/admin/api/server/stop', { cookie: mod.cookie })).statusCode).toBe(403);
    expect((await remoteReq(app, 'POST', '/admin/api/session-panel', { cookie: mod.cookie, payload: {} })).statusCode).toBe(403);

    const view = await login(app, 'miron');
    expect((await remoteReq(app, 'GET', '/admin/api/laps', { cookie: view.cookie })).statusCode).toBe(200);
    expect((await remoteReq(app, 'GET', '/admin/api/server-password', { cookie: view.cookie })).statusCode).toBe(403);
    expect((await remoteReq(app, 'POST', '/admin/api/control/say', { cookie: view.cookie, payload: { message: 'hola' } })).statusCode).toBe(403);
  });

  it('rechaza peticiones de otro origen y cierra la sesión al salir, cambiar la contraseña o borrar la cuenta', async () => {
    const { app, auth } = await make(true);
    const acc = await auth.create({ name: 'marc', password: PW, role: 'admin' });
    const s = await login(app, 'marc');
    expect((await remoteReq(app, 'POST', '/admin/api/server/restart', { cookie: s.cookie, headers: { origin: 'https://otra-web.example' } })).statusCode).toBe(403);
    await remoteReq(app, 'POST', '/admin/api/logout', { cookie: s.cookie, payload: {} });
    expect((await remoteReq(app, 'GET', '/admin/api/state', { cookie: s.cookie })).statusCode).toBe(401);

    const s2 = await login(app, 'marc');
    await auth.update(acc.id, { password: 'otra-contraseña-larga' });
    expect((await remoteReq(app, 'GET', '/admin/api/state', { cookie: s2.cookie })).statusCode).toBe(401);
    expect((await login(app, 'marc')).r.statusCode).toBe(400);
    const s3 = await login(app, 'marc', 'otra-contraseña-larga');
    expect(s3.r.statusCode).toBe(200);
    auth.remove(acc.id);
    expect((await remoteReq(app, 'GET', '/admin/api/state', { cookie: s3.cookie })).statusCode).toBe(401);
  });

  it('tras 5 fallos bloquea los intentos aunque luego se acierte', async () => {
    const { app, auth } = await make(true);
    await auth.create({ name: 'marc', password: PW, role: 'admin' });
    for (let i = 0; i < 5; i++) expect((await login(app, 'marc', 'incorrecta-incorrecta')).r.statusCode).toBe(400);
    const r = await login(app, 'marc');
    expect(r.r.statusCode).toBe(400);
    expect(r.r.json().error).toMatch(/Demasiados intentos/);
  });

  it('no se puede activar el acceso remoto sin ninguna cuenta', async () => {
    const { app } = await make(false);
    expect((await local(app, 'POST', '/admin/api/accounts/remote', { enabled: true })).statusCode).toBe(400);
    await local(app, 'POST', '/admin/api/accounts', { name: 'marc', password: PW, role: 'admin' });
    const ok = await local(app, 'POST', '/admin/api/accounts/remote', { enabled: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().restartRequired).toBe(true);
  });
});
