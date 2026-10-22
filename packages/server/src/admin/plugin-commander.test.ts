import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginCommander, commands } from './plugin-commander';

describe('constructores de órdenes', () => {
  it('construyen el texto exacto que entiende el servidor', () => {
    expect(commands.setTime('15:30')).toBe('/settime 15:30');
    expect(commands.setTime('7:05')).toBe('/settime 7:05');
    expect(commands.setWeather('LightRain', 120)).toBe('/setcspweather LightRain 120');
    expect(commands.kick(3)).toBe('/kick_id 3');
    expect(commands.ballast(2, 40)).toBe('/ballast 2 40');
    expect(commands.restrictor(2, 10)).toBe('/restrictor 2 10');
    expect(commands.setGrip(95)).toBe('/setgrip 0.95');
    expect(commands.setRain(50, 100, 25)).toBe('/setrain 0.50 1.00 0.25');
    expect(commands.nextSession()).toBe('/next_session');
  });

  it('rechazan valores raros en vez de mandarlos al servidor', () => {
    expect(() => commands.setTime('25:00')).toThrow();
    expect(() => commands.setTime('12:60')).toThrow();
    expect(() => commands.setTime('12:00\n/exception')).toThrow();
    expect(() => commands.setWeather('Rain; /exception', 10)).toThrow();
    expect(() => commands.kick(-1)).toThrow();
    expect(() => commands.kick(1.5)).toThrow();
    expect(() => commands.ballast(300, 10)).toThrow();
  });

  it('acotan los números y limpian los mensajes', () => {
    expect(commands.ballast(1, 9999)).toBe('/ballast 1 500');
    expect(commands.setGrip(10)).toBe('/setgrip 0.50');
    expect(commands.setWeather('Clear', -5)).toBe('/setcspweather Clear 0');
    expect(commands.say('hola\n/exception')).toBe('/say hola /exception');
    expect(commands.say('x'.repeat(500)).length).toBe('/say '.length + 200);
  });
});

describe('PluginCommander', () => {
  let fake: Socket | null = null;
  afterEach(() => { fake?.close(); fake = null; });

  /** Un plugin falso que contesta a cada orden con lo que se le diga. */
  function fakePlugin(reply: (cmd: string) => { ok: boolean; reply: string } | null): Promise<number> {
    return new Promise((resolve) => {
      fake = createSocket('udp4');
      fake.on('message', (buf, rinfo) => {
        const req = JSON.parse(buf.toString());
        const r = reply(req.cmd);
        if (r) fake!.send(JSON.stringify({ v: 1, t: 'result', id: req.id, ...r }), rinfo.port, rinfo.address);
      });
      fake.bind(0, '127.0.0.1', () => resolve(fake!.address().port));
    });
  }

  it('manda la orden y devuelve la respuesta del servidor', async () => {
    const port = await fakePlugin((cmd) => ({ ok: true, reply: `hecho: ${cmd}` }));
    const r = await new PluginCommander({ port }).exec('/settime 15:30');
    expect(r).toEqual({ ok: true, reply: 'hecho: /settime 15:30' });
  });

  it('si el plugin rechaza la orden, lo cuenta', async () => {
    const port = await fakePlugin(() => ({ ok: false, reply: 'no permitido' }));
    expect(await new PluginCommander({ port }).exec('/exception')).toEqual({ ok: false, reply: 'no permitido' });
  });

  it('si el plugin no contesta, termina con un mensaje claro y sin colgarse', async () => {
    const port = await fakePlugin(() => null);
    const t0 = Date.now();
    const r = await new PluginCommander({ port, timeoutMs: 150 }).exec('/settime 10:00');
    expect(r.ok).toBe(false);
    expect(r.reply).toMatch(/no responde/);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('con el canal desactivado no envía nada', async () => {
    const c = new PluginCommander({ port: 0 });
    expect(c.enabled).toBe(false);
    expect((await c.exec('/settime 10:00')).ok).toBe(false);
  });

  it('requestStop usa howler:stop', async () => {
    let seen = '';
    const port = await fakePlugin((cmd) => { seen = cmd; return { ok: true, reply: 'parando' }; });
    expect(await new PluginCommander({ port }).requestStop()).toBe(true);
    expect(seen).toBe('howler:stop');
  });
});
