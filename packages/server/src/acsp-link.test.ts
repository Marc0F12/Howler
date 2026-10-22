import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { AcspLink } from './acsp-link';
import type { HowlerConfig } from './config';

const freePort = () => new Promise<number>((res) => { const s = createSocket('udp4'); s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const once = (s: ReturnType<typeof createSocket>) => new Promise<{ msg: Buffer; port: number }>((res) => s.once('message', (msg, r) => res({ msg, port: r.port })));

describe('AcspLink: reenvío a otros plugins', () => {
  it('copia los paquetes del servidor al otro plugin y devuelve al servidor lo que conteste', async () => {
    const [listenPort, serverPort, pluginPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const server = createSocket('udp4'); await new Promise<void>((r) => server.bind(serverPort, '127.0.0.1', () => r()));
    const plugin = createSocket('udp4'); await new Promise<void>((r) => plugin.bind(pluginPort, '127.0.0.1', () => r()));
    const link = new AcspLink({ listenHost: '127.0.0.1', listenPort, serverHost: '127.0.0.1', serverPort, forward: [pluginPort] } as HowlerConfig['acsp'], () => undefined);
    await link.start();
    const sender = createSocket('udp4');

    const gotPlugin = once(plugin);
    sender.send(Buffer.from([0xff, 1, 2]), listenPort, '127.0.0.1');
    const copy = await gotPlugin;
    expect([...copy.msg]).toEqual([0xff, 1, 2]);

    // el plugin contesta a quien le escribió (el reenvío): debe llegar al servidor
    const gotServer = once(server);
    plugin.send(Buffer.from('castigo'), copy.port, '127.0.0.1');
    expect((await gotServer).msg.toString()).toBe('castigo');

    // una respuesta que no viene del puerto del plugin se ignora
    const stranger = createSocket('udp4');
    let leaked = false; server.once('message', () => { leaked = true; });
    stranger.send(Buffer.from('intruso'), copy.port, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);

    link.stop(); [server, plugin, sender, stranger].forEach((s) => s.close());
  });
});
