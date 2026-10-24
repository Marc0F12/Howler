/** Matemáticas del mapa del mundo: proyección Web Mercator (la de los mapas en línea), vista, zoom y agrupación de chinchetas. */

export const TILE = 256;
export const MAX_LAT = 85.0511;
export const MAX_ZOOM = 18;

/** Coordenadas del mapa «a zoom 0»: el mundo mide TILE × TILE y se escala con 2^zoom. */
export function project(lat: number, lon: number): { x: number; y: number } {
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * (Math.PI / 180);
  return { x: ((lon + 180) / 360) * TILE, y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * TILE };
}

export function unproject(x: number, y: number): { lat: number; lon: number } {
  const n = Math.PI * (1 - (2 * y) / TILE);
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (x / TILE) * 360 - 180 };
}

/** La vista: el centro (en coordenadas de zoom 0) y el zoom (puede tener decimales). */
export interface View { cx: number; cy: number; zoom: number }

/** Zoom mínimo con el que el mundo cubre toda la ventana (así nunca se ve vacío por los bordes). */
export const minZoom = (w: number, h: number): number => Math.max(0, Math.log2(Math.max(w, h, 1) / TILE));

/** Deja la vista dentro del mundo: zoom permitido y centro sin enseñar nada fuera del mapa. */
export function clampView(v: View, w: number, h: number, maxZoom = MAX_ZOOM): View {
  const zoom = Math.max(minZoom(w, h), Math.min(maxZoom, v.zoom));
  const s = 2 ** zoom;
  const hx = w / 2 / s, hy = h / 2 / s;
  const clamp = (c: number, half: number) => (half * 2 >= TILE ? TILE / 2 : Math.max(half, Math.min(TILE - half, c)));
  return { zoom, cx: clamp(v.cx, hx), cy: clamp(v.cy, hy) };
}

export const toScreen = (v: View, w: number, h: number, p: { x: number; y: number }): { x: number; y: number } => {
  const s = 2 ** v.zoom;
  return { x: (p.x - v.cx) * s + w / 2, y: (p.y - v.cy) * s + h / 2 };
};

/** Zoom con el que cabe un rectángulo (en coordenadas de zoom 0), con margen, y su centro. */
export function fitBounds(b: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, padding = 90): View {
  const bw = Math.max(b.x1 - b.x0, 1e-6), bh = Math.max(b.y1 - b.y0, 1e-6);
  const zoom = Math.log2(Math.min((w - padding * 2) / bw, (h - padding * 2) / bh));
  return clampView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, zoom: Number.isFinite(zoom) ? Math.min(zoom, 10) : 2 }, w, h);
}

/** Zoom a partir del cual las chinchetas sueltas pasan a ser círculos con la imagen del circuito. */
export const IMAGE_ZOOM = 5;

/** `splitless`: aunque se acerque el zoom al máximo no se van a separar (mismo sitio, p. ej. dos trazados del mismo circuito). */
export interface Cluster<T> { x: number; y: number; items: T[]; splitless: boolean }

/**
 * Agrupa lo que queda a menos de `radius` píxeles en pantalla con el zoom actual (por orden, el primero de cada grupo manda).
 * Al acercar el zoom los grupos se deshacen solos, porque la distancia en pantalla crece.
 */
export function clusterPins<T>(items: { at: { x: number; y: number }; item: T }[], zoom: number, radius: number, maxZoom = MAX_ZOOM): Cluster<T>[] {
  const s = 2 ** zoom;
  const out: { x: number; y: number; items: T[]; ats: { x: number; y: number }[]; sx: number; sy: number }[] = [];
  for (const { at, item } of items) {
    const near = out.find((c) => Math.hypot((c.x - at.x) * s, (c.y - at.y) * s) < radius);
    if (near) {
      near.items.push(item);
      near.ats.push(at);
      // el centro del grupo es la media de sus miembros
      const n = near.items.length;
      near.sx += at.x; near.sy += at.y;
      near.x = near.sx / n; near.y = near.sy / n;
    } else out.push({ x: at.x, y: at.y, sx: at.x, sy: at.y, items: [item], ats: [at] });
  }
  const far = 2 ** maxZoom;
  return out.map(({ x, y, items: it, ats }) => ({
    x, y, items: it,
    splitless: it.length > 1 && ats.every((a) => ats.every((b) => Math.hypot(a.x - b.x, a.y - b.y) * far < radius)),
  }));
}

/** Teselas que cubren la ventana con el zoom entero `z` (las de fuera del mundo se saltan). */
export function visibleTiles(v: View, w: number, h: number, z: number): { x: number; y: number; z: number; left: number; top: number; size: number }[] {
  const n = 2 ** z;
  const s = 2 ** v.zoom;
  const size = (TILE / n) * s; // lado de una tesela en pantalla
  const x0 = Math.floor(((v.cx - w / 2 / s) / TILE) * n), x1 = Math.floor(((v.cx + w / 2 / s) / TILE) * n);
  const y0 = Math.floor(((v.cy - h / 2 / s) / TILE) * n), y1 = Math.floor(((v.cy + h / 2 / s) / TILE) * n);
  const out: { x: number; y: number; z: number; left: number; top: number; size: number }[] = [];
  for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(n - 1, x1); tx++) {
      out.push({ x: tx, y: ty, z, left: ((tx * TILE) / n - v.cx) * s + w / 2, top: ((ty * TILE) / n - v.cy) * s + h / 2, size });
    }
  }
  return out;
}
