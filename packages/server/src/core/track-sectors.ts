import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrossLine } from './sector-timer';
import { timingLayout } from './track-geometry';

export const THIRDS = [1 / 3, 2 / 3];

/** Fronteras de n sectores iguales. */
export const equalSplit = (n: number) => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);

/** Fronteras (posición en spline) de un sections.ini de AC: el comienzo de cada sección salvo la primera. */
export function parseSections(ini: string): number[] | null {
  const ins: number[] = [];
  let inSection = false;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[SECTION_\d+\]/i.test(line)) inSection = true;
    else if (line.startsWith('[')) inSection = false;
    else if (inSection) {
      const m = /^IN\s*=\s*([\d.]+)/i.exec(line);
      if (m) ins.push(Number(m[1]));
    }
  }
  const bounds = ins.filter((p) => p > 0.001 && p < 0.999).sort((a, b) => a - b);
  return bounds.length >= 1 ? bounds : null;
}

export interface SectorSources {
  /** Carpetas "content/tracks" donde buscar el circuito (instalación de AC y/o servidor). */
  trackDirs: string[];
  /** Fronteras fijadas a mano por circuito en howler.config.json. */
  /** Un número N = N sectores iguales; una lista = fronteras exactas (0..1). */
  overrides: Record<string, number | number[]>;
}

export interface SectorLayout {
  bounds: number[];
  /** Posición en spline de la línea de meta. */
  origin: number;
  /** Líneas reales del circuito (si se leyeron de él): permiten medir el cruce exacto. */
  lines?: CrossLine[];
  source: 'config' | 'sections.ini' | 'líneas del circuito' | 'tercios';
}

/** Orden: ajuste manual > sections.ini > líneas AC_TIME del propio circuito > tercios iguales. */
export function sectorBoundaries(track: string, layout: string, src: SectorSources): SectorLayout {
  const key = layout ? `${track}/${layout}` : track;
  const manual = src.overrides[key] ?? src.overrides[track];
  if (typeof manual === 'number') return { bounds: equalSplit(manual), origin: 0, source: 'config' };
  if (manual && manual.length >= 1) return { bounds: [...manual].sort((a, b) => a - b), origin: 0, source: 'config' };
  for (const dir of src.trackDirs) {
    const base = layout ? join(dir, track, layout) : join(dir, track);
    const file = join(base, 'data', 'sections.ini');
    if (existsSync(file)) {
      const parsed = parseSections(readFileSync(file, 'utf8'));
      if (parsed) return { bounds: parsed, origin: 0, source: 'sections.ini' };
    }
  }
  for (const dir of src.trackDirs) {
    const trackDir = join(dir, track);
    if (!existsSync(trackDir)) continue;
    try {
      const t = timingLayout(trackDir, layout);
      if (t && t.bounds.length >= 1) return { bounds: t.bounds, origin: t.origin, lines: t.lines, source: 'líneas del circuito' };
    } catch (e) {
      console.warn(`[howler] no se pudieron leer las líneas de ${track}:`, (e as Error).message);
    }
  }
  return { bounds: THIRDS, origin: 0, source: 'tercios' };
}
