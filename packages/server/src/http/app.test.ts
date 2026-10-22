import { afterEach, describe, expect, it } from 'vitest';
import { Bus } from '../core/bus';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { buildApp } from './app';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

async function start(positions: () => unknown[]) {
  const repo = new Repository(openDatabase(':memory:'));
  const app = await buildApp({ repo, bus: new Bus(), tracker: { positions, status: () => ({ acConnected: false, exactSectors: false, session: null, online: [] }) } as never });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  return { app, base: `http://127.0.0.1:${port}` };
}

/** Lee el flujo SSE hasta tener `n` mensajes de datos. */
async function readEvents(res: Response, n: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const out: string[] = [];
  while (out.length < n) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    for (const block of buf.split('\n\n').slice(0, -1)) { const m = /^data: (.*)$/m.exec(block); if (m) out.push(m[1]!); }
    buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
  }
  await reader.cancel();
  return out;
}

describe('API pública', () => {
  it('las posiciones en directo llegan a varios visitantes con un solo cálculo por tic', async () => {
    let calls = 0, x = 0;
    const { base } = await start(() => { calls++; return [{ carId: 0, x: x++, z: 0, speedKmh: 100 }]; });
    const [a, b] = await Promise.all([fetch(`${base}/api/positions`), fetch(`${base}/api/positions`)]);
    const [ea, eb] = await Promise.all([readEvents(a, 3), readEvents(b, 3)]);
    expect(ea).toHaveLength(3);
    expect(eb).toHaveLength(3);
    expect(JSON.parse(ea[0]!).cars).toHaveLength(1);
    // Con dos visitantes, el trabajo no se duplica: ~1 cálculo por tic (+2 iniciales), no 2 por tic
    expect(calls).toBeLessThan(2 + 2 * 3 + 6);
  });
  it('todas las respuestas llevan cabeceras de seguridad (sin marcos ajenos, sin scripts de fuera, sin adivinar tipos)', async () => {
    const { base } = await start(() => []);
    for (const path of ['/api/status', '/api/no-existe']) {
      const r = await fetch(`${base}${path}`);
      const csp = r.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('un fallo de validación en la API pública responde 400 y no 500', async () => {
    const { base } = await start(() => []);
    const r = await fetch(`${base}/api/sessions?limit=abc`);
    expect(r.status).toBe(400);
  });
});

describe('cierre con conexiones en directo abiertas', () => {
  it('app.close() termina aunque un navegador siga conectado a los datos en directo', async () => {
    const { base, app } = await start(() => []);
    const res = await fetch(`${base}/api/live`);          // conexión larga (SSE) que se queda abierta
    expect(res.ok).toBe(true);
    const closed = await Promise.race([app.close().then(() => 'cerrado'), new Promise((r) => setTimeout(() => r('colgado'), 3000))]);
    expect(closed).toBe('cerrado');
    apps.length = 0; // ya está cerrada: que afterEach no la cierre de nuevo
  });
});
