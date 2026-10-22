import { describe, expect, it } from 'vitest';
import { DISCORD_EVENTS, type OnlineDriver, type SessionSummary } from '@howler/shared';
import { isDiscordWebhook, renderEvent, sampleValues, sendDiscord, startDiscordNotifier, type DiscordSettings } from './discord';
import { Bus } from './bus';

const URL_OK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABCDEF';
const base: DiscordSettings = { webhookUrl: URL_OK, publicUrl: '', events: {} };
const scope = (beaten: boolean) => ({ beaten, prevMs: 91000, prevDriver: 'Beto' });

describe('discord', () => {
  it('solo acepta webhooks de Discord', () => {
    expect(isDiscordWebhook(URL_OK)).toBe(true);
    expect(isDiscordWebhook('http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isDiscordWebhook('https://discord.com.evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isDiscordWebhook('')).toBe(false);
  });
  it('cada aviso tiene huecos de ejemplo para todos los que usa su texto por defecto', () => {
    for (const e of DISCORD_EVENTS) {
      const out = renderEvent(e.id, base, sampleValues(e.id));
      expect(`${out.embeds[0]!.title} ${out.embeds[0]!.description}`, e.id).not.toMatch(/\{\w+\}/);
    }
  });
  it('texto propio con huecos; vacío = el de Howler', () => {
    const s: DiscordSettings = { ...base, events: { recordCombo: { title: 'Récord de {piloto}', message: '{tiempo} en {circuito}' }, serverUp: { message: '  ' } } };
    expect(renderEvent('recordCombo', s, sampleValues('recordCombo')).embeds[0]).toMatchObject({ title: 'Récord de Ana', description: '1:30.000 en Imola' });
    expect(renderEvent('serverUp', s, {}).embeds[0]!.description).toBe('¡Ya podéis conectaros!');
  });
  it('errores en español y sin llamar a fetch con una URL inválida', async () => {
    expect(await sendDiscord('https://x.com/a', { embeds: [] }, (() => { throw new Error('no'); }) as never)).toMatch(/webhook de Discord/);
    expect(await sendDiscord(URL_OK, { embeds: [] }, (async () => new Response('', { status: 404 })) as never)).toMatch(/borrado/);
    expect(await sendDiscord(URL_OK, { embeds: [] }, (async () => new Response(null, { status: 204 })) as never)).toBeNull();
    expect(await sendDiscord(URL_OK, { embeds: [] }, (async () => { throw new Error('x'); }) as never)).toMatch(/internet/);
  });

  function rig(settings: () => DiscordSettings) {
    const bus = new Bus();
    const sent: string[] = [];
    const st = {
      state: 'stopped', online: [] as OnlineDriver[], session: null as SessionSummary | null,
      rec: { driverName: 'Ana', track: 'imola', layout: '', car: 'mx5', lapMs: 90000, session: scope(false), combo: scope(false), global: scope(false) },
    };
    startDiscordNotifier({
      bus, settings, serverState: () => st.state, online: () => st.online, session: () => st.session, scopes: () => st.rec,
      championship: (id) => (id === 1 ? { name: 'Copa', rounds: 4 } : null), carName: (c) => c, trackName: (t) => t,
      doFetch: (async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body).embeds[0].title); return new Response(null, { status: 204 }); }) as never,
    });
    const flush = () => new Promise((r) => setTimeout(r, 10));
    return { bus, sent, st, flush };
  }
  const car = (driverId: number, name: string): OnlineDriver => ({ carId: driverId, driverId, name, car: 'mx5' });

  it('por defecto avisa del servidor y del récord de combinación; lo demás, apagado', async () => {
    const { bus, sent, st, flush } = rig(() => base);
    st.state = 'running'; bus.emit({ type: 'server' });
    st.state = 'stopped'; bus.emit({ type: 'server' });
    st.online = [car(1, 'Ana')]; bus.emit({ type: 'status' }); // apagado por defecto
    st.rec.combo = scope(true); bus.emit({ type: 'lap', lapId: 1, valid: true, sessionId: 1, driverId: 1, track: 'imola', layout: '', car: 'mx5' });
    bus.emit({ type: 'championship', kind: 'started', id: 1 });
    await flush();
    expect(sent).toEqual(['🟢 Servidor encendido', '🔴 Servidor apagado', '🏆 Nuevo récord en imola']);
  });
  it('se puede activar cada cosa por separado: entradas, salidas, sesión y campeonatos', async () => {
    const on = (...ids: string[]): DiscordSettings => ({ ...base, events: Object.fromEntries(ids.map((i) => [i, { enabled: true }])) as never });
    const { bus, sent, st, flush } = rig(() => ({ ...on('driverJoin', 'driverLeave', 'sessionStart', 'championshipStarted', 'championshipFinished', 'recordGlobal', 'recordCombo'), events: { ...on('driverJoin', 'driverLeave', 'sessionStart', 'championshipStarted', 'championshipFinished', 'recordGlobal', 'recordCombo').events, serverUp: { enabled: false } } }));
    st.online = [car(1, 'Ana')]; bus.emit({ type: 'status' });
    st.online = [car(1, 'Ana'), car(2, 'Beto')]; bus.emit({ type: 'status' });
    st.online = [car(2, 'Beto')]; bus.emit({ type: 'status' });
    st.session = { id: 7, track: 'imola', layout: '', name: 'Race', type: 3, startedAt: 'x' }; bus.emit({ type: 'session' }); bus.emit({ type: 'session' });
    bus.emit({ type: 'championship', kind: 'started', id: 1 }); bus.emit({ type: 'championship', kind: 'finished', id: 1 }); bus.emit({ type: 'championship', kind: 'started', id: 99 });
    st.rec.global = scope(true); st.rec.combo = scope(true); // bate los dos: solo el más importante
    bus.emit({ type: 'lap', lapId: 1, valid: true, sessionId: 1, driverId: 1, track: 'imola', layout: '', car: 'mx5' });
    st.state = 'running'; bus.emit({ type: 'server' }); // desactivado
    await flush();
    expect(sent).toEqual(['👋 Ana se ha conectado', '👋 Beto se ha conectado', '🚪 Ana se ha desconectado', '🏁 Empieza una sesión: Carrera', '🏆 ¡Arranca el campeonato Copa!', '🏁 Campeonato terminado: Copa', '👑 Récord absoluto de imola']);
  });
  it('sin webhook no avisa de nada', async () => {
    const { bus, sent, flush } = rig(() => ({ ...base, webhookUrl: '' }));
    bus.emit({ type: 'championship', kind: 'started', id: 1 });
    await flush();
    expect(sent).toEqual([]);
  });
  it('manda cada aviso a todos los canales y pone el nombre del servidor al pie', async () => {
    const bus = new Bus();
    const calls: { url: string; footer?: string }[] = [];
    let state = 'stopped';
    startDiscordNotifier({
      bus, settings: () => ({ ...base, serverName: 'Servidor de Marc', webhooks: [{ id: 'abcd1234', name: 'Otro', url: URL_OK.replace(/.$/, 'z') }] }),
      serverState: () => state, online: () => [], session: () => null, scopes: () => null, championship: () => null, carName: (c) => c, trackName: (t) => t,
      doFetch: (async (u: string, init: { body: string }) => { calls.push({ url: u, footer: JSON.parse(init.body).embeds[0].footer?.text }); return new Response(null, { status: 204 }); }) as never,
    });
    state = 'running'; bus.emit({ type: 'server' });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.url)).size).toBe(2);
    expect(calls.every((c) => c.footer === 'Servidor: Servidor de Marc')).toBe(true);
  });
  it('rellena {servidor} e {insignia} cuando el organizador los pone en el texto', async () => {
    const titles: string[] = [];
    const bus = new Bus();
    startDiscordNotifier({
      bus, settings: () => ({ ...base, events: { serverUp: { title: '{insignia} {servidor} encendido' } } }),
      serverState: () => state, online: () => [], session: () => null, scopes: () => null, championship: () => null, carName: (c) => c, trackName: (t) => t,
      server: () => ({ name: 'Servidor de Marc', badge: '🐒WM' }),
      doFetch: (async (_u: string, init: { body: string }) => { titles.push(JSON.parse(init.body).embeds[0].title); return new Response(null, { status: 204 }); }) as never,
    });
    var state = 'running'; // eslint-disable-line no-var
    bus.emit({ type: 'server' });
    await new Promise((r) => setTimeout(r, 10));
    expect(titles).toEqual(['🐒WM Servidor de Marc encendido']);
  });
});
