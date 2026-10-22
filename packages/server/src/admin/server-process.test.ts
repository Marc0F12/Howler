import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerProcess } from './server-process';

/** Un proceso hijo falso: lo justo para probar el gestor sin arrancar un servidor de verdad. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  say(text: string) { this.stdout.emit('data', Buffer.from(text)); }
  exit(code = 0) { this.exitCode = code; this.emit('exit', code); }
}

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(extra: Partial<ConstructorParameters<typeof ServerProcess>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'howler-proc-'));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'acServer.exe'), 'x');
  const child = new FakeChild();
  const spawnFn = vi.fn(() => child) as never;
  const forceKill = vi.fn(async () => child.exit(1));
  const sp = new ServerProcess({ serverDir: dir, exe: 'acServer.exe', preset: 'SERVER_00', spawnFn, forceKill, isAlive: () => false, sleep: async () => {}, stopGraceMs: 50, readyTimeoutMs: 60_000, ...extra });
  return { sp, child, spawnFn: spawnFn as unknown as ReturnType<typeof vi.fn>, forceKill, dir };
}

describe('ServerProcess', () => {
  it('arranca con el preset, pasa a "listo" al ver la línea de arranque y guarda la consola', () => {
    const { sp, child, spawnFn, dir } = setup();
    const states: string[] = [];
    sp.on('state', (s) => states.push(s.state));
    sp.start();
    expect(spawnFn).toHaveBeenCalledWith(join(dir, 'acServer.exe'), ['--preset', 'SERVER_00'], expect.objectContaining({ cwd: dir, windowsHide: true }));
    expect(sp.snapshot().state).toBe('starting');
    child.say('[00:00:01 INF] Loading cars\n[00:00:02 INF] Server startup comp');
    child.say('leted\n');
    expect(sp.snapshot().state).toBe('running');
    expect(sp.snapshot().logs).toEqual(['[00:00:01 INF] Loading cars', '[00:00:02 INF] Server startup completed']);
    expect(states).toEqual(['starting', 'running']);
  });

  it('saca el enlace de invitación de la consola y solo si es de acstuff.club', () => {
    const { sp, child } = setup();
    sp.start();
    expect(sp.snapshot().inviteLink).toBeNull();
    child.say('[00:00:01 INF] Invite link: https://evil.example/x\n');
    expect(sp.snapshot().inviteLink).toBeNull();
    child.say('[00:00:02 INF] Invite link: https://acstuff.club/s/q:race/online/join?ip=1.2.3.4&httpPort=8081\n');
    expect(sp.snapshot().inviteLink).toBe('https://acstuff.club/s/q:race/online/join?ip=1.2.3.4&httpPort=8081');
  });

  it('sin preset arranca sin argumentos', () => {
    const { sp, spawnFn } = setup({ preset: '' });
    sp.start();
    expect(spawnFn.mock.calls[0]![1]).toEqual([]);
  });

  it('no arranca dos veces y avisa si falta el ejecutable', () => {
    const { sp } = setup();
    sp.start();
    expect(() => sp.start()).toThrow(/ya está/);
    const other = new ServerProcess({ serverDir: 'C:\\no\\existe', exe: 'acServer.exe', preset: '' });
    expect(() => other.start()).toThrow(/No encuentro/);
  });

  it('parada limpia: avisa a los jugadores, pide la parada y espera sin matar nada', async () => {
    const { sp, child, forceKill } = setup({ requestStop: async () => { setTimeout(() => child.exit(0), 5); return true; } });
    sp.start();
    child.say('Server startup completed\n');
    const announce = vi.fn();
    await sp.stop({ warnSeconds: 10, announce });
    expect(announce).toHaveBeenCalledWith(10);
    expect(forceKill).not.toHaveBeenCalled();
    expect(sp.snapshot()).toMatchObject({ state: 'stopped', pid: null, lastExit: { code: 0, expected: true } });
  });

  it('si el servidor no responde a la parada limpia, se mata el proceso', async () => {
    const { sp, child, forceKill } = setup({ requestStop: async () => true }); // dice que sí pero no sale
    sp.start();
    child.say('Server startup completed\n');
    await sp.stop();
    expect(forceKill).toHaveBeenCalledWith(4242);
    expect(sp.snapshot().state).toBe('stopped');
  });

  it('si el plugin no está, se fuerza el cierre y queda anotado', async () => {
    const { sp, child, forceKill } = setup({ requestStop: async () => false });
    sp.start();
    child.say('Server startup completed\n');
    await sp.stop();
    expect(forceKill).toHaveBeenCalled();
    expect(sp.snapshot().logs.join('\n')).toMatch(/no respondió a la parada limpia/);
  });

  it('detecta un cierre inesperado y lo deja explicado', () => {
    const { sp, child } = setup();
    sp.start();
    child.say('Server startup completed\n');
    child.exit(3);
    const s = sp.snapshot();
    expect(s.state).toBe('stopped');
    expect(s.lastExit).toMatchObject({ code: 3, expected: false });
    expect(s.logs.at(-1)).toMatch(/se cerró solo/);
  });

  it('al caerse deduce la causa de la consola y no se confunde con las líneas normales de checksums', () => {
    const a = setup();
    a.sp.start();
    a.child.say('[22:38:17 INF] Initialized 2 track checksums\n[22:38:17 FTL] Fatal exception occurred\nX.ConfigurationException: No data.acd found for mod_car. This will allow players to cheat. More info: https://x#missing-car-checksums\n');
    a.child.exit(1);
    expect(a.sp.snapshot().lastExit?.diagnosis.map((d) => d.id)).toEqual(['car-checksums']);
    const b = setup();
    b.sp.start();
    b.child.say('[22:38:17 INF] Initialized 2 track checksums\notro error cualquiera\n');
    b.child.exit(1);
    expect(b.sp.snapshot().lastExit).toMatchObject({ expected: false, diagnosis: [] });
  });

  it('se puede reiniciar y la consola solo conserva las últimas líneas', async () => {
    const { sp, child, spawnFn } = setup({ maxLogLines: 3, requestStop: async () => { setTimeout(() => child.exit(0), 1); return true; } });
    sp.start();
    child.say('a\nb\nc\nd\ne\n');
    expect(sp.snapshot().logs).toEqual(['c', 'd', 'e']);
    await sp.restart();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(sp.snapshot().state).toBe('starting');
  });

  it('da por listo el servidor pasado el tiempo aunque no aparezca la línea', () => {
    vi.useFakeTimers();
    try {
      const { sp } = setup({ readyTimeoutMs: 1000 });
      sp.start();
      vi.advanceTimersByTime(1100);
      expect(sp.snapshot().state).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el proceso no se puede ni lanzar, no se queda en «arrancando»', () => {
    const { sp, child } = setup();
    child.pid = undefined as never;
    sp.start();
    child.emit('error', new Error('spawn EACCES'));
    expect(sp.snapshot().state).toBe('stopped');
    expect(sp.snapshot().logs.join('\n')).toContain('EACCES');
  });

  it('si la parada forzada falla y el proceso sigue vivo, no se da por parado', async () => {
    const { sp } = setup({ requestStop: async () => false, forceKill: async () => {}, isAlive: () => true, stopGraceMs: 5, killWaitMs: 5 });
    sp.start();
    await expect(sp.stop()).rejects.toThrow(/No se pudo parar/);
    expect(sp.snapshot().state).toBe('running');
    expect(() => sp.start()).toThrow(/ya está/);
  });
});
