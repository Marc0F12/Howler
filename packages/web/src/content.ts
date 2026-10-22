import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { cleanTrackId, type ContentCardDto, type ContentNamesDto } from '@howler/shared';
import { pretty } from './format';

/**
 * Nombres reales de coches y circuitos (los que lee el servidor de la instalación de AC) e imágenes de vista previa.
 * Un solo almacén compartido por toda la web: se pide una vez y se vuelve a pedir, como mucho cada 10 s, cuando
 * aparece algo que no estaba (un coche nuevo en la base de datos).
 */
let names: ContentNamesDto = { cars: {}, tracks: {} };
let loading = false;
let lastFetch = 0;
const listeners = new Set<() => void>();

function refresh() {
  if (loading || Date.now() - lastFetch < 10_000) return;
  loading = true;
  lastFetch = Date.now();
  fetch('/api/content/names')
    .then((r) => (r.ok ? (r.json() as Promise<ContentNamesDto>) : Promise.reject(new Error(String(r.status)))))
    .then((d) => { if (JSON.stringify(d) !== JSON.stringify(names)) { names = d; listeners.forEach((l) => l()); } }) // solo avisa si algo cambió
    .catch(() => { /* sin nombres reales: se usa el id formateado */ })
    .finally(() => { loading = false; });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => names;

export const carImage = (id: string) => `/api/content/cars/${encodeURIComponent(id)}/preview`;
export const trackOutline = (track: string, layout: string) => `/api/content/tracks/${encodeURIComponent(cleanTrackId(track))}/outline?layout=${encodeURIComponent(layout)}`;
export const trackImage = (track: string, layout: string) => `/api/content/tracks/${encodeURIComponent(cleanTrackId(track))}/preview?layout=${encodeURIComponent(layout)}`;

/** Funciones para nombrar coches y circuitos: el nombre real si se conoce, y si no el identificador legible. */
export function useContentNames() {
  const current = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { refresh(); }, []);
  const carName = useCallback((id: string) => {
    const n = current.cars[id]?.name;
    if (!n) refresh();
    return n ?? pretty(id);
  }, [current]);
  const trackName = useCallback((rawTrack: string, layout: string) => {
    const track = cleanTrackId(rawTrack);
    const n = current.tracks[`${track}|${layout}`]?.name;
    if (!n) refresh();
    return n ?? `${pretty(track)}${layout ? ` (${pretty(layout)})` : ''}`;
  }, [current]);
  return { carName, trackName };
}

// Fichas de coches y circuitos (nombre, marca/país, especificaciones) leídas de los archivos de AC. Se piden una vez y se recuerdan.
const cards = new Map<string, Promise<ContentCardDto | null>>();
function loadCard(url: string): Promise<ContentCardDto | null> {
  let p = cards.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? (r.json() as Promise<ContentCardDto>) : null)).catch(() => null);
    cards.set(url, p);
  }
  return p;
}
/** Ficha de AC para una tarjeta; `null` mientras carga o si ese contenido no está instalado. */
export function useContentCard(kind: 'car' | 'track', id: string | undefined, layout = ''): ContentCardDto | null {
  const url = id ? (kind === 'car' ? `/api/content/cars/${encodeURIComponent(id)}/card` : `/api/content/tracks/${encodeURIComponent(cleanTrackId(id))}/card?layout=${encodeURIComponent(layout)}`) : null;
  const [card, setCard] = useState<ContentCardDto | null>(null);
  useEffect(() => {
    let live = true;
    setCard(null);
    if (url) void loadCard(url).then((c) => { if (live) setCard(c); });
    return () => { live = false; };
  }, [url]);
  return card;
}
