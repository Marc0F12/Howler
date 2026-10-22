import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { MapInfoDto, TrackRoadDto } from '@howler/shared';
import { t } from '../i18n';
import { imageSize, toPixel } from '../map-geometry';
import { setMapLayers, useMapLayers, type MapLayers } from '../map-layers';

const cache = new Map<string, Promise<TrackRoadDto | null>>();

/** El circuito como línea vectorial (la de AC); null si el servidor no la tiene. Una sola petición por circuito. */
function loadRoad(track: string, layout: string): Promise<TrackRoadDto | null> {
  const key = `${track}|${layout}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/map/road?${new URLSearchParams({ track, layout })}`).then((r) => (r.ok ? (r.json() as Promise<TrackRoadDto>) : null)).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/** Trayectorias reales para comprobar que la línea del circuito las acompaña (x, z en metros del mundo). */
export interface RoadProbe { x: number[]; z: number[] }

/**
 * ¿La línea de AC encaja con por dónde conducen de verdad? Una línea de IA mal puesta (de otro layout, desplazada...) no sirve como
 * carretera: se exige que casi todos los puntos de las trayectorias estén a un ancho de carretera de ella.
 */
export function roadFits(road: TrackRoadDto, probe: RoadProbe[]): boolean {
  const pts = road.points, n = pts.length / 2;
  if (n < 10) return false;
  const limit = road.widthM * 1.1;
  let total = 0, near = 0;
  for (const lap of probe) {
    const step = Math.max(1, Math.floor(lap.x.length / 120));
    for (let i = 0; i < lap.x.length; i += step) {
      const px = lap.x[i]!, pz = lap.z[i]!;
      let best = Infinity;
      for (let k = 0; k + 1 < n; k++) {
        const ax = pts[2 * k]!, az = pts[2 * k + 1]!, dx = pts[2 * k + 2]! - ax, dz = pts[2 * k + 3]! - az, l2 = dx * dx + dz * dz;
        const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
        const d = Math.hypot(px - ax - u * dx, pz - az - u * dz);
        if (d < best) best = d;
      }
      total++;
      if (best <= limit) near++;
    }
  }
  return total === 0 || near / total >= 0.85;
}

export type RoadStatus = 'loading' | 'none' | 'ok' | 'mismatch';

/** Estado de la línea vectorial de un circuito: cargando, no existe, existe, o existe pero no encaja con las trayectorias. */
export function useRoad(track: string, layout: string, probe?: RoadProbe[]): { road: TrackRoadDto | null; status: RoadStatus } {
  const [road, setRoad] = useState<TrackRoadDto | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRoad(undefined);
    void loadRoad(track, layout).then((r) => { if (live) setRoad(r); });
    return () => { live = false; };
  }, [track, layout]);
  const fits = useMemo(() => !road || !probe || roadFits(road, probe), [road, probe]);
  if (road === undefined) return { road: null, status: 'loading' };
  if (!road) return { road: null, status: 'none' };
  return { road, status: fits ? 'ok' : 'mismatch' };
}

/** Capas que se dibujan: lo elegido por el visitante o, si no ha elegido, la línea (o la imagen si no existe o no encaja). */
export function effectiveLayers(chosen: MapLayers | null, status: RoadStatus, imageOpacity: number): MapLayers {
  if (chosen) return { road: status === 'ok' || status === 'mismatch' ? chosen.road : 0, image: chosen.image };
  return status === 'ok' ? { road: 100, image: 0 } : { road: 0, image: imageOpacity };
}

/**
 * Fondo del mapa con dos capas superponibles: la línea del circuito como vector (nítida con cualquier zoom y exactamente en las
 * mismas coordenadas que las trayectorias, como hacen los HUD de AC) y la imagen del mapa. Mientras se decide no se pinta nada.
 */
export function MapBackdrop({ map, track, layout, opacity = 0.85, probe }: { map: MapInfoDto; track: string; layout: string; opacity?: number; probe?: RoadProbe[] }) {
  const { road, status } = useRoad(track, layout, probe);
  const chosen = useMapLayers();
  if (status === 'loading') return null;
  const layers = effectiveLayers(chosen, status, Math.round(opacity * 100));

  const size = imageSize(map);
  let line: ReactElement | null = null;
  if (road && layers.road > 0) {
    const a = map.affine ?? [1 / map.scale, 0, 0, 0, 1 / map.scale, 0];
    const pxPerM = Math.sqrt(Math.abs(a[0] * a[4] - a[1] * a[3]));
    const pts: string[] = [];
    for (let i = 0; i + 1 < road.points.length; i += 2) {
      const q = toPixel(map, road.points[i]!, road.points[i + 1]!);
      pts.push(`${q.px.toFixed(1)},${q.py.toFixed(1)}`);
    }
    const w = road.widthM * pxPerM, k = layers.road / 100;
    line = (
      <g fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        <polyline points={pts.join(' ')} stroke="var(--text)" strokeOpacity={0.18 * k} strokeWidth={w + Math.max(1, w * 0.12)} />
        <polyline points={pts.join(' ')} stroke="var(--text)" strokeOpacity={0.34 * k} strokeWidth={w} />
      </g>
    );
  }
  return (
    <>
      {layers.image > 0 && <image href={`/api/map/image?${new URLSearchParams({ track, layout })}`} width={size.w} height={size.h} opacity={layers.image / 100} />}
      {line}
    </>
  );
}

/** Botón «Capas» con las dos capas del fondo del mapa: cada una se enciende y se superpone con su deslizador de opacidad. */
export function MapLayersControl({ track, layout, probe }: { track: string; layout: string; probe?: RoadProbe[] }) {
  const { status } = useRoad(track, layout, probe);
  const chosen = useMapLayers();
  const layers = effectiveLayers(chosen, status, 85);
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<MapLayers>) => setMapLayers({ ...layers, ...patch });
  const roadOff = status === 'none';
  return (
    <div className="map-layers">
      <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)} title={t('Capas del fondo del mapa')}>{t('Capas')}</button>
      {open && (
        <div className="map-layers-pop" role="group" aria-label={t('Capas del fondo del mapa')}>
          <label className={`map-layer ${roadOff ? 'off' : ''}`}>
            <span className="map-layer-name">{t('Línea del circuito')}</span>
            <input type="range" min={0} max={100} step={5} value={roadOff ? 0 : layers.road} disabled={roadOff} onChange={(e) => set({ road: Number(e.target.value) })} aria-label={t('Opacidad de la línea del circuito')} />
            <span className="num map-layer-val">{roadOff ? t('no disponible') : `${layers.road}%`}</span>
          </label>
          <label className="map-layer">
            <span className="map-layer-name">{t('Imagen del mapa')}</span>
            <input type="range" min={0} max={100} step={5} value={layers.image} onChange={(e) => set({ image: Number(e.target.value) })} aria-label={t('Opacidad de la imagen del mapa')} />
            <span className="num map-layer-val">{layers.image}%</span>
          </label>
          {status === 'mismatch' && <p className="note">{t('La línea de este circuito no encaja con las trayectorias: puede estar mal puesta.')}</p>}
          <div className="map-layers-foot">
            <button type="button" className="btn small" onClick={() => setMapLayers(null)}>{t('Automático')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
