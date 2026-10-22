import { speedValue, speedUnit } from '../prefs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReplayLapDto } from '@howler/shared';
import { t } from '../i18n';
import { ChartOrderButtons, EyeButton } from './ChartOrder';
import { runsOf } from './CompareChart';
import { followView, panView, zoomView, type View } from './chart-zoom';
import { gripPct } from './compare-math';
import { sampleChannel } from './ghost-math';
import { useChartOrder } from '../hooks/useChartOrder';

/** El tramo visible se mide en milésimas de vuelta (0..1000), así el zoom y el desplazamiento no dependen de cuánto dure cada vuelta. */
export const TEL_FULL: View = [0, 1000];
const TEL_N = 1001;

const W = 900, PAD = { l: 44, r: 10, t: 6, b: 6 };
const PLOT_W = W - PAD.l - PAD.r;

interface Channel {
  key: string; label: string; unit: string; h: number;
  get: (g: ReplayLapDto) => number[] | undefined;
  min: number; max: number | 'auto'; ticks: number[];
  /** Cómo se escribe el valor bajo el cursor. */
  fmt: (v: number) => string;
  /** Marcas finas bajo las líneas (ABS o control de tracción actuando), una fila por vuelta. */
  marks?: (g: ReplayLapDto) => number[] | undefined;
}

const pct = (v: number) => `${Math.round(v)} %`;
const gFmt = (v: number) => `${v.toFixed(2)} g`;

const CHANNELS: Channel[] = [
  { key: 'v', label: t('Velocidad'), unit: speedUnit(), h: 84, get: (g) => g.trace?.v?.map(speedValue), min: 0, max: 'auto', ticks: [], fmt: (v) => `${Math.round(v)} ${speedUnit()}` },
  { key: 'gas', label: t('Acelerador'), unit: '%', h: 52, get: (g) => g.trace?.gas?.map((x) => x * 100), min: 0, max: 100, ticks: [0, 100], fmt: pct, marks: (g) => g.trace?.tc },
  { key: 'brake', label: t('Freno'), unit: '%', h: 36, get: (g) => g.trace?.brake?.map((x) => x * 100), min: 0, max: 100, ticks: [], fmt: pct, marks: (g) => g.trace?.abs },
  { key: 'steer', label: t('Volante'), unit: '%', h: 52, get: (g) => g.trace?.steer?.map((x) => x * 100), min: -100, max: 100, ticks: [-100, 0, 100], fmt: pct },
  { key: 'slip', label: t('Agarre'), unit: '%', h: 44, get: (g) => g.trace?.slip?.map((x) => gripPct(x)), min: 0, max: 100, ticks: [0, 50, 100], fmt: pct },
  { key: 'glon', label: t('G longitudinal'), unit: 'g', h: 44, get: (g) => g.trace?.lonG, min: -3, max: 3, ticks: [-3, 0, 3], fmt: gFmt },
  { key: 'glat', label: t('G lateral'), unit: 'g', h: 44, get: (g) => g.trace?.latG, min: -3, max: 3, ticks: [-3, 0, 3], fmt: gFmt },
];

/** X (en unidades del dibujo) de un instante dentro del tramo visible: lo comparten las gráficas y el cursor de reproducción. */
export const telemetryX = (t: number, totalMs: number, view: View = TEL_FULL) => {
  const a = (view[0] / 1000) * totalMs, b = (view[1] / 1000) * totalMs;
  return PAD.l + ((t - a) / Math.max(1, b - a)) * PLOT_W;
};

