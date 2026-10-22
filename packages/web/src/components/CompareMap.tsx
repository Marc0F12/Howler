import { useEffect, useRef, useState } from 'react';
import { MapBackdrop, MapLayersControl } from './MapBackdrop';
import { createPortal } from 'react-dom';
import type { MapInfoDto } from '@howler/shared';
import { t } from '../i18n';
import { toPixel } from '../map-geometry';
import type { Corner } from './compare-corners';
import { driveStates, stateRuns, winnerRuns, zigzagPoints, type compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;
type Pt = { px: number; py: number };
type Lens = 'winner' | 'speed' | 'inputs' | 'lines';

/** Color del trazado según la velocidad de la vuelta de referencia: del más lento al más rápido. */
const speedColor = (f: number) => `color-mix(in srgb, var(--chart-1) ${Math.round(f * 100)}%, var(--chart-2))`;

/**
 * Mapa del circuito con curvas numeradas. Cuatro formas de pintarlo: quién va más rápido en cada zona, velocidad,
 * pedales de la vuelta más rápida (acelerando / rodando / frenando) o la trazada de cada vuelta (continua = acelerando,
 * discontinua = rodando, zigzag = frenando; sin la telemetría del plugin, todo continuo).
 */
export function CompareMap({ map, track, layout, cmp, colors, names, hover, corners, hotCorner, onHotCorner, visible, cursors }: {
  map: MapInfoDto; track: string; layout: string; cmp: Comparison; colors: string[]; names: string[]; hover: number | null;
  /** Reproducción: punto en que va cada vuelta (los coches). Se dibuja si el puntero no está sobre las gráficas. */
  cursors?: number[] | null;
  corners: Corner[]; hotCorner: number | null; onHotCorner: (n: number | null) => void;
  /** Tramo visible en las gráficas (con zoom): se resalta sobre el mapa. */
  visible?: [number, number] | null;
}) {
  const hasPedals = !!cmp.gas && !!cmp.brake;
  const [lens, setLens] = useState<Lens>('winner');
  const [big, setBig] = useState(false);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bigEl = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  const ref = cmp.laps[cmp.ref]!;
  const pts = ref.x.map((x, k) => toPixel(map, x, ref.z[k]!));
  const xs = pts.map((p) => p.px), ys = pts.map((p) => p.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08;
  const view = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const base = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  const curBox = () => box ?? base;
  const bigView = `${curBox().x} ${curBox().y} ${curBox().w} ${curBox().h}`;
  /** Zoom alrededor del puntero (o del centro): factor < 1 acerca. */
  const zoomBy = (f: number, e?: { clientX: number; clientY: number }) => {
    const vb = curBox(), sv = bigEl.current;
    let fx = 0.5, fy = 0.5;
    if (e && sv) { const rc = sv.getBoundingClientRect(); const k = Math.max(vb.w / rc.width, vb.h / rc.height); fx =((e.clientX - rc.left) - (rc.width - vb.w / k) / 2) / (vb.w / k); fy = ((e.clientY - rc.top) - (rc.height - vb.h / k) / 2) / (vb.h / k); }
    const w = Math.min(base.w * 1.2, Math.max(base.w / 40, vb.w * f)), h = w * (vb.h / vb.w);
    setBox({ x: vb.x + (vb.w - w) * fx, y: vb.y + (vb.h - h) * fy, w, h });
  };
  const r = Math.max(maxX - minX, maxY - minY) / 70;
  const runs = winnerRuns(cmp.winner);
  const slice = (p: Pt[], a: number, b: number) => p.slice(a, Math.min(p.length, b + 2));
  const str = (p: Pt[]) => p.map((q) => `${q.px.toFixed(1)},${q.py.toFixed(1)}`).join(' ');
  const refSpeed = cmp.speed[cmp.ref]!;
  const vLo = Math.min(...refSpeed), vHi = Math.max(...refSpeed);
  const lenses: [Lens, string, boolean][] = [['winner', t('Gana'), true], ['speed', t('Velocidad'), true], ['inputs', t('Pedales'), hasPedals], ['lines', t('Trazada'), true]];

  /** El dibujo del mapa; `r` es el grosor base: en pantalla completa se afina con el zoom para ver la trazada con precisión. */
  const mk = (r: number) => (
    <>
        <MapBackdrop map={map} track={track} layout={layout} probe={cmp.laps} opacity={0.55} />
        {lens === 'winner' && runs.map((run, k) => <polyline key={k} points={str(slice(pts, run.from, run.to))} fill="none" stroke={colors[run.lap]} strokeWidth={r * 0.9} strokeLinecap="round" strokeLinejoin="round" />)}
        {lens === 'speed' && Array.from({ length: Math.ceil(pts.length / 3) }, (_, k) => {
          const a = k * 3, f = (refSpeed[Math.min(pts.length - 1, a + 1)]! - vLo) / Math.max(1, vHi - vLo);
          return <polyline key={k} points={str(slice(pts, a, a + 3))} fill="none" stroke={speedColor(f)} strokeWidth={r * 0.9} strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {lens === 'inputs' && hasPedals && stateRuns(driveStates(cmp.gas![cmp.ref]!, cmp.brake![cmp.ref]!)).map((run, k) => (
          <polyline key={k} points={str(slice(pts, run.from, run.to))} fill="none" strokeWidth={r * 0.9} strokeLinecap="round" strokeLinejoin="round"
            stroke={run.state === 'brake' ? 'var(--down)' : run.state === 'throttle' ? 'var(--personal)' : 'var(--muted)'} />
        ))}
        {lens === 'lines' && cmp.laps.map((_, i) => i).reverse().map((i) => {
          const l = cmp.laps[i]!;
          const raw = l.x.map((x, k) => toPixel(map, x, l.z[k]!));
          // Cada vuelta se desplaza un poco a su lado de la trazada para que no se tapen entre sí
          const shift = (i - (cmp.laps.length - 1) / 2) * r * 1.3;
          const lp = raw.map((p, k) => {
            const a = raw[Math.max(0, k - 2)]!, b = raw[Math.min(raw.length - 1, k + 2)]!;
            const dx = b.px - a.px, dy = b.py - a.py, len = Math.hypot(dx, dy) || 1;
            return { px: p.px - (dy / len) * shift, py: p.py + (dx / len) * shift };
          });
          const w = r * 0.75;
          if (!hasPedals) return <polyline key={i} points={str(lp)} fill="none" stroke={colors[i]} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
          return (
            <g key={i} fill="none" stroke={colors[i]} strokeWidth={w} strokeLinejoin="round">
              {stateRuns(driveStates(cmp.gas![i]!, cmp.brake![i]!)).map((run, k) => {
                const seg = slice(lp, run.from, run.to);
                if (run.state === 'brake') return <polyline key={k} points={zigzagPoints(seg, r * 0.7)} />;
                return <polyline key={k} points={str(seg)} strokeDasharray={run.state === 'coast' ? `${r * 2} ${r * 1.4}` : undefined} />;
              })}
            </g>
          );
        })}
        {visible && <polyline points={str(slice(pts, Math.floor(visible[0]), Math.ceil(visible[1])))} fill="none" className="map-visible" strokeWidth={r * 0.35} strokeLinecap="round" strokeLinejoin="round" />}
        {corners.map((c) => {
          const p = pts[c.im]!, hot = hotCorner === c.n;
          return (
            <g key={c.n} className={`map-corner ${hot ? 'hot' : ''}`} onPointerEnter={() => onHotCorner(c.n)} onPointerLeave={() => onHotCorner(null)}>
              <circle cx={p.px} cy={p.py} r={r * 2.2} />
              <text x={p.px} y={p.py} textAnchor="middle" dominantBaseline="central" fontSize={r * 2.3}>{c.n}</text>
            </g>
          );
        })}
        {(hover != null || cursors) && cmp.laps.map((l, i) => {
          const k = hover != null ? hover : cursors![i]!;
          const p = toPixel(map, l.x[k]!, l.z[k]!);
          return <circle key={i} cx={p.px} cy={p.py} r={r * (hover != null ? 0.9 : 1.25)} fill={colors[i]} stroke="var(--bg)" strokeWidth={r * 0.3} />;
        })}
    </>
  );

  return (
    <div className="compare-map">
      <div className="lens" role="group" aria-label={t('Color del trazado')}>
        {lenses.map(([id, label, ok]) => (
          <button key={id} type="button" className="tog" aria-pressed={lens === id} disabled={!ok} onClick={() => setLens(id)}>{label}</button>
        ))}
      </div>
      <div className="map-frame">
        <span className="map-tools"><MapLayersControl track={track} layout={layout} probe={cmp.laps} /></span>
        <button type="button" className="btn small map-expand" onClick={() => setBig(true)} aria-label={t('Ver el mapa a pantalla completa')} title={t('Pantalla completa y zoom')}>⛶</button>
        <svg viewBox={view} role="img" aria-label={t('Mapa del circuito')} preserveAspectRatio="xMidYMid meet">{mk(r)}</svg>
      </div>
      {big && createPortal(
        <div className="map-full" role="dialog" aria-modal="true" aria-label={t('Mapa del circuito')}>
          <div className="map-full-bar">
            <div className="lens" role="group" aria-label={t('Color del trazado')}>
              {lenses.map(([id, label, ok]) => (
                <button key={id} type="button" className="tog" aria-pressed={lens === id} disabled={!ok} onClick={() => setLens(id)}>{label}</button>
              ))}
            </div>
            <span className="muted">{t('Rueda = zoom; arrastrar = mover; doble clic = todo.')}</span>
            <MapLayersControl track={track} layout={layout} probe={cmp.laps} />
            <span className="map-full-btns">
              <button type="button" className="btn small" onClick={() => zoomBy(1 / 1.5)} aria-label={t('Acercar')}>＋</button>
              <button type="button" className="btn small" onClick={() => zoomBy(1.5)} aria-label={t('Alejar')}>－</button>
              <button type="button" className="btn small" onClick={() => setBox(null)}>{t('Todo')}</button>
              <button type="button" className="btn small primary" onClick={() => setBig(false)}>{t('Cerrar')}</button>
            </span>
          </div>
          <svg ref={bigEl} className="map-full-svg" viewBox={bigView} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('Mapa del circuito')}
            onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 / 1.25 : 1.25, e); }}
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (!drag.current) return; const sv = bigEl.current!, rc = sv.getBoundingClientRect(), vb = curBox(); const k = Math.max(vb.w / rc.width, vb.h / rc.height); setBox({ ...vb, x: vb.x - (e.clientX - drag.current.x) * k, y: vb.y - (e.clientY - drag.current.y) * k }); drag.current = { x: e.clientX, y: e.clientY }; }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onDoubleClick={() => setBox(null)}>{mk(r * Math.max(0.03, 0.3 * (curBox().w / base.w)))}</svg>
        </div>, document.body)}
      {lens === 'lines' && (
        <p className="note">{hasPedals ? t('Continua: acelerando · discontinua: rodando · zigzag: frenando.') : t('Sin telemetría del plugin: todo continuo.')}</p>
      )}
      {lens === 'winner' && (
        <ul className="compare-legend" aria-label={t('Colores del mapa')}>
          {names.map((n, i) => <li key={i}><i className="swatch" style={{ background: colors[i] }} />{n}</li>)}
        </ul>
      )}
      {lens === 'speed' && (
        <p className="map-ramp"><span className="muted">{t('Lento')}</span><i style={{ background: `linear-gradient(90deg, ${speedColor(0)}, ${speedColor(1)})` }} /><span className="muted">{t('Rápido')}</span></p>
      )}
      {lens === 'inputs' && (
        <ul className="compare-legend" aria-label={t('Colores del mapa')}>
          <li><i className="swatch" style={{ background: 'var(--personal)' }} />{t('Acelerando')}</li>
          <li><i className="swatch" style={{ background: 'var(--muted)' }} />{t('Rodando')}</li>
          <li><i className="swatch" style={{ background: 'var(--down)' }} />{t('Frenando')}</li>
        </ul>
      )}
    </div>
  );
}
