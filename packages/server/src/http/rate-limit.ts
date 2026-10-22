import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Límites contra abusos en la web pública (la que se enseña a los pilotos y puede estar abierta a internet): peticiones por minuto
 * y por dirección, un tope más bajo para las consultas pesadas y un número máximo de conexiones en directo. Los topes están pensados
 * para que una persona normal, aunque tenga varias pestañas abiertas, no los note nunca. El panel (127.0.0.1) no pasa por aquí.
 */

export interface RateLimitConfig {
  enabled: boolean;
  /** Peticiones por minuto y dirección (todo: páginas, imágenes y datos). */
  perMinute: number;
  /** Peticiones por minuto y dirección a las consultas pesadas (tablas grandes, comparador, imágenes del contenido de AC). */
  heavyPerMinute: number;
  /** Conexiones en directo (mapa y tablas que se actualizan solas) abiertas a la vez por dirección. */
  liveConnectionsPerIp: number;
  /** Conexiones en directo abiertas a la vez en total. */
  liveConnectionsTotal: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { enabled: true, perMinute: 600, heavyPerMinute: 120, liveConnectionsPerIp: 12, liveConnectionsTotal: 400 };

/** Rutas que cuestan de verdad (agregados grandes, trazas, imágenes) frente a las que solo leen un dato pequeño. */
const HEAVY = /^\/api\/(records(?!\/latest)|compare|replay|rankings|sessions(?!\/\d+\/(?:timing|progression))|tracks\/profile|cars\/profile|content\/|map)/;
const LIVE = /^\/api\/(live|positions)(?:\?|$)/;

export const isHeavy = (url: string) => HEAVY.test(url);
export const isLive = (url: string) => LIVE.test(url);

/** Dirección real de quien pide. Detrás de un túnel o proxy local (Cloudflare Tunnel, nginx…) todas las peticiones llegan desde 127.0.0.1: solo en ese caso se fía de las cabeceras que él pone. */
export function clientIp(remote: string | undefined, headers: Record<string, string | string[] | undefined>): string {
  const r = (remote ?? '').replace(/^::ffff:/, '');
  if (r === '127.0.0.1' || r === '::1') {
    const fwd = headers['cf-connecting-ip'] ?? headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first && /^[0-9a-fA-F:.]{3,45}$/.test(first)) return first.replace(/^::ffff:/, '');
  }
  return r || 'desconocida';
}

interface Window { n: number; start: number }

/** Contador de ventana fija de un minuto por dirección y clase de petición. */
export class RateLimiter {
  private general = new Map<string, Window>();
  private heavy = new Map<string, Window>();
  constructor(private cfg: RateLimitConfig, private now: () => number = Date.now) {}

  /** Cuenta la petición. Devuelve los segundos que hay que esperar si se pasó del tope, o 0 si puede seguir. */
  hit(ip: string, heavy: boolean): number {
    const own = this.touch(this.general, ip, this.cfg.perMinute);
    if (own > 0) return own;
    return heavy ? this.touch(this.heavy, ip, this.cfg.heavyPerMinute) : 0;
  }

  private touch(map: Map<string, Window>, ip: string, max: number): number {
    const t = this.now();
    let w = map.get(ip);
    if (!w || t - w.start >= 60_000) {
      if (map.size >= 10_000) this.evict(map, t); // un aluvión de direcciones distintas no hace crecer el mapa sin límite
      w = { n: 0, start: t };
      map.set(ip, w);
    }
    w.n++;
    return w.n > max ? Math.max(1, Math.ceil((60_000 - (t - w.start)) / 1000)) : 0;
  }

  private evict(map: Map<string, Window>, t: number) {
    for (const [k, v] of map) if (t - v.start >= 60_000) map.delete(k);
    if (map.size >= 10_000) map.clear();
  }
}

/** Conexiones en directo abiertas: por dirección y en total. */
export class LiveGate {
  private perIp = new Map<string, number>();
  private total = 0;
  constructor(private cfg: RateLimitConfig) {}

  /** Intenta abrir una conexión. Devuelve la función que la cierra, o null si no cabe. */
  open(ip: string): (() => void) | null {
    const n = this.perIp.get(ip) ?? 0;
    if (n >= this.cfg.liveConnectionsPerIp || this.total >= this.cfg.liveConnectionsTotal) return null;
    this.perIp.set(ip, n + 1);
    this.total++;
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.total--;
      const left = (this.perIp.get(ip) ?? 1) - 1;
      if (left <= 0) this.perIp.delete(ip); else this.perIp.set(ip, left);
    };
  }

  get open_(): number { return this.total; }
}

/** Engancha los límites a la aplicación. Debe llamarse ANTES de definir las rutas. */
export function registerRateLimit(app: FastifyInstance, cfg: RateLimitConfig = DEFAULT_RATE_LIMIT): { limiter: RateLimiter; gate: LiveGate } {
  const limiter = new RateLimiter(cfg);
  const gate = new LiveGate(cfg);
  if (!cfg.enabled) return { limiter, gate };
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    const ip = clientIp(req.socket.remoteAddress, req.headers);
    const url = req.url;
    if (isLive(url)) {
      const close = gate.open(ip);
      if (!close) return reply.code(429).header('Retry-After', '30').send({ error: 'Demasiadas conexiones en directo abiertas' });
      req.raw.on('close', close);
      return;
    }
    const wait = limiter.hit(ip, isHeavy(url));
    if (wait > 0) return reply.code(429).header('Retry-After', String(wait)).send({ error: 'Demasiadas peticiones, espera un momento' });
  });
  return { limiter, gate };
}