const fmtMs = (ms: number) => { const m = Math.floor(ms / 60000), s = (ms - m * 60000) / 1000; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

/**
 * Gráficas de los fantasmas visibles en función del tiempo de vuelta, con un cursor que sigue la reproducción.
 * - Pasar el ratón por una gráfica marca ese instante en todas y enseña el valor de cada vuelta ahí.
 * - Pulsar o arrastrar salta a ese instante (sin zoom).
 * - La rueda hace zoom (el tramo visible es común a todas las gráficas); con zoom, la gráfica SIGUE al coche mientras se reproduce
 *   (botón «Seguir»); arrastrar mueve el tramo a mano y deja de seguir; doble clic lo muestra todo.
 * - Cada gráfica se puede subir o bajar de sitio con sus flechas (el orden se recuerda en este navegador).
 */
export function GhostTelemetry({ ghosts, colors, totalMs, onSeek, registerHead, onView, getClock }: {
  ghosts: ReplayLapDto[]; colors: Record<number, string>; totalMs: number; onSeek: (ms: number) => void;
  registerHead: (el: SVGLineElement | null, id: string) => void;
  /** Avisa al visor cuando cambia el tramo visible (para colocar bien el cursor de reproducción). */
  onView: (v: View) => void;
  /** Instante actual de la reproducción (ms). */
  getClock: () => number;
}) {
  const chartOrder = useChartOrder('howler.ghost.order', CHANNELS.map((c) => c.key));
  const [off, setOff] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem('howler.ghost.hiddenCharts') ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } });
  const toggleOff = (key: string) => setOff((o) => { const n = o.includes(key) ? o.filter((k) => k !== key) : [...o, key]; try { localStorage.setItem('howler.ghost.hiddenCharts', JSON.stringify(n)); } catch { /* sin almacenamiento */ } return n; });
  const channels = useMemo(
    () => CHANNELS.filter((c) => ghosts.some((g) => c.get(g))).sort((a, b) => chartOrder.order.indexOf(a.key) - chartOrder.order.indexOf(b.key)),
    [ghosts, chartOrder.order],
  );
  const box = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>(TEL_FULL);
  const viewRef = useRef<View>(TEL_FULL);
  const [follow, setFollow] = useState(true);
  const [hover, setHover] = useState<{ ms: number; key: string } | null>(null);
  const drag = useRef<{ id: number; x: number; v: View; moved: boolean } | null>(null);
  const hasCharts = ghosts.length > 0;
  const zoomed = view[1] - view[0] < 1000 - 1e-6;
  const a = (view[0] / 1000) * totalMs, b = (view[1] / 1000) * totalMs;

  const apply = (v: View) => { viewRef.current = v; setViewState(v); onView(v); };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // La rueda hace zoom alrededor del puntero; se registra sin pasividad para poder frenar el desplazamiento de la página.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const svg = (e.target as Element).closest('.ghost-chart');
      if (!svg) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, ((((e.clientX - r.left) / r.width) * W) - PAD.l) / PLOT_W));
      applyRef.current(zoomView(viewRef.current, TEL_N, Math.exp(-e.deltaY * 0.0015), f));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasCharts]);

  // Con zoom, el tramo visible sigue al coche mientras se reproduce.
  useEffect(() => {
    if (!follow) return;
    const id = setInterval(() => {
      if (drag.current) return;
      const next = followView(viewRef.current, TEL_N, (Math.min(getClock(), totalMs) / Math.max(1, totalMs)) * 1000);
      if (next) applyRef.current(next);
    }, 60);
    return () => clearInterval(id);
  }, [follow, totalMs, getClock]);

  if (!hasCharts) return null;
  const timeAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    return a + ((x - PAD.l) / PLOT_W) * (b - a);
  };
  const resetView = () => { setFollow(true); apply(TEL_FULL); };

  return (
    <div className="ghost-telemetry" aria-label={t('Gráficas de las vueltas')} ref={box} onPointerLeave={() => setHover(null)}>
      <div className="ghost-tel-bar">
        <span className="muted">{zoomed ? `${fmtMs(a)} – ${fmtMs(b)}` : t('Rueda = zoom en las gráficas; doble clic = ver todo.')}</span>
        <span className="ghost-tel-actions">
          {zoomed && <button type="button" className="ghost-btn small" aria-pressed={follow} onClick={() => setFollow(!follow)} title={t('El tramo visible sigue al coche mientras se reproduce')}>{t('Seguir')}</button>}
          {zoomed && <button type="button" className="ghost-btn small" onClick={resetView}>{t('Ver todo')}</button>}
          {chartOrder.changed && <button type="button" className="ghost-btn small" onClick={chartOrder.reset}>{t('Orden original')}</button>}
        </span>
      </div>
      {channels.map((c) => {
        const shown = channels.filter((x) => !off.includes(x.key));
        const up = shown[shown.indexOf(c) - 1], down = shown[shown.indexOf(c) + 1];
        if (off.includes(c.key)) {
          return (
            <div key={c.key} className="ghost-chart-collapsed">
              <EyeButton closed onClick={() => toggleOff(c.key)} label={t('Mostrar gráfica')} />
              <span className="muted">{c.label}{c.unit ? ` (${c.unit})` : ''}</span>
            </div>
          );
        }
        const series = ghosts.map((g) => ({ g, v: c.get(g) })).filter((s): s is { g: ReplayLapDto; v: number[] } => !!s.v);
        const visible = (g: ReplayLapDto, v: number[]) => v.filter((_, i) => { const tt = g.trace!.t[i]!; return tt >= a && tt <= b; });
        // La escala vertical de la velocidad se ajusta a lo que se ve: así, al acercar, las diferencias pequeñas se aprecian.
        const max = c.max === 'auto' ? Math.max(50, ...series.flatMap((s) => visible(s.g, s.v))) * 1.05 : c.max;
        const H = c.h, ph = H - PAD.t - PAD.b;
        const y = (v: number) => PAD.t + (1 - (v - c.min) / (max - c.min)) * ph;
        const ticks = c.ticks.length ? c.ticks : [c.min, Math.round(max / 2 / 10) * 10, Math.round(max / 10) * 10];
        const pctTop = (v: number) => `${(y(v) / H) * 100}%`;
        const clip = `gt-clip-${c.key}`;
        const hx = hover && hover.ms >= a && hover.ms <= b ? telemetryX(hover.ms, totalMs, view) : null;
        const markRows = series.map((s) => ({ s, m: c.marks?.(s.g) })).filter((r) => r.m);
        return (
          <div key={c.key} className="ghost-chart-wrap" style={{ height: H }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ghost-chart" role="img" aria-label={`${c.label}${c.unit ? ` (${c.unit})` : ''}`}
              onDoubleClick={resetView}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                if (zoomed) drag.current = { id: e.pointerId, x: e.clientX, v: viewRef.current, moved: false };
                else onSeek(timeAt(e));
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d && d.id === e.pointerId) {
                  // Con zoom, arrastrar mueve el tramo visible (y deja de seguir al coche); si apenas se movió, al soltar cuenta como un clic.
                  if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
                  if (d.moved) {
                    setFollow(false);
                    const r = e.currentTarget.getBoundingClientRect();
                    apply(panView(d.v, TEL_N, -((e.clientX - d.x) / r.width) * (W / PLOT_W) * (d.v[1] - d.v[0])));
                  }
                } else if (e.buttons && !zoomed) onSeek(timeAt(e));
                else if (!e.buttons) setHover({ ms: timeAt(e), key: c.key });
              }}
              onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) onSeek(timeAt(e)); }}
              onPointerCancel={() => { drag.current = null; }}>
              <defs><clipPath id={clip}><rect x={PAD.l} y={0} width={PLOT_W} height={H} /></clipPath></defs>
              {ticks.map((tv) => <line key={tv} x1={PAD.l} x2={W - PAD.r} y1={y(tv)} y2={y(tv)} className="chart-grid" vectorEffect="non-scaling-stroke" />)}
              <g clipPath={`url(#${clip})`}>
                {series.map(({ g, v }) => {
                  const ts = g.trace!.t;
                  const pts = ts.map((tt, i) => `${telemetryX(tt, totalMs, view).toFixed(1)},${y(v[i]!).toFixed(1)}`).join(' ');
                  return <polyline key={g.rank} points={pts} fill="none" stroke={colors[g.rank]} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeOpacity={0.95} />;
                })}
                {markRows.map(({ s, m }, row) => runsOf(m!, 0, m!.length - 1).map((r) => {
                  const ts = s.g.trace!.t, x0 = telemetryX(ts[r[0]]!, totalMs, view), x1 = telemetryX(ts[Math.min(ts.length - 1, r[1] + 1)]!, totalMs, view);
                  return <rect key={`${s.g.rank}-${r[0]}`} x={x0} y={H - PAD.b - 4 - row * 4} width={Math.max(1.5, x1 - x0)} height={3} fill={colors[s.g.rank]} />;
                }))}
                {hx != null && <line x1={hx} x2={hx} y1={0} y2={H} className="ghost-hover" vectorEffect="non-scaling-stroke" />}
                <line ref={(el) => registerHead(el, c.key)} x1={PAD.l} x2={PAD.l} y1={0} y2={H} className="ghost-head" vectorEffect="non-scaling-stroke" />
              </g>
            </svg>
            {channels.length > 0 && (
              <span className="chart-order-abs">
                <ChartOrderButtons order={{ canUp: !!up, canDown: !!down, onUp: () => up && chartOrder.swap(c.key, up.key), onDown: () => down && chartOrder.swap(c.key, down.key), onHide: () => toggleOff(c.key) }} />
              </span>
            )}
            <span className="chart-label" style={{ left: `calc(${(PAD.l / W) * 100}% + 6px)` }}>{c.label}{c.unit ? ` (${c.unit})` : ''}</span>
            {ticks.map((tv) => <span key={tv} className="chart-tick" style={{ top: pctTop(tv), width: `${((PAD.l - 6) / W) * 100}%` }}>{Math.round(tv)}</span>)}
            {hover && hover.key === c.key && hx != null && (
              <div className="chart-tip ghost-tip" style={{ left: `${(hx / W) * 100}%` }} role="status">
                <strong>{fmtMs(hover.ms)}</strong>
                {series.map(({ g, v }) => <span key={g.rank} className="tip-row"><i style={{ background: colors[g.rank] }} />{c.fmt(sampleChannel(g.trace!.t, v, hover.ms))}</span>)}
              </div>
            )}
          </div>
        );
      })}
      {!channels.some((c) => c.key === 'gas') && <p className="note">{t('Acelerador, freno y volante aparecen en las vueltas grabadas con el plugin de Howler actualizado (hay que reiniciar el servidor de AC tras instalarlo).')}</p>}
    </div>
  );
}
