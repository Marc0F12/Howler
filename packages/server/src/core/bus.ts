import { EventEmitter } from 'node:events';
import type { LiveEvent } from '@howler/shared';

/** Bus interno tipado: el núcleo publica, el canal SSE y (más adelante) Discord escuchan. */
export class Bus {
  private em = new EventEmitter();

  constructor() {
    this.em.setMaxListeners(0); // cada visitante con la web abierta añade un oyente (el canal SSE): no es una fuga
  }

  /** Avisa a todos los oyentes. Si uno falla no se interrumpe al resto ni al que emite (p. ej. el procesado de un paquete UDP). */
  emit(e: LiveEvent) {
    for (const fn of this.em.listeners('live') as ((e: LiveEvent) => void)[]) {
      try { fn(e); } catch (err) { console.error('[howler] un oyente del bus falló:', err); }
    }
  }

  on(fn: (e: LiveEvent) => void): () => void {
    this.em.on('live', fn);
    return () => this.em.off('live', fn);
  }
}
