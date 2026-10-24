import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatLapTime, type WorldPinDto } from '@howler/shared';
import { t } from '../i18n';
import { Avatar } from '../components/profile-parts';
import { trackHref } from '../components/links';
import { trackImage, useContentNames } from '../content';
import { loadLand } from './countries';
import { IMAGE_ZOOM, MAX_ZOOM, TILE, clampView, clusterPins, fitBounds, minZoom, project, toScreen, unproject, visibleTiles, type View } from './world-math';

export type MapMode = 'vector' | 'satellite' | 'streets';

const TILE_URL: Record<Exclude<MapMode, 'vector'>, (z: number, x: number, y: number) => string> = {
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  streets: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};
const ATTRIBUTION: Record<MapMode, string> = {
  vector: 'Natural Earth',
  satellite: 'Esri, Maxar, Earthstar Geographics',
  streets: '© OpenStreetMap contributors',
};
/** Con el mapa vectorial no tiene sentido acercarse más: el dibujo de los países no tiene más detalle. */
const VECTOR_MAX_ZOOM = 13;
const CLUSTER_PX = 46;

const keyOf = (p: WorldPinDto) => `${p.track}|${p.layout}`;

function PushPin() {
  return (
    <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true" className="wm-pushpin">
      <path d="M12 31 C12 31 2 19 2 11 A10 10 0 0 1 22 11 C22 19 12 31 12 31 Z" />
      <circle cx="12" cy="11" r="3.6" />
    </svg>
  );
}

function Fan({ pin, flip }: { pin: WorldPinDto; flip: boolean }) {
  return (
    <div className={`wm-fan${flip ? ' flip' : ''}`}>
      {pin.top.map((r, i) => (
        <a key={r.driverId} className={`wm-fan-item p${i + 1}`} href={`#/driver/${r.driverId}`} title={`${r.driverName} · ${r.car}`}>
          <span className="wm-fan-avatar"><Avatar driverId={r.driverId} name={r.driverName} size={44} /><b>{i + 1}</b></span>
          <span className="wm-fan-time num">{formatLapTime(r.lapMs)}</span>
        </a>
      ))}
    </div>
  );
}

