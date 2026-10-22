import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientIp, DEFAULT_RATE_LIMIT, isHeavy, isLive, LiveGate, RateLimiter, registerRateLimit, type RateLimitConfig } from './rate-limit';

const cfg = (over: Partial<RateLimitConfig> = {}): RateLimitConfig => ({ ...DEFAULT_RATE_LIMIT, ...over });

describe('qué rutas cuentan como pesadas o en directo', () => {
  it('distingue las consultas pesadas de las pequeñas', () => {
    for (const u of ['/api/records?track=a', '/api/compare?x', '/api/replay', '/api/rankings', '/api/sessions?limit=20', '/api/content/cars/x/preview', '/api/map/road', '/api/tracks/profile?track=a']) expect(isHeavy(u), u).toBe(true);
    for (const u of ['/api/status', '/api/combos', '/api/records/latest', '/api/sessions/4/timing', '/api/sessions/4/progression', '/', '/assets/app.js']) expect(isHeavy(u), u).toBe(false);
  });
  it('reconoce las conexiones en directo', () => {
    expect(isLive('/api/live')).toBe(true);
    expect(isLive('/api/positions')).toBe(true);
    expect(isLive('/api/livestock')).toBe(false);
  });
});

describe('dirección de quien pide', () => {
  it('usa la dirección de la conexión', () => {
    expect(clientIp('203.0.113.9', {})).toBe('203.0.113.9');
    expect(clientIp('::ffff:203.0.113.9', {})).toBe('203.0.113.9');
  });
  it('detrás de un proxy local se fía de su cabecera; desde fuera no (se podría falsear)', () => {
    expect(clientIp('127.0.0.1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })).toBe('198.51.100.7');
    expect(clientIp('127.0.0.1', { 'cf-connecting-ip': '198.51.100.8' })).toBe('198.51.100.8');
    expect(clientIp('203.0.113.9', { 'x-forwarded-for': '198.51.100.7' })).toBe('203.0.113.9');
    expect(clientIp('127.0.0.1', { 'x-forwarded-for': '<script>' })).toBe('127.0.0.1');
  });
});

describe('limitador por minuto', () => {
  it('deja pasar hasta el tope, avisa de cuánto esperar y se libera al minuto', () => {
    let t = 1_000_000;
    const l = new RateLimiter(cfg({ perMinute: 3 }), () => t);
    expect([l.hit('a', false), l.hit('a', false), l.hit('a', false)]).toEqual([0, 0, 0]);
    const wait = l.hit('a', false);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(l.hit('b', false)).toBe(0); // otra dirección no se ve afectada
    t += 61_000;
    expect(l.hit('a', false)).toBe(0);
  });
  it('las consultas pesadas tienen su propio tope, más bajo', () => {
    const l = new RateLimiter(cfg({ perMinute: 100, heavyPerMinute: 2 }), () => 5);
    expect([l.hit('a', true), l.hit('a', true)]).toEqual([0, 0]);
    expect(l.hit('a', true)).toBeGreaterThan(0);
    expect(l.hit('a', false)).toBe(0); // las pequeñas siguen pasando
  });
});

describe('conexiones en directo', () => {
  it('limita por dirección y en total, y libera al cerrar', () => {
    const g = new LiveGate(cfg({ liveConnectionsPerIp: 2, liveConnectionsTotal: 3 }));
    const a1 = g.open('a'), a2 = g.open('a');
    expect(a1 && a2).toBeTruthy();
    expect(g.open('a')).toBeNull(); // tope por dirección
    const b1 = g.open('b');
    expect(b1).toBeTruthy();
    expect(g.open('c')).toBeNull(); // tope total
    a1!();
    a1!(); // cerrar dos veces no descuenta dos veces
    expect(g.open('c')).toBeTruthy();
  });
});

describe('en la aplicación', () => {
  const build = async (c: RateLimitConfig) => {
    const app = Fastify();
    registerRateLimit(app, c);
    app.get('/api/status', async () => ({ ok: true }));
    app.get('/api/records', async () => ({ ok: true }));
    await app.ready();
    return app;
  };
  it('responde 429 con Retry-After al pasarse y no afecta a otras direcciones', async () => {
    const app = await build(cfg({ perMinute: 3 }));
    const get = (ip: string) => app.inject({ method: 'GET', url: '/api/status', remoteAddress: ip });
    expect((await get('203.0.113.1')).statusCode).toBe(200);
    await get('203.0.113.1'); await get('203.0.113.1');
    const blocked = await get('203.0.113.1');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await get('203.0.113.2')).statusCode).toBe(200);
  });
  it('detrás de un túnel local cada visitante tiene su propio cupo', async () => {
    const app = await build(cfg({ perMinute: 2 }));
    const via = (who: string) => app.inject({ method: 'GET', url: '/api/status', remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': who } });
    await via('198.51.100.1'); await via('198.51.100.1');
    expect((await via('198.51.100.1')).statusCode).toBe(429);
    expect((await via('198.51.100.2')).statusCode).toBe(200);
  });
  it('con los límites apagados no cuenta nada', async () => {
    const app = await build(cfg({ enabled: false, perMinute: 1 }));
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: '/api/status', remoteAddress: '203.0.113.5' })).statusCode).toBe(200);
  });
});
