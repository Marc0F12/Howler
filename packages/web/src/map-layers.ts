import { useSyncExternalStore } from 'react';

/** Opacidad (0-100) de cada capa del fondo del mapa. `null` = el visitante aún no ha elegido: manda el automático. */
export interface MapLayers { road: number; image: number }

const KEY = 'howler.map.layers';
const listeners = new Set<() => void>();

function read(): MapLayers | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MapLayers> | null;
    if (!o || typeof o.road !== 'number' || typeof o.image !== 'number') return null;
    return { road: Math.min(100, Math.max(0, o.road)), image: Math.min(100, Math.max(0, o.image)) };
  } catch { return null; }
}

let state = read();

export function setMapLayers(next: MapLayers | null) {
  state = next;
  try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  listeners.forEach((l) => l());
}

/** Capas del fondo del mapa elegidas por el visitante (compartidas por todos los mapas de la web). */
export function useMapLayers(): MapLayers | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => null);
}