function Pin({ pin, x, y, image, open, flip, named, onOpen, onClose }: { pin: WorldPinDto; x: number; y: number; image: boolean; open: boolean; flip: boolean; named?: boolean; onOpen: () => void; onClose: () => void }) {
  const { trackName } = useContentNames();
  const name = trackName(pin.track, pin.layout);
  const [broken, setBroken] = useState(false);
  return (
    <div className={`wm-pin${image ? ' wm-img' : ''}${open ? ' open' : ''}`} style={{ left: x, top: y }} onPointerEnter={onOpen} onPointerLeave={onClose} onFocus={onOpen} onBlur={onClose}>
      <a
        className="wm-pin-main"
        href={trackHref(pin.track, pin.layout)}
        aria-label={name}
        onClick={(e) => {
          // en pantallas táctiles el primer toque abre el abanico y el segundo entra en la ficha
          if (!open && window.matchMedia('(hover: none)').matches) { e.preventDefault(); onOpen(); }
        }}
      >
        {image ? (broken ? <span className="wm-initials">{name.slice(0, 2).toUpperCase()}</span> : <img src={trackImage(pin.track, pin.layout)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />) : <PushPin />}
      </a>
      {(open || named) && <span className="wm-label">{name}</span>}
      {open && <Fan pin={pin} flip={flip} />}
    </div>
  );
}

/** El mapa: arrastrar para moverse, rueda para acercar, chinchetas que se agrupan al alejar y círculos con la imagen del circuito al acercar. */
/** Modo «elegir sitio»: sin chinchetas; pulsar en el mapa coloca el marcador y avisa con las coordenadas. */
export interface PickProps { marker: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void; start?: { lat: number; lon: number; zoom: number } | null;
  /** Cada vez que cambia, el mapa se centra ahí (resultado de una búsqueda). */
  focus?: { lat: number; lon: number; zoom: number; n: number } | null }

export function WorldMap({ pins, mode, pick }: { pins: WorldPinDto[]; mode: MapMode; pick?: PickProps }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState<View>({ cx: TILE / 2, cy: TILE / 2, zoom: 0 });
  const [land, setLand] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const maxZoom = mode === 'vector' ? VECTOR_MAX_ZOOM : MAX_ZOOM;
  const fitted = useRef(false);

  useEffect(() => { if (mode === 'vector') void loadLand().then(setLand); }, [mode]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => pins.map((pin) => ({ pin, at: project(pin.lat, pin.lon) })), [pins]);
  useEffect(() => {
    if (!pick || fitted.current) return;
    fitted.current = true;
    const at = pick.start ?? pick.marker;
    if (at) { const p = project(at.lat, at.lon); setView(clampView({ cx: p.x, cy: p.y, zoom: pick.start?.zoom ?? 11 }, size.w, size.h, maxZoom)); }
  }, [pick, size.w, size.h, maxZoom]);
  const focusN = pick?.focus?.n;
  useEffect(() => {
    const f = pick?.focus;
    if (!f) return;
    const p = project(f.lat, f.lon);
    setView(clampView({ cx: p.x, cy: p.y, zoom: f.zoom }, size.w, size.h, maxZoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusN]);
  const fitAll = useCallback(() => {
    if (pts.length === 0) { setView(clampView({ cx: TILE / 2, cy: TILE / 2, zoom: 0 }, size.w, size.h, maxZoom)); return; }
    const xs = pts.map((p) => p.at.x), ys = pts.map((p) => p.at.y);
    setView(fitBounds({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, size.w, size.h));
  }, [pts, size.w, size.h, maxZoom]);
  // Primera vista: lo justo para ver todos los circuitos
  useEffect(() => { if (!pick && !fitted.current && pts.length > 0) { fitted.current = true; fitAll(); } }, [pts, fitAll]);
  // Al cambiar de modo o de tamaño, el zoom se mantiene dentro de lo permitido
  useEffect(() => { setView((v) => clampView(v, size.w, size.h, maxZoom)); }, [size.w, size.h, maxZoom]);

  const zoomAt = useCallback((factor: number, mx: number, my: number) => {
    setView((v) => {
      const s = 2 ** v.zoom;
      const wx = v.cx + (mx - size.w / 2) / s, wy = v.cy + (my - size.h / 2) / s; // el punto del mundo bajo el cursor
      const zoom = Math.max(minZoom(size.w, size.h), Math.min(maxZoom, v.zoom + Math.log2(factor)));
      const s2 = 2 ** zoom;
      return clampView({ zoom, cx: wx - (mx - size.w / 2) / s2, cy: wy - (my - size.h / 2) / s2 }, size.w, size.h, maxZoom);
    });
  }, [size.w, size.h, maxZoom]);

  // La rueda tiene que poder cancelar el desplazamiento de la página, y eso exige un oyente no pasivo
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const open = (k: string) => { window.clearTimeout(closeTimer.current); setOpenKey(k); };
  const close = () => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setOpenKey(null), 160); };

  const s = 2 ** view.zoom;
  const groups = useMemo(() => clusterPins(pts.map((p) => ({ at: p.at, item: p.pin })), view.zoom, CLUSTER_PX, maxZoom), [pts, view.zoom, maxZoom]);
  const tiles = mode === 'vector' ? [] : visibleTiles(view, size.w, size.h, Math.max(0, Math.min(18, Math.round(view.zoom))));
  const tileUrl = mode === 'vector' ? null : TILE_URL[mode];

  const zoomIntoGroup = (items: WorldPinDto[]) => {
    const ps = items.map((p) => project(p.lat, p.lon));
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    setView(fitBounds({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, size.w, size.h, 140));
  };

  return (
    <div
      className={`wm${pick ? ' wm-pick' : ''}`}
      ref={box}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.wm-pin, .wm-cluster, .wm-ctl')) return;
        drag.current = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        d.x = e.clientX; d.y = e.clientY;
        if (Math.hypot(e.clientX - d.ox, e.clientY - d.oy) > 4) d.moved = true; // por debajo de 4 px es un clic, no un arrastre
        setView((v) => clampView({ ...v, cx: v.cx - dx / 2 ** v.zoom, cy: v.cy - dy / 2 ** v.zoom }, size.w, size.h, maxZoom));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && pick) {
          const r = e.currentTarget.getBoundingClientRect();
          const sc = 2 ** view.zoom;
          const at = unproject(view.cx + (e.clientX - r.left - size.w / 2) / sc, view.cy + (e.clientY - r.top - size.h / 2) / sc);
          pick.onPick(Math.round(at.lat * 1e5) / 1e5, Math.round(at.lon * 1e5) / 1e5);
        }
      }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('.wm-pin, .wm-cluster, .wm-ctl')) { const r = e.currentTarget.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); } }}
      role="application"
      aria-label={t('Mapa del mundo con los circuitos jugados. Arrastra para moverte y usa la rueda para acercar.')}
    >
      {mode === 'vector' ? (
        <svg className="wm-svg" width={size.w} height={size.h} aria-hidden="true">
          <g transform={`translate(${size.w / 2 - view.cx * s} ${size.h / 2 - view.cy * s}) scale(${s})`}>
            {land && <path className="wm-land" d={land} fillRule="evenodd" vectorEffect="non-scaling-stroke" />}
          </g>
        </svg>
      ) : (
        <div className="wm-tiles" aria-hidden="true">
          {tiles.map((tl) => <img key={`${tl.z}/${tl.x}/${tl.y}`} src={tileUrl!(tl.z, tl.x, tl.y)} alt="" draggable={false} referrerPolicy="origin" style={{ left: tl.left, top: tl.top, width: tl.size + 0.5, height: tl.size + 0.5 }} />)}
        </div>
      )}

      {pick?.marker && (() => { const p = toScreen(view, size.w, size.h, project(pick.marker.lat, pick.marker.lon)); return <span className="wm-marker" style={{ left: p.x, top: p.y }} aria-hidden="true" />; })()}

      {(pick ? [] : groups).map((g) => {
        const p = toScreen(view, size.w, size.h, g);
        if (p.x < -140 || p.y < -140 || p.x > size.w + 140 || p.y > size.h + 140) return null;
        if (g.items.length > 1 && g.splitless && view.zoom >= IMAGE_ZOOM) {
          // varios trazados del mismo circuito: se abren en corona alrededor del punto, cada uno con su nombre
          const n = g.items.length, r = n <= 2 ? 46 : n <= 5 ? 62 : 84;
          return g.items.map((pin, i) => {
            const a = -Math.PI / 2 + (2 * Math.PI * i) / n + (n === 2 ? Math.PI / 2 : 0);
            const k = keyOf(pin);
            return <Pin key={k} pin={pin} x={p.x + Math.cos(a) * r} y={p.y + Math.sin(a) * r} image named open={openKey === k} flip={p.y < 150} onOpen={() => open(k)} onClose={close} />;
          });
        }
        if (g.items.length > 1) {
          return (
            <button key={`c${g.items.map(keyOf).join('+')}`} type="button" className="wm-cluster" style={{ left: p.x, top: p.y }} onClick={() => zoomIntoGroup(g.items)} title={t('{n} circuitos. Pulsa para acercar.', { n: g.items.length })} aria-label={t('{n} circuitos. Pulsa para acercar.', { n: g.items.length })}>
              {g.items.length}
            </button>
          );
        }
        const pin = g.items[0]!;
        const k = keyOf(pin);
        return <Pin key={k} pin={pin} x={p.x} y={p.y} image={view.zoom >= IMAGE_ZOOM} open={openKey === k} flip={p.y < 150} onOpen={() => open(k)} onClose={close} />;
      })}

      <div className="wm-ctl" role="group" aria-label={t('Zoom del mapa')}>
        <button type="button" onClick={() => zoomAt(2, size.w / 2, size.h / 2)} aria-label={t('Acercar')}>＋</button>
        <button type="button" onClick={() => zoomAt(0.5, size.w / 2, size.h / 2)} aria-label={t('Alejar')}>－</button>
        <button type="button" onClick={fitAll} className="wm-all">{t('Todo')}</button>
      </div>
      <p className="wm-attr">{ATTRIBUTION[mode]}</p>
    </div>
  );
}
