import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTrackId, folderKey, type MapAffine, type MapInfoDto } from '@howler/shared';
import { fitMap, pngMask } from './map-fit';
import type { TrackRoadDto } from '@howler/shared';
import { readSpline } from './track-geometry';

/** Nombre de carpeta seguro (circuito, layout, coche, skin): letras, cifras, espacios, «_», «-» y «.», pero sin empezar por punto ni espacio (nada de «..»; hay carpetas de mods con espacios). Vacío vale (layout sin nombre). */
export const SAFE_NAME = /^(?![. ])[A-Za-z0-9_. -]*$/;

/** Lee data/map.ini de AC: tamaño de la imagen y desplazamientos para convertir coordenadas del mundo a píxeles. */
export function parseMapIni(ini: string): Omit<MapInfoDto, 'track' | 'layout'> | null {
  const num = (key: string) => {
    const m = new RegExp(String.raw`^\s*${key}\s*=\s*(-?[\d.]+)`, 'mi').exec(ini);
    return m ? Number(m[1]) : null;
  };
  const width = num('WIDTH'), height = num('HEIGHT'), xOffset = num('X_OFFSET'), zOffset = num('Z_OFFSET');
  if (width == null || height == null || xOffset == null || zOffset == null) return null;
  return { width, height, xOffset, zOffset, scale: num('SCALE_FACTOR') || 1, margin: num('MARGIN') ?? 0 };
}

/** Ancho y alto de un PNG leyendo su cabecera (IHDR); null si no lo parece. */
export function pngSize(file: string): { w: number; h: number } | null {
  try {
    const fd = openSync(file, 'r'); // solo se leen los 24 bytes de la cabecera, no toda la imagen
    try {
      const head = Buffer.alloc(24);
      if (readSync(fd, head, 0, 24, 0) < 24 || head.readUInt32BE(0) !== 0x89504e47) return null;
      return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    } finally { closeSync(fd); }
  } catch { return null; }
}

/**
 * Margen que hay que sumar al píxel. En la mayoría de circuitos la imagen mide exactamente WIDTH×HEIGHT y X_OFFSET ya incluye el
 * margen (sumarlo otra vez desplaza y estira el mapa); en otros la imagen mide WIDTH+2·MARGIN y ahí sí hay que sumarlo.
 * Se decide midiendo la imagen real; si no se puede medir, se usa el MARGIN del ini.
 */
export function effectiveMargin(info: { width: number; height: number; margin: number }, img: { w: number; h: number } | null): number {
  if (!img) return info.margin;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  if (info.margin > 0 && near(img.w, info.width + 2 * info.margin) && near(img.h, info.height + 2 * info.margin)) return info.margin;
  if (near(img.w, info.width) && near(img.h, info.height)) return 0;
  return info.margin;
}

export interface TrackMap {
  info: MapInfoDto;
  imagePath: string;
  /** El circuito como línea vectorial (null si no hay línea de IA). */
  road: () => TrackRoadDto | null;
}

/** Carpeta hija por nombre exacto o equivalente («Euphoria Hillside Park» ≈ euphoria_hillside_park); null si no existe. */
function child(parent: string, name: string): string | null {
  if (existsSync(join(parent, name))) return name;
  try {
    const key = folderKey(name);
    return key ? readdirSync(parent).find((n) => folderKey(n) === key) ?? null : null;
  } catch { return null; }
}

/** Transformación mundo → píxel que describe el map.ini (con su margen efectivo). */
export function iniAffine(info: { xOffset: number; zOffset: number; scale: number; margin: number }): MapAffine {
  return [1 / info.scale, 0, info.xOffset / info.scale + info.margin, 0, 1 / info.scale, info.zOffset / info.scale + info.margin];
}

/** Línea de referencia de AC del circuito (ai/fast_lane.ai del layout o, si no hay, del circuito). */
function splineFor(trackDir: string, base: string) {
  for (const d of [base, trackDir]) {
    const f = join(d, 'ai', 'fast_lane.ai');
    if (existsSync(f)) { try { return readSpline(f); } catch { /* ilegible: sin autocalibrado */ } }
  }
  return null;
}

const fitCache = new Map<string, { affine: MapAffine; fit: 'ini' | 'fitted' } | null>();

