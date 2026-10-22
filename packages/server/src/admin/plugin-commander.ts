import { createSocket } from 'node:dgram';
import { randomUUID } from 'node:crypto';

export interface CommandResult {
  ok: boolean;
  /** Lo que respondió el servidor (puede tener varias líneas). */
  reply: string;
}

/**
 * Cliente del canal de órdenes del plugin HowlerPlugin (UDP, solo 127.0.0.1).
 * Ejecuta comandos de administrador del servidor (/settime, /setcspweather, /ballast...) y devuelve su respuesta.
 */
export class PluginCommander {
  constructor(private cfg: { host?: string; port: number; timeoutMs?: number }) {}

  get enabled() {
    return this.cfg.port > 0;
  }

  /** Ejecuta una orden. Si el plugin no contesta a tiempo, devuelve ok=false con un texto que lo explica. */
  exec(cmd: string): Promise<CommandResult> {
    if (!this.enabled) return Promise.resolve({ ok: false, reply: 'El canal de órdenes del plugin está desactivado.' });
    const id = randomUUID();
    const timeout = this.cfg.timeoutMs ?? 3000;
    return new Promise((resolve) => {
      const socket = createSocket('udp4');
      const finish = (r: CommandResult) => { clearTimeout(timer); socket.close(); resolve(r); };
      const timer = setTimeout(
        () => finish({ ok: false, reply: 'El plugin de Howler no responde. ¿Está el servidor en marcha y con el plugin instalado?' }),
        timeout,
      );
      socket.on('message', (buf) => {
        try {
          const m = JSON.parse(buf.toString('utf8')) as { id?: string; ok?: boolean; reply?: string };
          if (m.id === id) finish({ ok: !!m.ok, reply: String(m.reply ?? '') });
        } catch { /* se ignora lo que no sea JSON */ }
      });
      socket.on('error', (e) => finish({ ok: false, reply: `No se pudo contactar con el plugin: ${e.message}` }));
      socket.send(JSON.stringify({ v: 1, id, cmd }), this.cfg.port, this.cfg.host ?? '127.0.0.1', (err) => {
        if (err) finish({ ok: false, reply: `No se pudo contactar con el plugin: ${err.message}` });
      });
    });
  }

  /** Parada limpia del servidor, pedida desde dentro por el plugin. true si el plugin confirmó. */
  async requestStop(): Promise<boolean> {
    return (await this.exec('howler:stop')).ok;
  }
}

/** Quita lo que no debe ir en un argumento de orden: el plugin ya rechaza saltos de línea, pero se limpia antes de enviar. */
export const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** Órdenes que el panel envía, construidas en un solo sitio para que el formato esté controlado y probado. */
export const commands = {
  setTime: (hhmm: string) => {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error('La hora debe tener el formato HH:MM, por ejemplo 15:30.');
    return `/settime ${hhmm}`;
  },
  setWeather: (type: string, durationSeconds: number) => {
    if (!/^[A-Za-z]{2,30}$/.test(type)) throw new Error('Tipo de clima no válido.');
    const d = Math.max(0, Math.min(3600, Math.round(durationSeconds)));
    return `/setcspweather ${type} ${d}`;
  },
  say: (msg: string) => `/say ${clean(msg).slice(0, 200)}`,
  kick: (carId: number) => `/kick_id ${intId(carId)}`,
  ban: (carId: number) => `/ban_id ${intId(carId)}`,
  ballast: (carId: number, kg: number) => `/ballast ${intId(carId)} ${Math.max(0, Math.min(500, Math.round(kg)))}`,
  restrictor: (carId: number, percent: number) => `/restrictor ${intId(carId)} ${Math.max(0, Math.min(100, Math.round(percent)))}`,
  /** Agarre global de la pista en porcentaje (el servidor lo espera como decimal de 0 a 1). */
  setGrip: (percent: number) => `/setgrip ${(Math.max(50, Math.min(100, Math.round(percent))) / 100).toFixed(2)}`,
  /** Lluvia: intensidad, humedad de la pista y agua acumulada, cada una de 0 a 100 %. */
  setRain: (intensity: number, wetness: number, water: number) => {
    const f = (n: number) => (Math.max(0, Math.min(100, n)) / 100).toFixed(2);
    return `/setrain ${f(intensity)} ${f(wetness)} ${f(water)}`;
  },
  /** Clima clásico: salta a la posición `id` de la lista de climas del preset. */
  setWeatherId: (id: number) => `/setweather ${intId(id)}`,
  currentTime: () => '/time',
  nextSession: () => '/next_session',
  restartSession: () => '/restart_session',
};

function intId(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('Número de coche no válido.');
  return n;
}
