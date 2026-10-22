import { createSocket, type Socket } from 'node:dgram';
import { decodeServerPacket, encodeCommand, type Command, type ServerEvent } from '@howler/shared';
import type { HowlerConfig } from './config';

/**
 * El servidor de AC solo manda su interfaz UDP a UN destino (`UDP_PLUGIN_ADDRESS`). Si otro plugin (penalizaciones, etc.) también
 * lo necesita, Howler hace de intermediario: copia cada paquete a los puertos de `forward` (solo en este PC) y devuelve al
 * servidor lo que esos plugins contesten. Solo se aceptan respuestas que vengan de ese puerto en 127.0.0.1.
 */
const FORWARD_HOST = '127.0.0.1';

/** Capa UDP: recibe paquetes del servidor de AC y le envía órdenes. No contiene lógica de negocio. */
export class AcspLink {
  private socket = createSocket('udp4');
  private relays: Socket[] = [];
  private forwardPorts: number[] = [];

  constructor(private cfg: HowlerConfig['acsp'], private onEvent: (e: ServerEvent) => void) {
    for (const port of cfg.forward ?? []) {
      if (port === cfg.listenPort || port === cfg.serverPort) continue; // no reenviarse a sí mismo ni al servidor
      const relay = createSocket('udp4');
      relay.on('error', (err) => console.error(`[acsp] reenvío al puerto ${port}: ${err.message}`));
      relay.on('message', (msg, from) => {
        if (from.address === FORWARD_HOST && from.port === port) this.socket.send(msg, this.cfg.serverPort, this.cfg.serverHost);
      });
      this.relays.push(relay);
      this.forwardPorts.push(port);
    }
    this.socket.on('message', (msg) => {
      this.relays.forEach((r, i) => r.send(msg, this.forwardPorts[i]!, FORWARD_HOST));
      const ev = decodeServerPacket(msg);
      if (ev && process.env.HOWLER_DEBUG === '1' && (ev.kind === 'lapCompleted' || ev.kind === 'endSession')) {
        console.log(`[acsp <-] ${ev.kind} en bruto (${msg.length} bytes):`, msg.toString('hex'));
      }
      if (ev) this.onEvent(ev);
      else if (process.env.HOWLER_DEBUG === '1') console.log('[acsp <-] paquete no reconocido', msg.length, 'bytes:', msg.subarray(0, 96).toString('hex'));
    });
  }

  start(): Promise<void> {
    // Cada reenvío necesita un puerto propio para que las respuestas del otro plugin vuelvan solo a él
    const relaysReady = this.relays.map((r) => new Promise<void>((res, rej) => { r.once('error', rej); r.bind(0, FORWARD_HOST, () => { r.off('error', rej); res(); }); }));
    return Promise.all(relaysReady).then(() => new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.cfg.listenPort, this.cfg.listenHost, () => {
        this.socket.off('error', reject);
        this.socket.on('error', (err) => console.error('[acsp] error de socket:', err.message));
        resolve();
      });
    }));
  }

  send(c: Command) {
    this.socket.send(encodeCommand(c), this.cfg.serverPort, this.cfg.serverHost);
  }

  stop() {
    this.socket.close();
    for (const r of this.relays) r.close();
  }
}