/** Calibra el mapa contra su imagen (en caché mientras no cambie el archivo). Null si no se puede (sin línea o imagen no legible). */
function calibrate(trackDir: string, base: string, imagePath: string, info: Omit<MapInfoDto, 'affine' | 'fit'>) {
  let key = imagePath;
  try { key += `|${statSync(imagePath).mtimeMs}|${info.xOffset}|${info.zOffset}|${info.scale}|${info.margin}`; } catch { return null; }
  if (fitCache.has(key)) return fitCache.get(key)!;
  let out: { affine: MapAffine; fit: 'ini' | 'fitted' } | null = null;
  try {
    const mask = pngMask(imagePath), spline = splineFor(trackDir, base);
    const r = mask && spline ? fitMap(mask, spline, iniAffine(info)) : null;
    if (r && r.source !== 'unreliable') out = { affine: r.affine, fit: r.source };
  } catch { out = null; }
  fitCache.set(key, out);
  return out;
}

const roadCache = new Map<string, TrackRoadDto | null>();

/**
 * El circuito como línea vectorial (la línea de referencia de AC, en metros del mundo) con un ancho estimado: se dibuja
 * a cualquier zoom sin pixelarse y coincide con las trayectorias, que van en las mismas coordenadas. El ancho sale de la
 * imagen del mapa (superficie de carretera / longitud de la línea), acotado a un rango razonable.
 */
function roadOf(trackDir: string, base: string, imagePath: string, info: MapInfoDto): TrackRoadDto | null {
  let key = imagePath;
  try { key += `|${statSync(imagePath).mtimeMs}`; } catch { return null; }
  if (roadCache.has(key)) return roadCache.get(key)!;
  let out: TrackRoadDto | null = null;
  try {
    const spline = splineFor(trackDir, base);
    if (spline) {
      const n = spline.x.length, step = Math.max(1, Math.ceil(n / 2500));
      const points: number[] = [];
      for (let i = 0; i < n; i += step) points.push(Math.round(spline.x[i]! * 10) / 10, Math.round(spline.z[i]! * 10) / 10);
      if (Math.hypot(spline.x[0]! - spline.x[n - 1]!, spline.z[0]! - spline.z[n - 1]!) < 150) points.push(points[0]!, points[1]!);
      let widthM = 12;
      const mask = pngMask(imagePath);
      const a = info.affine ?? iniAffine(info);
      const det = Math.abs(a[0] * a[4] - a[1] * a[3]);
      if (mask && det > 0 && spline.total > 0) {
        let count = 0;
        for (let i = 0; i < mask.inside.length; i++) if (mask.inside[i]) count++;
        widthM = (count * mask.f * mask.f) / det / spline.total;
      }
      out = { points, widthM: Math.round(Math.min(30, Math.max(6, widthM)) * 10) / 10 };
    }
  } catch { out = null; }
  roadCache.set(key, out);
  return out;
}

/** Busca la imagen del mapa y su map.ini en las carpetas de circuitos de AC y calibra la transformación contra la imagen. */
export function findTrackMap(rawTrack: string, rawLayout: string, trackDirs: string[]): TrackMap | null {
  const track = cleanTrackId(rawTrack);
  if (!track || !SAFE_NAME.test(track) || !SAFE_NAME.test(rawLayout)) return null;
  for (const dir of trackDirs) {
    const t = child(dir, track);
    const layout = t && rawLayout ? child(join(dir, t), rawLayout) : rawLayout;
    if (t == null || layout == null) continue;
    const base = layout ? join(dir, t, layout) : join(dir, t);
    const imagePath = join(base, 'map.png');
    const ini = join(base, 'data', 'map.ini');
    if (!existsSync(imagePath) || !existsSync(ini)) continue;
    const parsed = parseMapIni(readFileSync(ini, 'utf8'));
    if (!parsed) continue;
    const info: MapInfoDto = { track: t, layout, ...parsed, margin: effectiveMargin(parsed, pngSize(imagePath)) };
    const cal = calibrate(join(dir, t), base, imagePath, info);
    if (cal) {
      info.affine = cal.affine; info.fit = cal.fit;
      const img = pngSize(imagePath); // la transformación está en píxeles reales de la imagen
      if (img) { info.width = img.w; info.height = img.h; info.margin = 0; }
    }
    return { info, imagePath, road: () => roadOf(join(dir, t), base, imagePath, info) };
  }
  return null;
}
