import { useCallback, useState } from 'react';

/** Orden guardado + los que no estén (gráficas nuevas) al final, sin repetidos ni desconocidos. */
export function normalizeOrder(saved: unknown, defaults: readonly string[]): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string' && known.has(id) && !out.includes(id)) out.push(id);
  for (const id of defaults) if (!out.includes(id)) out.push(id);
  return out;
}

/** Intercambia de sitio dos elementos de la lista (si alguno no está, no cambia nada). */
export function swapInOrder(order: string[], a: string, b: string): string[] {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0 || i === j) return order;
  const next = [...order];
  next[i] = b;
  next[j] = a;
  return next;
}

/**
 * Orden de las gráficas que elige cada visitante (flechas arriba/abajo en cada gráfica). Se recuerda solo en este navegador:
 * no es un ajuste de la web ni del panel.
 */
export function useChartOrder(storageKey: string, defaults: readonly string[]) {
  const [order, setOrder] = useState<string[]>(() => {
    try { return normalizeOrder(JSON.parse(localStorage.getItem(storageKey) ?? 'null'), defaults); } catch { return [...defaults]; }
  });
  const save = useCallback((next: string[]) => { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* sin almacenamiento */ } return next; }, [storageKey]);
  const swap = useCallback((a: string, b: string) => setOrder((o) => save(swapInOrder(o, a, b))), [save]);
  const reset = useCallback(() => setOrder(save([...defaults])), [save, defaults]);
  return { order, swap, reset, changed: order.join('|') !== defaults.join('|') };
}
