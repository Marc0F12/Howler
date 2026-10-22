import { createSocket } from 'node:dgram';
import { parsePluginMessage, type PluginMessage } from './core/exact-sectors';

/** Recibe los mensajes UDP del plugin HowlerPlugin (sectores exactos). Sin lógica de negocio. */
export class PluginLink {
  private socket = createSocket('udp4');

  constructor(private cfg: { host: string; port: number }, private onMessage: (m: PluginMessage) => void) {
    this.socket.on('message', (buf) => {
      const m = parsePluginMessage(buf);
      if (m) this.onMessage(m);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.cfg.port, this.cfg.host, () => {
        this.socket.off('error', reject);
        this.socket.on('error', (err) => console.error('[plugin] error de socket:', err.message));
        resolve();
      });
    });
  }

  stop() {
    this.socket.close();
  }
}
