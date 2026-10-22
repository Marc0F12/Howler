import { speedText } from '../prefs';
import { MapBackdrop, MapLayersControl } from './MapBackdrop';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarPositionDto, MapInfoDto, OnlineDriver, PositionsDto } from '@howler/shared';
import { imageSize, toPixel } from '../map-geometry';
import { pretty } from '../format';
import { t } from '../i18n';
import { Marker } from './markers';

/**
 * El servidor manda posiciones cada ~100 ms, con algo de irregularidad. El marcador no salta a cada paquete: persigue
 * la última posición recibida (más la velocidad estimada, hasta MAX_LEAD_MS) con un suavizado exponencial, así
 * un paquete tardío o doble no se nota como tirón.
 */
const SMOOTH_MS = 90;
const MAX_LEAD_MS = 220;
/** Un salto mayor que esto (metros) es un teletransporte (boxes, reinicio): el marcador salta en vez de deslizarse. */
const TELEPORT_M = 150;

interface Tween {
  /** Posición dibujada ahora, última posición recibida y su velocidad (m/ms) y momento de llegada. */
  x: number; z: number; tx: number; tz: number; vx: number; vz: number; t0: number;
}


type MapState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; info: MapInfoDto };

/** Mapa del circuito con los coches en pista moviéndose en directo, y una leyenda para saber quién es cada marcador. */
export function LiveMap({ track, layout, online }: { track: string; layout: string; online: OnlineDriver[] }) {
  const [map, setMap] = useState<MapState>({ status: 'loading' });
  const [cars, setCars] = useState<CarPositionDto[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const nodes = useRef(new Map<number, SVGGElement>());
  const tweens = useRef(new Map<number, Tween>());
  const speedLabels = useRef(new Map<number, HTMLElement>());
  const mapRef = useRef<MapInfoDto | null>(null);

  // Información del mapa del circuito actual.
  useEffect(() => {
    let cancelled = false;
    setMap({ status: 'loading' });
    fetch(`/api/map?${new URLSearchParams({ track, layout })}`)
      .then((r) => (r.ok ? (r.json() as Promise<MapInfoDto>) : Promise.reject(new Error(String(r.status)))))
      .then((info) => { if (!cancelled) { mapRef.current = info; setMap({ status: 'ready', info }); } })
      .catch(() => { if (!cancelled) { mapRef.current = null; setMap({ status: 'missing' }); } });
    return () => { cancelled = true; };
  }, [track, layout]);

  // Posiciones en directo.
  useEffect(() => {
    if (map.status !== 'ready') return;
    const es = new EventSource('/api/positions');
    es.onmessage = (m) => {
      const info = mapRef.current;
      if (!info) return;
      const data = JSON.parse(m.data) as PositionsDto;
      const now = performance.now();
      const seen = new Set<number>();
      for (const c of data.cars) {
        seen.add(c.carId);
        const tw = tweens.current.get(c.carId);
        if (!tw) {
          tweens.current.set(c.carId, { x: c.x, z: c.z, tx: c.x, tz: c.z, vx: 0, vz: 0, t0: now });
        } else {
          const dt = Math.max(1, now - tw.t0);
          const jump = Math.hypot(c.x - tw.tx, c.z - tw.tz) > TELEPORT_M;
          // La velocidad se suaviza entre paquetes para que un intervalo raro no la dispare.
          const vx = jump ? 0 : tw.vx * 0.5 + ((c.x - tw.tx) / dt) * 0.5, vz = jump ? 0 : tw.vz * 0.5 + ((c.z - tw.tz) / dt) * 0.5;
          tweens.current.set(c.carId, { x: jump ? c.x : tw.x, z: jump ? c.z : tw.z, tx: c.x, tz: c.z, vx, vz, t0: now });
        }
        const label = speedLabels.current.get(c.carId);
        if (label) label.textContent = speedText(c.speedKmh);
      }
      for (const id of [...tweens.current.keys()]) if (!seen.has(id)) tweens.current.delete(id);
      // Solo se vuelve a pintar React cuando cambia QUIÉN está en pista, no en cada posición.
      setCars((prev) => (prev.length === data.cars.length && prev.every((p, i) => p.carId === data.cars[i]!.carId) ? prev : data.cars));
    };
    return () => es.close();
  }, [map.status]);

  // Animación: mueve los marcadores directamente en el DOM, sin pasar por React, a la frecuencia de la pantalla.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = () => {
      const info = mapRef.current;
      const now = performance.now();
      const k = 1 - Math.exp(-(now - last) / SMOOTH_MS);
      last = now;
      if (info) {
        for (const [id, tw] of tweens.current) {
          const node = nodes.current.get(id);
          if (!node) continue;
          const lead = Math.min(now - tw.t0, MAX_LEAD_MS);
          tw.x += (tw.tx + tw.vx * lead - tw.x) * k;
          tw.z += (tw.tz + tw.vz * lead - tw.z) * k;
          const { px, py } = toPixel(info, tw.x, tw.z);
          node.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const names = useMemo(() => new Map(online.map((o) => [o.carId, o])), [online]);

  if (map.status === 'loading') return <p className="empty">{t('Cargando el mapa…')}</p>;
  if (map.status === 'missing') {
    return <p className="empty">{t('No encuentro el mapa de este circuito en tu instalación de Assetto Corsa, así que no puedo dibujar a los pilotos.')}</p>;
  }
  const { info } = map;
  const size = imageSize(info);
  const r = Math.max(size.w, size.h) / 85;

  return (
    <div className="livemap">
      <div className="livemap-tools"><MapLayersControl track={track} layout={layout} /></div>
      <svg className="livemap-svg" viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={t('Mapa de {track} con los pilotos en pista', { track })}>
        <MapBackdrop map={map.info} track={track} layout={layout} opacity={0.9} />
        {cars.map((c) => (
          <g
            key={c.carId}
            ref={(el) => { if (el) nodes.current.set(c.carId, el); else nodes.current.delete(c.carId); }}
            transform={`translate(${toPixel(info, c.x, c.z).px} ${toPixel(info, c.x, c.z).py})`}
            onMouseEnter={() => setHighlight(c.carId)}
            onMouseLeave={() => setHighlight(null)}
          >
            <Marker carId={c.carId} r={highlight === c.carId ? r * 1.25 : r} highlighted={highlight === c.carId} />
          </g>
        ))}
      </svg>

      {cars.length === 0 ? (
        <p className="livemap-empty">{t('No hay nadie en pista ahora mismo.')}</p>
      ) : (
        <ul className="legend" aria-label={t('Leyenda de pilotos')}>
          {cars.map((c) => {
            const who = names.get(c.carId);
            return (
              <li
                key={c.carId}
                className={highlight === c.carId ? 'on' : ''}
                onMouseEnter={() => setHighlight(c.carId)}
                onMouseLeave={() => setHighlight(null)}
              >
                <svg viewBox="-14 -14 28 28" width="26" height="26" aria-hidden="true"><Marker carId={c.carId} r={12} /></svg>
                <span className="legend-name">{who?.name ?? t('Coche {n}', { n: c.carId + 1 })}</span>
                <span className="legend-car">{who ? pretty(who.car) : ''}</span>
                <span className="legend-speed" ref={(el) => { if (el) speedLabels.current.set(c.carId, el); else speedLabels.current.delete(c.carId); }}>
                  {speedText(c.speedKmh)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

