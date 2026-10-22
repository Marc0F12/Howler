import { useEffect, useRef } from 'react';
import { panView, zoomView, type View } from './chart-zoom';
import { ChartOrderButtons, type OrderProps } from './ChartOrder';

export interface CompareSeries {
  label: string;
  color: string;
  /** Trazo discontinuo (`4 3`...) además del color, para distinguir las líneas aunque no se vean bien los colores. */
  dash?: string;
  values: number[];
}

/** Banda de una curva sobre la gráfica (índices de punto). */
export interface CurveBand { i0: number; i1: number; label: string; hot?: boolean }

const W = 800, PAD = { l: 52, r: 14, t: 14, b: 26 };

/** Tramos consecutivos (índices de punto) donde el valor es > 0,5, dentro de [from, to]. */
export function runsOf(values: number[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    const on = (values[i] ?? 0) > 0.5;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, to]);
  return out;
}
const plotW = W - PAD.l - PAD.r;

/**
 * Gráfica de líneas de varias vueltas sobre la distancia recorrida. El cursor y el zoom son compartidos: al pasar el
 * ratón por una gráfica se marca el mismo punto en las demás y en el mapa (`hover` es el índice del punto), y la rueda
 * acerca el mismo tramo en todas (`view`).
 */
export function CompareChart({ title, subtitle, series, lengthM, format, tickFormat, hover, onHover, view, onView, zeroLine = false, invertY = false, height = 210, bands, bandLabels = false, fill, symmetric = false, range, readout, cursors, marks, order }: {
  title: string;
  subtitle?: string;
  series: CompareSeries[];
  /** Metros que mide la vuelta de referencia: etiqueta del eje X. */
  lengthM: number;
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  hover: number | null;
  onHover: (i: number | null) => void;
  /** Tramo visible (índices de muestra, con decimales): rueda = zoom, arrastrar = mover, doble clic = todo. Compartido por todas las gráficas. */
  view: View;
  onView: (v: View) => void;
  /** Dibuja una línea en el cero (para las diferencias). */
  zeroLine?: boolean;
  /** Valores positivos hacia abajo. */
  invertY?: boolean;
  /** Alto del dibujo (la anchura es siempre 800). */
  height?: number;
  /** Curvas detectadas: franjas sombreadas (con su número si `bandLabels`). */
  bands?: CurveBand[];
  bandLabels?: boolean;
  /** Relleno entre la primera serie y el cero: `above` donde es positiva, `below` donde es negativa. */
  fill?: { above: string; below: string };
  /** Escala simétrica alrededor de 0 (para diferencias). */
  symmetric?: boolean;
  /** Escala vertical fija [mínimo, máximo] en vez de ajustarla a los datos. */
  range?: [number, number];
  /** Texto corto en la cabecera con el valor bajo el cursor. */
  readout?: (i: number) => string;
  /** Reproducción: punto en que va cada vuelta (uno por serie, o uno solo para todas). Se dibuja si el puntero no está sobre las gráficas. */
  cursors?: number[];
  /** Marcas finas bajo las líneas (p. ej. ABS o control de tracción actuando): una fila por vuelta, donde `values` es > 0,5. */
  marks?: { values: number[]; color: string }[];
  /** Flechas para subir o bajar la gráfica de sitio (las pone `OrderedCharts`). */
  order?: OrderProps;
}) {
  const H = height;
  const P = { ...PAD, t: bandLabels && bands?.length ? 24 : PAD.t };
  const plotH = H - P.t - P.b;
  const box = useRef<HTMLDivElement>(null);
  const n = series[0]?.values.length ?? 0;
  const [v0, v1] = view;
  const first = Math.max(0, Math.floor(v0)), last = Math.min(n - 1, Math.ceil(v1));
  const all = series.flatMap((s) => s.values.slice(first, last + 1));
  let lo = Math.min(...all, zeroLine ? 0 : Infinity), hi = Math.max(...all, zeroLine ? 0 : -Infinity);
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi), 0.05); lo = -m; hi = m; }
  if (range) { lo = range[0]; hi = range[1]; }
  if (hi - lo < 1e-6) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i: number) => PAD.l + ((i - v0) / Math.max(1e-9, v1 - v0)) * plotW;
  const y = (v: number) => P.t + (invertY ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo)) * plotH;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const fmtTick = tickFormat ?? format;
  const path = (vals: number[]) => vals.slice(first, last + 1).map((v, k) => `${k ? 'L' : 'M'}${x(first + k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areas = fill && series[0] ? (() => {
    const v = series[0]!.values, y0 = y(0);
    let up = `M${x(first).toFixed(1)},${y0}`, dn = up;
    for (let i = first; i <= last; i++) { const yy = y(v[i]!); up += `L${x(i).toFixed(1)},${(invertY ? Math.max(yy, y0) : Math.min(yy, y0)).toFixed(1)}`; dn += `L${x(i).toFixed(1)},${(invertY ? Math.min(yy, y0) : Math.max(yy, y0)).toFixed(1)}`; }
    const end = `L${x(last).toFixed(1)},${y0}Z`;
    return { up: up + end, dn: dn + end };
  })() : null;
  const clipId = useRef(`cc-${Math.random().toString(36).slice(2, 8)}`).current;
  const drag = useRef<{ id: number; x: number; v: [number, number]; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgEl = useRef<SVGSVGElement>(null);
  // La rueda hace zoom alrededor del puntero (hay que registrarla sin pasividad para poder frenar el desplazamiento de la página).
  useEffect(() => {
    const el = svgEl.current;
    if (!el || n < 3) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, ((((e.clientX - r.left) / r.width) * W) - PAD.l) / plotW));
      onView(zoomView(viewRef.current, n, Math.exp(-e.deltaY * 0.0015), f));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [n, onView]);
  const zoomed = v1 - v0 < n - 1 - 1e-6;
  // Cursor: el del puntero manda; si no, el de la reproducción (cada vuelta en su punto).
  const cur: number[] | null = hover != null ? series.map(() => hover) : cursors ? (cursors.length === series.length ? cursors : series.map(() => cursors[0]!)) : null;
  const lead = cur && cur.length ? Math.max(...cur) : null;
  const inView = lead != null && lead >= v0 && lead <= v1;

  return (
    <div className="compare-chart" ref={box} onPointerLeave={() => onHover(null)}>
      <div className="compare-chart-head">
        <strong>{title}</strong>{subtitle && <span className="muted">{subtitle}</span>}
        {lead != null && (readout
          ? <span className="chart-read num">{readout(lead)}</span>
          : <span className="chart-read num">{series.map((s, i) => <span key={i} style={{ color: s.color }}>{format(s.values[cur![i] ?? lead]!)}</span>)}</span>)}
        {order && <ChartOrderButtons order={order} />}
      </div>
      <svg
        ref={svgEl}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        className={zoomed ? 'zoomed' : undefined}
        aria-label={`${title}: ${series.map((s) => s.label).join(', ')}`}
        onDoubleClick={() => onView([0, Math.max(1, n - 1)])}
        onPointerDown={(e) => { if (e.button !== 0 || !zoomed) return; drag.current = { id: e.pointerId, x: e.clientX, v: [v0, v1], moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const d = drag.current;
          if (d && d.id === e.pointerId) {
            // Arrastrar mueve el tramo visible
            const dv = -((e.clientX - d.x) / r.width) * (W / plotW) * (d.v[1] - d.v[0]);
            if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
            onView(panView(d.v, n, dv));
            return;
          }
          const px = ((e.clientX - r.left) / r.width) * W;
          onHover(Math.max(0, Math.min(n - 1, Math.round(v0 + ((px - PAD.l) / plotW) * (v1 - v0)))));
        }}
      >
        <defs><clipPath id={clipId}><rect x={PAD.l} y={0} width={plotW} height={H} /></clipPath></defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{fmtTick(t)}</text>
          </g>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {bands?.filter((b) => b.i1 >= v0 && b.i0 <= v1).map((b) => (
            <rect key={b.label} x={x(b.i0)} y={P.t} width={Math.max(1, x(b.i1) - x(b.i0))} height={plotH} className={`chart-band ${b.hot ? 'hot' : ''}`} />
          ))}
          {areas && <><path d={areas.up} fill={fill!.above} className="chart-fill" /><path d={areas.dn} fill={fill!.below} className="chart-fill" /></>}
        </g>
        {zeroLine && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="chart-zero" />}
        {bandLabels && bands?.filter((b) => b.i1 >= v0 && b.i0 <= v1).map((b) => (
          <text key={b.label} x={Math.max(PAD.l + 8, Math.min(W - PAD.r - 8, (x(b.i0) + x(b.i1)) / 2))} y={15} textAnchor="middle" className={`chart-band-label ${b.hot ? 'hot' : ''}`}>{b.label}</text>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={PAD.l + f * plotW} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="chart-axis">{Math.round(((v0 + f * (v1 - v0)) / Math.max(1, n - 1)) * lengthM)} m</text>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {series.map((s, i) => <path key={i} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />)}
          {marks?.map((m, row) => runsOf(m.values, first, last).map((r) => (
            <rect key={`${row}-${r[0]}`} x={x(r[0])} y={H - P.b - 5 - row * 5} width={Math.max(1.5, x(r[1] + 1) - x(r[0]))} height={3} fill={m.color} className="chart-mark" />
          )))}
        </g>
        {inView && (
          <g pointerEvents="none">
            <line x1={x(lead!)} x2={x(lead!)} y1={P.t} y2={H - P.b} className="chart-cursor" />
            {series.map((s, i) => (cur![i]! >= v0 && cur![i]! <= v1 ? <circle key={i} cx={x(cur![i]!)} cy={y(s.values[cur![i]!]!)} r={4} fill={s.color} className="chart-pin" /> : null))}
          </g>
        )}
      </svg>
    </div>
  );
}
