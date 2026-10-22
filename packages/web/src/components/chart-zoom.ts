/** Tramo visible de una gráfica: índices de muestra [desde, hasta] (con decimales). */
export type View = [number, number];

/** Muestras mínimas visibles al acercar al máximo. */
const MIN_SPAN = 6;

/** Todo el recorrido de `n` muestras. */
export const fullView = (n: number): View => [0, Math.max(1, n - 1)];

/**
 * Acerca (`factor` > 1) o aleja (< 1) el tramo visible alrededor de un punto: `focus` (0..1) es dónde está ese punto dentro de lo visible
 * y se queda quieto bajo el puntero. Nunca sale de 0..n-1 ni baja de MIN_SPAN muestras.
 */
export function zoomView(view: View, n: number, factor: number, focus: number): View {
  const full = Math.max(1, n - 1);
  const span = Math.min(full, Math.max(Math.min(MIN_SPAN, full), (view[1] - view[0]) / factor));
  const at = view[0] + (view[1] - view[0]) * focus;
  return panView([at - span * focus, at - span * focus + span], n, 0);
}

/** Desplaza el tramo visible `dv` muestras sin salirse del recorrido. */
export function panView(view: View, n: number, dv: number): View {
  const full = Math.max(1, n - 1);
  const span = view[1] - view[0];
  const start = Math.min(full - span, Math.max(0, view[0] + dv));
  return [start, start + span];
}

/**
 * Seguir el recorrido con zoom: si el cursor de reproducción (`at`, índice de punto) sale del tramo visible o pasa de la posición
 * `anchor` (fracción del tramo), devuelve el tramo desplazado para que el cursor quede en `anchor`; si no hay que mover nada, null.
 * Sin zoom (se ve todo) no hace nada.
 */
export function followView(view: View, n: number, at: number, anchor = 0.45): View | null {
  const span = view[1] - view[0];
  if (span >= Math.max(1, n - 1) - 1e-6) return null;
  if (at >= view[0] && at <= view[0] + span * anchor) return null;
  const start = at < view[0] ? at - span * 0.2 : at - span * anchor;
  const next = panView([start, start + span], n, 0);
  return Math.abs(next[0] - view[0]) < 1e-6 ? null : next;
}
