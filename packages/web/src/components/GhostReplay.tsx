import { speedValue, speedUnit } from '../prefs';
import { MapBackdrop, MapLayersControl } from './MapBackdrop';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatLapTime, type MapInfoDto, type ReplayLapDto } from '@howler/shared';
import { api } from '../api';
import { useContentNames } from '../content';
import { headingOnMap, imageSize, toPixel } from '../map-geometry';
import { GhostTelemetry, TEL_FULL, telemetryX } from './GhostTelemetry';
import { GhostTyres, updateTyres, type TyreEls } from './GhostTyres';
import { forcesLimit, GhostForces, updateForces, type ForceEls } from './GhostForces';
import type { View } from './chart-zoom';
import { t } from '../i18n';
import { gapsAt, prepareGap } from './ghost-gap';
import { driveStates, stateRuns, zigzagPoints } from './compare-math';
import { gearLabel, sampleAt, sectorSplits, smoothPath, summarizeSectors } from './ghost-math';

const DEFAULT_HEX = ['#f0c050', '#c9d1dd', '#d58b55'] as const;
const MEDALS = ['var(--medal-gold)', 'var(--medal-silver)', 'var(--medal-bronze)'] as const;
const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const LEADER = t('Líder');
/** Cuánto sigue el reloj tras llegar el último fantasma, para ver cómo acaba (ms). */
const TAIL_MS = 1500;
/** Cuántas muestras (≈100 ms cada una) dura la estela de cada coche. */
const TAIL_SAMPLES = 35;
/** Medidas del coche dibujado (metros) y tamaño mínimo en pantalla para que se vea al alejar el mapa. */
const CAR_LEN_M = 4.6;
const CAR_MIN_PX = 11;

const fmtClock = (ms: number) => formatLapTime(Math.max(0, Math.round(ms)));

type Loaded = { map: MapInfoDto; laps: ReplayLapDto[] };

/**
 * Visor de fantasmas a pantalla completa: las 3 mejores vueltas del circuito superpuestas sobre el mapa, todas
 * empezando a la vez. Cada coche es una flecha que apunta hacia donde mira, con su estela y su línea de trazada;
 * abajo, reproducción, velocidad y, en cada tarjeta, velocidad y marcha en directo.
 */
