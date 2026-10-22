import { hour12 } from '../prefs';
import { useMemo, useState } from 'react';
import { formatLapTime, type DriverProgressDto } from '@howler/shared';
import { fmtDate } from '../format';
import { locale, t } from '../i18n';

const fmtAt = (iso: string, withTime: boolean) => (withTime ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: hour12() }) : fmtDate(iso));

const W = 960, H = 210, PAD = { l: 58, r: 14, t: 14, b: 26 };

/**
 * Evolución del mejor tiempo de un piloto en una combinación: escalón por cada mejora, lo más rápido arriba.
 * La línea baja en tiempo y sube en el dibujo, así «mejorar» siempre se ve como subir.
 */
export function ProgressChart({ progress }: { progress: DriverProgressDto }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = progress.points;
  const geo = useMemo(() => {
    const times = pts.map((p) => new Date(p.at).getTime());
    const t0 = times[0]!, t1 = Math.max(times[times.length - 1]!, t0 + 1);
    const ms = pts.map((p) => p.ms);
    const lo = Math.min(...ms), hi = Math.max(...ms);
    const span = Math.max(hi - lo, 200);
    const x = (v: number) => PAD.l + ((v - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + ((v - (lo - span * 0.1)) / (span * 1.2)) * (H - PAD.t - PAD.b);
    return { xs: times.map(x), ys: ms.map(y), lo, hi };
  }, [pts]);

  if (pts.length < 2) return <p className="empty">{t('Aún no ha mejorado su tiempo en esta combinación: solo tiene una vuelta válida ({time}).', { time: formatLapTime(pts[0]?.ms) })}</p>;

  // Escalón: se mantiene el tiempo hasta la siguiente mejora
  const path = pts.map((_, i) => (i === 0 ? `M${geo.xs[0]},${geo.ys[0]}` : `H${geo.xs[i]}V${geo.ys[i]}`)).join('') + `H${W - PAD.r}`;
  const first = pts[0]!.ms, last = pts[pts.length - 1]!.ms;
  const h = hover != null ? pts[hover]! : null;
  // Si todo ocurrió en un mismo día, el eje enseña la hora en lugar de dos fechas iguales
  const sameDay = new Date(pts[0]!.at).toDateString() === new Date(pts[pts.length - 1]!.at).toDateString();

  return (
    <div className="progress-chart" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Mejoró de {a} a {b} en {n} mejoras', { a: formatLapTime(first), b: formatLapTime(last), n: pts.length - 1 })}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="chart-grid" />
        <text x={PAD.l - 6} y={geo.ys[geo.ys.length - 1]! + 4} textAnchor="end" className="chart-axis">{formatLapTime(geo.lo)}</text>
        <text x={PAD.l - 6} y={geo.ys[0]! + 4} textAnchor="end" className="chart-axis">{formatLapTime(first)}</text>
        <text x={PAD.l} y={H - 8} className="chart-axis">{fmtAt(pts[0]!.at, sameDay)}</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="chart-axis">{fmtAt(pts[pts.length - 1]!.at, sameDay)}</text>
        <path d={path} fill="none" className="progress-line" />
        {pts.map((p, i) => (
          <circle key={i} cx={geo.xs[i]} cy={geo.ys[i]} r={hover === i ? 6 : 4} className="progress-dot" onPointerEnter={() => setHover(i)}>
            <title>{`${formatLapTime(p.ms)} · ${fmtDate(p.at)}`}</title>
          </circle>
        ))}
      </svg>
      <p className="muted">{h ? `${formatLapTime(h.ms)} · ${fmtDate(h.at)}` : t('Ha bajado {s} s en {n} mejoras.', { s: ((first - last) / 1000).toFixed(3), n: pts.length - 1 })}</p>
    </div>
  );
}
