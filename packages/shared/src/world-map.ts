import { parseGeotags } from './sun';

/** Mapa del mundo: dónde está cada circuito jugado y quién tiene sus mejores tiempos. */

export interface WorldTopDto { driverId: number; driverName: string; lapMs: number; car: string }

export interface WorldPinDto {
  track: string;
  layout: string;
  lat: number;
  lon: number;
  /** Ubicado a mano por el administrador (en vez de por el `ui_track.json` del circuito). */
  manual: boolean;
  /** Vueltas válidas o no, de todos los pilotos. */
  laps: number;
  /** Los 3 mejores tiempos (un piloto una sola vez, con su mejor coche). */
  top: WorldTopDto[];
}

export interface WorldMapDto {
  /** El administrador permite mapas de satélite/calles (el navegador del visitante contacta con un tercero). */
  online: boolean;
  pins: WorldPinDto[];
}

/** Ajustes guardados en `howler.config.json` (`worldMap`). */
export interface WorldMapConfig {
  online: boolean;
  /** Ubicaciones manuales por circuito (`circuito|layout`). */
  manual: Record<string, { lat: number; lon: number }>;
}

export interface WorldPlayedDto { track: string; layout: string; lat: number | null; lon: number | null; source: 'manual' | 'content' | null }
export interface WorldMapAdminDto { online: boolean; played: WorldPlayedDto[] }

export const worldKey = (track: string, layout: string): string => `${track}|${layout}`;

/**
 * Lee unas coordenadas escritas a mano: «41.57, 2.26», «41.57 N 2.26 E», «41°34'12" N, 2°15'40" E»…
 * (lo que se copia de Google Maps o Wikipedia). Null si no se entienden o no caben en el planeta.
 */
export function parseCoordText(text: string): { lat: number; lon: number } | null {
  const t = text.trim();
  if (!t) return null;
  const bySep = t.split(/\s*[,;]\s*/);
  if (bySep.length === 2) return parseGeotags(bySep);
  // «41.57 N 2.26 E»: se parte justo después de la primera letra de hemisferio
  const m = /^(.*?[NSns])\s+(.+)$/.exec(t);
  if (m) return parseGeotags([m[1], m[2]]);
  // «41.57 2.26»: dos números sueltos
  const nums = t.split(/\s+/);
  return nums.length === 2 ? parseGeotags(nums) : null;
}

/** Sitios que encajan con un circuito sin coordenadas (búsqueda por nombre). */
export interface WorldSuggestionDto { track: string; layout: string; query: string; /** Poco seguro: coincide solo el nombre suelto o la ciudad, no el circuito. */ approx: boolean; candidates: { label: string; lat: number; lon: number }[]; error?: string }
