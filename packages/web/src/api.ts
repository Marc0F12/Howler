import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerDto, ChampionshipDto, ChampionshipSummaryDto, CarListItemDto, CarProfileDto, DriverListItemDto, RankingsDto, WorldMapDto, SessionHistoryPageDto, DriverProfileDto, TrackListItemDto, TrackProfileDto, ComboDto, LiveEvent, ProgressionStepDto, RecordDto, RecordsDto, ReplayDto, SessionLapDto, StatusDto, TimingDto } from '@howler/shared';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  status: () => get<StatusDto>('/api/status'),
  combos: (server = 'all') => get<ComboDto[]>(`/api/combos?server=${encodeURIComponent(server)}`),
  /** Servidores de los que hay tiempos (este y los de otros Howler vinculados); vacío si no hay ninguno vinculado. */
  servers: () => get<ServerDto[]>('/api/servers'),
  /** Clasificación de la sesión que enseña el Inicio (la en curso o, si no hay, la última). */
  timing: () => get<TimingDto>('/api/timing'),
  sessionLaps: (sessionId: number, driverId: number) => get<SessionLapDto[]>(`/api/sessions/${sessionId}/drivers/${driverId}/laps`),
  progression: (sessionId: number) => get<ProgressionStepDto[]>(`/api/sessions/${sessionId}/progression`),
  /** Las 3 mejores vueltas del circuito para los coches elegidos, con su traza para reproducirlas. */
  replay: (c: { track: string; layout: string; cars: string[] }) => {
    const q = new URLSearchParams({ track: c.track, layout: c.layout });
    for (const car of c.cars) q.append('car', car);
    return get<ReplayDto>(`/api/replay?${q}`);
  },
  // Fichas y listados
  sessions: (f: { track?: string; layout?: string; car?: string; type?: number; server?: string; driverId?: number; from?: string; to?: string; offset?: number; limit?: number }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
    return get<SessionHistoryPageDto>(`/api/sessions?${q}`);
  },
  sessionTiming: (id: number) => get<TimingDto>(`/api/sessions/${id}/timing`),
  rankings: (f: { track?: string; layout?: string; days?: number; top?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
    return get<RankingsDto>(`/api/rankings?${q}`);
  },
  world: () => get<WorldMapDto>('/api/world'),
  drivers: () => get<DriverListItemDto[]>('/api/drivers'),
  driver: (id: number) => get<DriverProfileDto>(`/api/drivers/${id}`),
  tracks: () => get<TrackListItemDto[]>('/api/tracks'),
  trackProfile: (track: string, layout: string) => get<TrackProfileDto>(`/api/tracks/profile?${new URLSearchParams({ track, layout })}`),
  cars: () => get<CarListItemDto[]>('/api/cars'),
  carProfile: (car: string) => get<CarProfileDto>(`/api/cars/profile?${new URLSearchParams({ car })}`),
  /** Mejor vuelta (con trayectoria) de cada piloto y coche elegidos (`idPiloto~coche`), de 2 a 3. */
  compare: (track: string, layout: string, picks: string[]) => {
    const q = new URLSearchParams({ track, layout });
    for (const p of picks) q.append('pick', p);
    return get<ReplayDto>(`/api/compare?${q}`);
  },
  championships: () => get<ChampionshipSummaryDto[]>('/api/championships'),
  championship: (id: number) => get<ChampionshipDto>(`/api/championships/${id}`),
  latestRecords: (limit = 6) => get<RecordDto[]>(`/api/records/latest?limit=${limit}`),
  /** Tabla de tiempos de un circuito; `cars` vacío = todos los coches jugados en él. */
  records: (c: { track: string; layout: string; cars: string[]; server?: string }) => {
    const q = new URLSearchParams({ track: c.track, layout: c.layout, server: c.server ?? 'all' });
    for (const car of c.cars) q.append('car', car);
    return get<RecordsDto>(`/api/records?${q}`);
  },
};

// Una sola conexión de eventos en directo para TODA la web. Antes cada componente abría la suya, y el navegador solo permite
// 6 conexiones simultáneas por servidor: con varios bloques en pantalla se agotaban y las demás peticiones (guardar, borrar...) se quedaban esperando.
const liveListeners = new Set<(e: LiveEvent) => void>();
let liveSource: EventSource | null = null;
export function subscribeLive(listener: (e: LiveEvent) => void): () => void {
  liveListeners.add(listener);
  if (!liveSource) {
    liveSource = new EventSource('/api/live');
    liveSource.onmessage = (m) => {
      let e: LiveEvent;
      try { e = JSON.parse(m.data) as LiveEvent; } catch { return; }
      liveListeners.forEach((l) => l(e));
    };
  }
  return () => {
    liveListeners.delete(listener);
    if (liveListeners.size === 0) { liveSource?.close(); liveSource = null; }
  };
}

/** Carga datos y los recarga cada vez que el servidor avisa por SSE (con un respaldo lento por si se cae). */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], when: (e: LiveEvent) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  // Solo vale la respuesta de la petición más reciente: si dos se cruzan (cambio de filtro + aviso en directo), la lenta y vieja no pisa a la nueva.
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    loadRef.current().then(
      (d) => { if (mine === seq.current) { setData(d); setError(null); } },
      (e: Error) => { if (mine === seq.current) setError(e.message); },
    );
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeLive((e) => { if (when(e)) refresh(); });
    const timer = setInterval(refresh, 30_000);
    return () => { unsubscribe(); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}
