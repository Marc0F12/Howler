/**
 * Volver a abrir Howler tras una actualización y COMPROBAR que arrancó: no basta con lanzar el .exe, porque si algo falla en
 * silencio (un puerto aún ocupado, la ventana vieja del panel sin soltar su perfil) la persona se queda sin Howler y sin saber por qué.
 */
export interface Started { /** `true` si el proceso lanzado ya terminó. */ exited: () => boolean }

export interface RelaunchDeps {
  start: () => Started;
  /** ¿Responde Howler en su puerto? */
  isUp: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface RelaunchOptions { tries?: number; waitMs?: number; stepMs?: number }

/**
 * Lanza Howler y espera a que responda. Si el proceso se cierra sin responder, lo lanza de nuevo (hasta `tries` veces); si sigue vivo pero
 * no responde, no lanza otro encima (se pelearían por el puerto) y lo deja anotado.
 */
export async function relaunchHowler(d: RelaunchDeps, o: RelaunchOptions = {}): Promise<boolean> {
  const tries = o.tries ?? 3, waitMs = o.waitMs ?? 25_000, stepMs = o.stepMs ?? 1000;
  for (let t = 1; t <= tries; t++) {
    d.log(`Abriendo Howler (intento ${t} de ${tries})`);
    let child: Started;
    try { child = d.start(); } catch (e) { d.log(`No se pudo lanzar Howler: ${e instanceof Error ? e.message : String(e)}`); await d.sleep(stepMs); continue; }
    for (let waited = 0; waited < waitMs; waited += stepMs) {
      await d.sleep(stepMs);
      if (await d.isUp()) { d.log('Howler responde: actualización terminada'); return true; }
      if (child.exited()) { d.log('Howler se cerró nada más abrirse'); break; }
    }
    if (!child.exited()) { d.log('Howler sigue abierto pero no responde; no se lanza otro encima'); return false; }
  }
  d.log('No se consiguió abrir Howler tras la actualización');
  return false;
}