export function GhostReplay({ track, layout, cars, title, onClose }: {
  track: string; layout: string; cars: string[]; title: string; onClose: () => void;
}) {
  const { carName } = useContentNames();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [labels, setLabels] = useState(true);
  const [bySector, setBySector] = useState(true);
  const [parts, setParts] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [custom, setCustom] = useState<Record<number, string>>(() => {
    try { const o = JSON.parse(localStorage.getItem('howler.ghost.colors') ?? '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)).map(([k, v]) => [Number(k), v as string])); } catch { return {}; }
  });
  const colorOf = (rank: number): string => custom[rank] ?? MEDALS[rank - 1]!;
  const colorMap = { 1: colorOf(1), 2: colorOf(2), 3: colorOf(3) };
  const setColor = (rank: number, hex: string | null) => setCustom((c) => {
    const n = { ...c }; if (hex) n[rank] = hex; else delete n[rank];
    try { localStorage.setItem('howler.ghost.colors', JSON.stringify(n)); } catch { /* sin almacenamiento */ }
    return n;
  });
  const [follow, setFollow] = useState<number | null>(null);
  const [charts, setCharts] = useState(true);
  const [zoomed, setZoomed] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef<number>(1);
  const nodes = useRef(new Map<number, SVGGElement>());
  const tails = useRef(new Map<number, SVGPolylineElement>());
  const markEls = useRef(new Map<string, SVGGElement>());
  const poses = useRef(new Map<number, { px: number; py: number; deg: number }>());
  const mapScale = useRef(1);
  const speedEls = useRef(new Map<number, HTMLElement>());
  const gearEls = useRef(new Map<number, HTMLElement>());
  const doneEls = useRef(new Map<number, HTMLElement>());
  const gapEls = useRef(new Map<number, HTMLElement>());
  const svgEl = useRef<SVGSVGElement>(null);
  const cam = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const baseCam = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const followRef = useRef<number | null>(null);
  const heads = useRef(new Map<string, SVGLineElement>());
  const telViewRef = useRef<View>(TEL_FULL);
  const forceEls = useRef(new Map<number, ForceEls>());
  const tyreEls = useRef(new Map<number, TyreEls>());
  const timeEl = useRef<HTMLElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  playingRef.current = playing;
  speedRef.current = speed;
  followRef.current = follow;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/map?${new URLSearchParams({ track, layout })}`).then((r) => (r.ok ? (r.json() as Promise<MapInfoDto>) : Promise.reject(new Error('map')))),
      api.replay({ track, layout, cars }),
    ]).then(
      ([map, replay]) => { if (!cancelled) setData({ map, laps: replay.laps }); },
      (e: Error) => { if (!cancelled) setError(e.message === 'map' ? t('No encuentro el mapa de este circuito en tu instalación de Assetto Corsa.') : t('No se pudieron cargar las vueltas.')); },
    );
    return () => { cancelled = true; };
  }, [track, layout, cars.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const ghosts = useMemo(() => (data?.laps ?? []).filter((l) => l.trace && l.trace.t.length > 1), [data]);
  const total = Math.max(0, ...ghosts.map((g) => g.lapMs)) + TAIL_MS;

  // Para medir el hueco en directo: metros recorridos de cada vuelta en cada muestra
  const gapLaps = useMemo(() => ghosts.map((g) => prepareGap(g.trace!, g.lapMs)), [ghosts]);
  const forcesLim = useMemo(() => forcesLimit(ghosts), [ghosts]);

  // Sectores: quién gana cada uno; marcas en los límites (y subsectores automáticos) sobre la trazada de la vuelta más rápida.
  const sectors = useMemo(() => summarizeSectors(ghosts), [ghosts]);
  const probe = useMemo(() => ghosts.map((g) => g.trace!), [ghosts]);
  const smooth = useMemo(() => new Map(ghosts.map((g) => [g.rank, smoothPath(g.trace!.x, g.trace!.z)])), [ghosts]);
  const splits = useMemo(() => ghosts.map((g) => (g.sectorsMs.length > 1 && g.sectorsMs.every((v) => v != null) ? sectorSplits(g.trace!, g.sectorsMs, parts) : null)), [ghosts, parts]);
  const markList = useMemo(() => {
    const ref = splits[0];
    if (!data || !ref) return [];
    return ref.marks.map((m) => {
      const q = toPixel(data.map, m.x, m.z);
      const q2 = toPixel(data.map, m.x + Math.cos(m.h), m.z + Math.sin(m.h));
      return { key: `${m.sector}.${m.sub}`, px: q.px, py: q.py, deg: (Math.atan2(q2.py - q.py, q2.px - q.px) * 180) / Math.PI, sector: m.sector, sub: m.sub };
    });
  }, [data, splits]);
  const subBest = useMemo(() => {
    if (parts < 2) return [];
    return Array.from({ length: sectors.count }, (_, k) => Array.from({ length: parts }, (_, j) => {
      const v = splits.map((sp) => sp?.subMs[k]?.[j]).filter((x): x is number => x != null);
      return v.length > 1 ? Math.min(...v) : null;
    }));
  }, [splits, sectors.count, parts]);

  // Vista recortada a la zona por la que pasan los coches (el mapa de AC lleva mucho margen vacío): el circuito llena la pantalla.
  const view = useMemo(() => {
    if (!data || ghosts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const g of ghosts) {
      for (let i = 0; i < g.trace!.x.length; i++) {
        const { px, py } = toPixel(data.map, g.trace!.x[i]!, g.trace!.z[i]!);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.11;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }, [data, ghosts]);

  /** Pone la flecha de un fantasma en su sitio con el tamaño real del coche (o el mínimo legible según el zoom). */
  const placeNode = useCallback((rank: number) => {
    const p = poses.current.get(rank), el = nodes.current.get(rank), c = cam.current, svg = svgEl.current;
    if (!p || !el) return;
    const ppu = c && svg && svg.clientWidth > 0 ? Math.min(svg.clientWidth / c.w, svg.clientHeight / c.h) : 1;
    const k = Math.max(CAR_LEN_M / mapScale.current, CAR_MIN_PX / ppu);
    el.setAttribute('transform', `translate(${p.px.toFixed(1)} ${p.py.toFixed(1)}) rotate(${p.deg.toFixed(1)}) scale(${k.toFixed(3)})`);
  }, []);

  /** Las marcas de sector miden siempre lo mismo en pantalla, sea cual sea el zoom. */
  const placeMarks = useCallback(() => {
    const c = cam.current, svg = svgEl.current;
    if (!c || !svg || svg.clientWidth <= 0) return;
    const k = 1 / Math.min(svg.clientWidth / c.w, svg.clientHeight / c.h);
    markEls.current.forEach((el) => {
      const [px, py, deg] = (el.dataset.at ?? '0,0,0').split(',').map(Number);
      el.setAttribute('transform', `translate(${px} ${py}) scale(${k.toFixed(4)}) rotate(${deg})`);
    });
  }, []);

  /** Coloca todos los coches, las estelas y los números en el instante `t`. */
  const render = useCallback((t: number) => {
    if (!data) return;
    for (const g of ghosts) {
      const s = sampleAt(g.trace!, t, g.lapMs);
      const { px, py } = toPixel(data.map, s.x, s.z);
      if (followRef.current === g.rank && cam.current) { const c = cam.current; cam.current = { ...c, x: c.x + (px - c.w / 2 - c.x) * 0.2, y: c.y + (py - c.h / 2 - c.y) * 0.2 }; applyCam(); }
      poses.current.set(g.rank, { px, py, deg: headingOnMap(data.map, s.x, s.z, s.h) });
      placeNode(g.rank);
      const speedEl = speedEls.current.get(g.rank);
      if (speedEl) speedEl.textContent = String(Math.round(speedValue(s.v)));
      const gearEl = gearEls.current.get(g.rank);
      if (gearEl) gearEl.textContent = gearLabel(s.gear);
      doneEls.current.get(g.rank)?.classList.toggle('on', s.finished);
      // Estela: las últimas muestras hasta este instante.
      const tr = g.trace!;
      let hi = tr.t.findIndex((tt) => tt > t);
      hi = hi < 0 ? tr.t.length : hi;
      const pts: string[] = [];
      for (let i = Math.max(0, hi - TAIL_SAMPLES); i < hi; i++) {
        const q = toPixel(data.map, tr.x[i]!, tr.z[i]!);
        pts.push(`${q.px.toFixed(1)},${q.py.toFixed(1)}`);
      }
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      tails.current.get(g.rank)?.setAttribute('points', pts.join(' '));
    }
    // Hueco con el líder entre los fantasmas visibles: «+1.234 s · 18 m»
    const shown = ghosts.map((g, i) => ({ g, i })).filter(({ g }) => !hidden.has(g.rank));
    if (shown.length > 1) {
      const st = gapsAt(shown.map(({ i }) => gapLaps[i]!), t);
      shown.forEach(({ g }, k) => {
        const el = gapEls.current.get(g.rank);
        if (!el) return;
        el.textContent = k === st.leader ? LEADER : st.gapMs[k] == null ? '' : `+${(st.gapMs[k]! / 1000).toFixed(3)} s · ${Math.round(st.distM[k]!)} m`;
      });
    } else for (const g of ghosts) { const el = gapEls.current.get(g.rank); if (el) el.textContent = ''; }
    if (forcesLim != null) updateForces(ghosts, t, forcesLim, hidden, forceEls.current);
    updateTyres(ghosts, t, hidden, tyreEls.current);
    const lapMax = Math.max(1, ...ghosts.map((g) => g.lapMs));
    const hx = telemetryX(Math.min(t, lapMax), lapMax, telViewRef.current).toFixed(1);
    heads.current.forEach((el) => { el.setAttribute('x1', hx); el.setAttribute('x2', hx); });
    if (timeEl.current) timeEl.current.textContent = `${fmtClock(Math.min(t, total - TAIL_MS))}`;
    if (scrub.current) scrub.current.value = String(Math.round(t));
  }, [data, ghosts, gapLaps, hidden, total, forcesLim]);

  // Bucle de animación: avanza el reloj y mueve los elementos directamente en el DOM (sin pasar por React).
  useEffect(() => {
    if (!data || ghosts.length === 0) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      if (playingRef.current) {
        clock.current += dt * speedRef.current;
        if (clock.current >= total) { clock.current = total; setPlaying(false); }
      }
      render(clock.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [data, ghosts, total, render]);

  const restart = () => { clock.current = 0; setPlaying(true); };
  const seek = (ms: number) => { clock.current = Math.min(total, Math.max(0, ms)); render(clock.current); };

  // Teclado: espacio, flechas, Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range' && e.key !== ' ') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') { e.preventDefault(); if (clock.current >= total) restart(); else setPlaying((p) => !p); }
      else if (e.key === 'ArrowRight') seek(clock.current + 2000);
      else if (e.key === 'ArrowLeft') seek(clock.current - 2000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Pantalla completa del navegador (además de que el visor ya ocupa toda la ventana).
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  };
  useEffect(() => { root.current?.focus(); document.body.classList.add('no-scroll'); return () => document.body.classList.remove('no-scroll'); }, []);

  const toggle = (rank: number) => setHidden((h) => { const n = new Set(h); if (n.has(rank)) n.delete(rank); else n.add(rank); return n; });
  mapScale.current = data?.map.scale ?? 1;
  useEffect(() => { placeMarks(); }, [markList, bySector, placeMarks]);

  // Cámara: el mapa se puede acercar (rueda, botones o pellizco), arrastrar, o seguir a un fantasma. Se mueve directamente en el DOM.
  const base = view ?? (data ? { x: 0, y: 0, ...(({ w, h }) => ({ w, h }))(imageSize(data.map)) } : null);
  const applyCam = () => {
    const c = cam.current;
    if (c && svgEl.current) svgEl.current.setAttribute('viewBox', `${c.x.toFixed(2)} ${c.y.toFixed(2)} ${c.w.toFixed(2)} ${c.h.toFixed(2)}`);
    for (const rank of poses.current.keys()) placeNode(rank);
    placeMarks();
  };
  useEffect(() => {
    if (!base) return;
    baseCam.current = { ...base };
    cam.current = { ...base };
    setZoomed(false);
    applyCam();
  }, [base?.x, base?.y, base?.w, base?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Acerca (f > 1) o aleja (f < 1) alrededor de un punto del mapa (por defecto, el centro de lo que se ve). */
  const zoomBy = (f: number, at?: { x: number; y: number }) => {
    const c = cam.current, b = baseCam.current;
    if (!c || !b) return;
    const w = Math.min(b.w, Math.max(b.w / 20, c.w / f));
    const k = w / c.w;
    const p = at ?? { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    cam.current = { x: p.x - (p.x - c.x) * k, y: p.y - (p.y - c.y) * k, w, h: c.h * k };
    setZoomed(w < b.w * 0.999);
    applyCam();
  };
  const resetCam = () => { if (baseCam.current) { cam.current = { ...baseCam.current }; setZoomed(false); setFollow(null); applyCam(); } };
  /** Punto del mapa bajo un puntero. */
  const mapPoint = (cx: number, cy: number) => {
    const svg = svgEl.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  };
  useEffect(() => {
    const svg = svgEl.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = mapPoint(e.clientX, e.clientY); if (p) zoomBy(Math.exp(-e.deltaY * 0.0015), followRef.current == null ? p : undefined); };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [data, ghosts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => { if (e.button !== 0) return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current, c = cam.current, m = svgEl.current?.getScreenCTM();
    if (!d || d.id !== e.pointerId || !c || !m) return;
    const dx = (e.clientX - d.x) / m.a, dy = (e.clientY - d.y) / m.d;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    if (Math.abs(dx) + Math.abs(dy) > 0) { if (followRef.current != null) setFollow(null); cam.current = { ...c, x: c.x - dx, y: c.y - dy }; applyCam(); }
  };
  const onUp = () => { drag.current = null; };

  // Se pinta directamente en el body: con un tema de cristal (backdrop-filter) las tarjetas encierran cualquier capa «fija» que tengan dentro y el visor no ocupaba la pantalla.
  return createPortal(
    <div className="ghost" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('Fantasmas de {title}', { title })}>
      <header className="ghost-top">
        <div className="ghost-title"><strong>{t('Fantasmas')}</strong><span className="beta-tag">Beta</span><span className="muted">{title}</span></div>
        <div className="ghost-top-actions">
          <span className="ghost-zoom" role="group" aria-label={t('Zoom del mapa')}>
            <button type="button" className="ghost-btn" onClick={() => zoomBy(1.6)} aria-label={t('Acercar')} title={t('Acercar (o rueda del ratón)')}>＋</button>
            <button type="button" className="ghost-btn" onClick={() => zoomBy(1 / 1.6)} aria-label={t('Alejar')} title={t('Alejar')}>－</button>
            <button type="button" className="ghost-btn" onClick={resetCam} disabled={!zoomed && follow == null} title={t('Ver el circuito entero (también doble clic en el mapa)')}>{t('Todo')}</button>
          </span>
          {ghosts.length > 0 && (
            <select className="ghost-btn ghost-follow" value={follow ?? ''} aria-label={t('Seguir a un fantasma')}
              onChange={(e) => { const v = e.target.value; setFollow(v ? Number(v) : null); if (v) zoomBy(zoomed ? 1 : 1.8); }}>
              <option value="">{t('Cámara libre')}</option>
              {ghosts.map((g) => <option key={g.rank} value={g.rank}>{t('Seguir a {name}', { name: g.driverName })}</option>)}
            </select>
          )}
          {data && <MapLayersControl track={track} layout={layout} probe={probe} />}
          <button type="button" className={`ghost-btn ${labels ? 'on' : ''}`} aria-pressed={labels} onClick={() => setLabels(!labels)}>{t('Nombres')}</button>
          {sectors.count > 0 && <button type="button" className={`ghost-btn ${bySector ? 'on' : ''}`} onClick={() => setBySector(!bySector)} aria-pressed={bySector} title={t('Marca en el mapa dónde empieza y acaba cada sector')}>{t('Sectores en el mapa')}</button>}
          {sectors.count > 0 && (
            <select className="ghost-btn ghost-follow" value={parts} aria-label={t('Subsectores')} title={t('Divide cada sector en partes iguales (estimado a partir de la trazada)')} onChange={(e) => setParts(Number(e.target.value))}>
              <option value={1}>{t('Sin subsectores')}</option>
              {[2, 3, 4].map((n) => <option key={n} value={n}>{t('{n} subsectores por sector', { n })}</option>)}
            </select>
          )}
          <button type="button" className={`ghost-btn ${charts ? 'on' : ''}`} aria-pressed={charts} onClick={() => setCharts(!charts)} title={t('Gráficas de velocidad, acelerador, freno y volante')}>{t('Gráficas')}</button>
          <button type="button" className="ghost-btn" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? t('Salir de pantalla completa') : t('Pantalla completa')}</button>
          <button type="button" className="ghost-btn close" onClick={onClose} aria-label={t('Cerrar')}>{t('Cerrar')} ✕</button>
        </div>
      </header>

      <div className="ghost-main">
        {data && ghosts.length > 0 && (
          <aside className="ghost-side">
            <ul className="ghost-cards">
              {data.laps.map((g) => {
                const off = hidden.has(g.rank);
                const has = !!g.trace && g.trace.t.length > 1;
                return (
                  <li key={g.rank} className={`ghost-card ${off ? 'off' : ''} ${has ? '' : 'nodata'}`} style={{ ['--medal' as string]: colorOf(g.rank) }}>
                    <button type="button" className="ghost-card-main" disabled={!has} aria-pressed={!off} onClick={() => toggle(g.rank)} title={has ? (off ? t('Mostrar este fantasma') : t('Ocultar este fantasma')) : t('Esta vuelta es anterior a la grabación de trayectorias')}>
                      <span className="ghost-rank">{g.rank}</span>
                      <span className="ghost-who">
                        <span className="ghost-name">{g.driverName}</span>
                        <span className="ghost-car">{carName(g.car)}</span>
                      </span>
                      <span className="ghost-lap num">{formatLapTime(g.lapMs)}</span>
                    </button>
                    {has ? (
                      <span className="ghost-live">
                        <label className="ghost-color" title={t('Color de este fantasma')}>
                          <input type="color" aria-label={t('Color de este fantasma')} value={custom[g.rank] ?? DEFAULT_HEX[g.rank - 1]!} onChange={(e) => setColor(g.rank, e.target.value)} />
                          {custom[g.rank] && <button type="button" className="ghost-color-reset" onClick={(e) => { e.preventDefault(); setColor(g.rank, null); }}>{t('Restaurar')}</button>}
                        </label>
                        <span className="num"><span ref={(el) => { if (el) speedEls.current.set(g.rank, el); else speedEls.current.delete(g.rank); }}>0</span> {speedUnit()}</span>
                        <span className="num">{t('Marcha')} <span ref={(el) => { if (el) gearEls.current.set(g.rank, el); else gearEls.current.delete(g.rank); }}>N</span></span>
                        {g.maxSpeedKmh != null && <span className="num muted">{t('Máx.')} {Math.round(speedValue(g.maxSpeedKmh))}</span>}
                        <span className="num ghost-gap" title={t('Aproximado: lo que tardaría en llegar adonde está el líder ahora')} ref={(el) => { if (el) gapEls.current.set(g.rank, el); else gapEls.current.delete(g.rank); }} />
                        <span className="ghost-done" ref={(el) => { if (el) doneEls.current.set(g.rank, el); else doneEls.current.delete(g.rank); }}>{t('Meta')}</span>
                      </span>
                    ) : <span className="ghost-live muted">{t('Sin trayectoria grabada')}</span>}
                  </li>
                );
              })}
            </ul>
            {forcesLim != null && (
              <div className="ghost-forces">
                <div className="ghost-forces-head"><strong>{t('Fuerzas')}</strong><span className="muted">{t('Medidas por el juego')}</span></div>
                <GhostForces ghosts={ghosts} colors={colorMap} lim={forcesLim}
                  register={(rank, part, el) => { const m = forceEls.current; const cur = m.get(rank) ?? { dot: null, trail: null }; cur[part] = el as never; m.set(rank, cur); }} />
              </div>
            )}
            <GhostTyres ghosts={ghosts} colors={colorMap} hidden={hidden} register={(rank, els) => { tyreEls.current.set(rank, els); }} onShown={() => render(clock.current)} />
            {sectors.count > 0 && (
              <table className="ghost-sectors" aria-label={t('Sectores de cada vuelta')}>
                <thead><tr><th />{Array.from({ length: sectors.count }, (_, k) => <th key={k} className="num">S{k + 1}</th>)}<th className="num">{t('Vuelta')}</th></tr></thead>
                <tbody>
                  {ghosts.map((g, gi) => (
                    <tr key={g.rank}>
                      <td title={g.driverName}><span className="ghost-dot" style={{ background: colorOf(g.rank) }} /></td>
                      {Array.from({ length: sectors.count }, (_, k) => {
                        const v = g.sectorsMs[k];
                        const win = sectors.winner[k] === gi;
                        return <td key={k} className={`num ${win ? 'best' : ''} ${v != null && !g.sectorsExact ? 'est' : ''}`}>{v != null ? formatLapTime(v) : '—'}</td>;
                      })}
                      <td className="num">{formatLapTime(g.lapMs)}</td>
                    </tr>
                  ))}
                  {sectors.optimalMs != null && ghosts.length > 1 && (
                    <tr className="ghost-optimal">
                      <td>{t('Óptima')}</td>
                      {sectors.best.map((b, k) => <td key={k} className="num">{formatLapTime(b)}</td>)}
                      <td className="num">{formatLapTime(sectors.optimalMs)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {parts > 1 && subBest.length > 0 && (
              <div className="ghost-subs">
                <table className="ghost-sectors" aria-label={t('Subsectores de cada vuelta (estimados)')}>
                  <thead><tr><th />{subBest.flatMap((row, k) => row.map((_, j) => <th key={`${k}.${j}`} className="num">S{k + 1}.{j + 1}</th>))}</tr></thead>
                  <tbody>
                    {ghosts.map((g, gi) => (
                      <tr key={g.rank}>
                        <td><span className="ghost-dot" style={{ background: colorOf(g.rank) }} /></td>
                        {subBest.flatMap((row, k) => row.map((best, j) => {
                          const v = splits[gi]?.subMs[k]?.[j];
                          return <td key={`${k}.${j}`} className={`num est ${v != null && best != null && v === best ? 'best' : ''}`}>{v != null ? (v / 1000).toFixed(2) : '—'}</td>;
                        }))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="note">{t('Subsectores estimados: se reparten por distancia recorrida dentro de cada sector.')}</p>
              </div>
            )}
          </aside>
        )}
      <div className="ghost-stage">
        {error && <p className="empty">{error}</p>}
        {!error && !data && <p className="empty">{t('Cargando las vueltas…')}</p>}
        {data && ghosts.length === 0 && (
          <p className="empty">
            {data.laps.length === 0
              ? t('Todavía no hay ninguna vuelta válida de este circuito.')
              : t('Las mejores vueltas de este circuito no tienen la trayectoria grabada: son anteriores a esta función o fueron la primera vuelta tras conectarse, que no se graba.')}
            {' '}{t('Howler guarda la trayectoria de cada vuelta válida desde ahora, así que la próxima que entre entre las tres mejores se podrá reproducir.')}
          </p>
        )}
        {data && ghosts.length > 0 && (
          <svg ref={svgEl} className="ghost-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={resetCam} viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `0 0 ${imageSize(data.map).w} ${imageSize(data.map).h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('Mapa con las tres mejores vueltas reproduciéndose a la vez')}>
            <MapBackdrop map={data.map} track={track} layout={layout} probe={probe} opacity={0.85} />
            {bySector && markList.map((m) => (
              <g key={m.key} data-at={`${m.px.toFixed(2)},${m.py.toFixed(2)},${m.deg.toFixed(1)}`} ref={(el) => { if (el) markEls.current.set(m.key, el); else markEls.current.delete(m.key); }}>
                {/* Doble trazo (oscuro debajo, claro encima) para que se vea sobre la carretera blanca y sobre el fondo */}
                <line x1={0} x2={0} y1={m.sub === 0 ? -11 : -8} y2={m.sub === 0 ? 11 : 8} stroke="var(--ink)" strokeWidth={m.sub === 0 ? 5 : 3.6} strokeLinecap="round" />
                <line x1={0} x2={0} y1={m.sub === 0 ? -11 : -8} y2={m.sub === 0 ? 11 : 8} stroke={m.sub === 0 ? 'var(--paper)' : 'var(--lap-2)'} strokeWidth={m.sub === 0 ? 2.4 : 1.8} strokeLinecap="round" />
                {m.sub === 0 && <text x={0} y={-16} fontSize={11} fontWeight={700} textAnchor="middle" fill="var(--paper)" stroke="var(--ink)" strokeWidth={3} paintOrder="stroke" transform={`rotate(${-m.deg})`}>{m.sector === 0 ? t('Meta · S1') : `S${m.sector + 1}`}</text>}
              </g>
            ))}
            {[...ghosts].reverse().map((g) => {
              const off = hidden.has(g.rank);
              const color = colorOf(g.rank);
              const sm = smooth.get(g.rank)!;
              const pts = sm.x.map((x, i) => toPixel(data.map, x, sm.z[i]!));
              const tr = g.trace!;
              const runs = tr.gas && tr.brake && tr.gas.length === pts.length && tr.brake.length === pts.length
                ? stateRuns(driveStates(tr.gas, tr.brake))
                : [{ from: 0, to: pts.length - 1, state: 'throttle' as const }];
              return (
                <g key={g.rank} style={{ display: off ? 'none' : undefined }}>
                  {/* Trazada por estado, como en el comparador: continua acelerando, discontinua rodando, zigzag frenando (sin pedales grabados, todo continuo) */}
                  <g fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round">
                    {runs.map((run, k) => {
                      // Un punto de solape con el tramo siguiente para que no queden huecos entre estados
                      const seg = pts.slice(run.from, Math.min(pts.length, run.to + 2));
                      if (seg.length < 2) return null;
                      const str = (p: { px: number; py: number }[]) => p.map((q) => `${q.px.toFixed(1)},${q.py.toFixed(1)}`).join(' ');
                      if (run.state === 'brake') return <polyline key={k} points={zigzagPoints(seg, 2.2)} vectorEffect="non-scaling-stroke" />;
                      return <polyline key={k} points={str(seg)} vectorEffect="non-scaling-stroke" strokeDasharray={run.state === 'coast' ? '7 5' : undefined} />;
                    })}
                  </g>
                  <polyline ref={(el) => { if (el) tails.current.set(g.rank, el); else tails.current.delete(g.rank); }} fill="none" stroke={color} strokeOpacity={0.95} strokeWidth={2.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                  <g ref={(el) => { if (el) nodes.current.set(g.rank, el); else nodes.current.delete(g.rank); }}>
                    {/* Flecha de longitud 1 que `placeNode` escala al tamaño real del coche (4,6 m) con un mínimo legible */}
                    <path d="M0.55,0 L-0.45,-0.21 L-0.25,0 L-0.45,0.21 Z" fill={color} stroke="var(--ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  </g>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      </div>

      {data && ghosts.length > 0 && (
        <footer className="ghost-hud">
          <div className="ghost-controls">
            <button type="button" className="ghost-btn play" onClick={() => (clock.current >= total ? restart() : setPlaying(!playing))} aria-label={playing ? t('Pausa') : t('Reproducir')}>{playing ? '❚❚' : '▶'}</button>
            <button type="button" className="ghost-btn" onClick={restart} aria-label={t('Volver al inicio')}>⟲ {t('Inicio')}</button>
            <span className="segmented" role="group" aria-label={t('Velocidad de reproducción')}>
              {SPEEDS.map((sp) => <button key={sp} type="button" className={speed === sp ? 'on' : ''} aria-pressed={speed === sp} onClick={() => setSpeed(sp)}>{sp}×</button>)}
            </span>
            <input ref={scrub} className="ghost-scrub" type="range" min={0} max={Math.round(total)} step={50} defaultValue={0} aria-label={t('Posición de la reproducción')}
              onInput={(e) => seek(Number((e.target as HTMLInputElement).value))} />
            <span className="ghost-clock num"><span ref={timeEl}>0:00.000</span></span>
          </div>

          {charts && (
            <GhostTelemetry ghosts={ghosts.filter((g) => !hidden.has(g.rank))} colors={colorMap}
              totalMs={Math.max(1, ...ghosts.map((g) => g.lapMs))} onSeek={seek}
              registerHead={(el, id) => { if (el) heads.current.set(id, el); else heads.current.delete(id); }}
              onView={(v) => { telViewRef.current = v; render(clock.current); }} getClock={() => clock.current} />
          )}

        </footer>
      )}
      {data && ghosts.length > 0 && labels && <GhostLabels ghosts={ghosts} hidden={hidden} nodes={nodes} colorOf={colorOf} />}
    </div>
  , document.body);
}

/** Etiquetas con el nombre junto a cada coche; siguen al marcador leyendo su posición en pantalla en cada fotograma. */
function GhostLabels({ ghosts, hidden, nodes, colorOf }: { colorOf: (rank: number) => string; ghosts: ReplayLapDto[]; hidden: Set<number>; nodes: { current: Map<number, SVGGElement> } }) {
  const els = useRef(new Map<number, HTMLElement>());
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const box = stage.current?.getBoundingClientRect();
      const map = document.querySelector('.ghost-svg')?.getBoundingClientRect();
      if (box) {
        for (const g of ghosts) {
          const node = nodes.current.get(g.rank), el = els.current.get(g.rank);
          if (!node || !el) continue;
          const b = node.getBoundingClientRect();
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          // El halo del coche cuenta en su caja: la etiqueta se coloca sobre el centro, no sobre el borde de la caja
          el.style.transform = `translate(${(cx - box.left).toFixed(0)}px, ${(cy - box.top - b.height * 0.22 - 6).toFixed(0)}px) translate(-50%, -100%)`;
          // Con zoom, un coche fuera del mapa no lleva etiqueta
          el.style.visibility = map && (cx < map.left || cx > map.right || cy < map.top || cy > map.bottom) ? 'hidden' : '';
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ghosts, nodes]);
  return (
    <div className="ghost-labels" ref={stage} aria-hidden="true">
      {ghosts.map((g) => (
        <span key={g.rank} className="ghost-label" style={{ display: hidden.has(g.rank) ? 'none' : undefined, ['--medal' as string]: colorOf(g.rank) }}
          ref={(el) => { if (el) els.current.set(g.rank, el); else els.current.delete(g.rank); }}>
          {g.rank} · {g.driverName}
        </span>
      ))}
    </div>
  );
}
