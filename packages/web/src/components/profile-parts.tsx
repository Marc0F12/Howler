import { formatDay } from '../format';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityDayDto } from '@howler/shared';
import { Preview } from './Carousel3D';
import { locale, t } from '../i18n';

/** Foto de perfil de Steam de un piloto (la sirve Howler); sin foto, sus iniciales. */
export function Avatar({ driverId, name, size = 40 }: { driverId: number; name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      <Preview className="avatar-img" image={`/api/drivers/${driverId}/avatar`} title={name} />
    </span>
  );
}

export interface Stat { label: string; value: ReactNode; sub?: ReactNode }

/** Cuadrícula de cifras clave: el valor grande, la etiqueta pequeña debajo. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="stat-grid">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <dt>{s.label}</dt>
          <dd className="num">{s.value}</dd>
          {s.sub != null && <span className="stat-sub">{s.sub}</span>}
        </div>
      ))}
    </dl>
  );
}

/** Contenedor de una sección de ficha: título y contenido. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

const DAYS = 90;
const H = 120, PAD = { l: 28, r: 6, t: 10, b: 20 };

/**
 * Vueltas por día de los últimos 90 días: una sola serie de barras desde cero. Pasar el ratón enseña el día y las
 * vueltas; sin actividad, un mensaje en lugar de una gráfica vacía.
 */
export function ActivityChart({ days }: { days: ActivityDayDto[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // El ancho del dibujo sigue al del contenedor: así la letra mide siempre lo mismo, sea la gráfica ancha o estrecha.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  const series = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d.laps]));
    const out: { day: string; laps: number }[] = [];
    const end = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day: d, laps: byDay.get(d) ?? 0 });
    }
    return out;
  }, [days]);
  useEffect(() => setHover(null), [days]);
  const total = series.reduce((a, d) => a + d.laps, 0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth - 32))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [total > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (total === 0) return <p className="empty">{t('Sin actividad en los últimos 90 días.')}</p>;

  const max = Math.max(...series.map((d) => d.laps));
  const step = (W - PAD.l - PAD.r) / DAYS;
  const bw = Math.max(2, step - 2);
  const plotH = H - PAD.t - PAD.b;
  const h = (v: number) => (v / max) * plotH;
  const hv = hover != null ? series[hover]! : null;
  const monthTicks = series.map((d, i) => ({ d, i })).filter(({ d }) => d.day.endsWith('-01') || false);

  return (
    <div className="activity" ref={wrap} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('{total} vueltas en los últimos 90 días, hasta {max} en un día', { total, max })}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((((e.clientX - r.left) / r.width) * W - PAD.l) / step);
          setHover(i >= 0 && i < DAYS ? i : null);
        }}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="chart-grid" />
        <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" className="chart-axis">{max}</text>
        <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="chart-axis">0</text>
        {series.map((d, i) => d.laps > 0 && (
          <rect key={d.day} x={PAD.l + i * step + (step - bw) / 2} y={H - PAD.b - h(d.laps)} width={bw} height={h(d.laps)} rx={2}
            className={`activity-bar ${hover === i ? 'on' : ''}`} />
        ))}
        {monthTicks.map(({ d, i }) => (
          <text key={d.day} x={PAD.l + i * step} y={H - 5} className="chart-axis">{new Date(d.day).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })}</text>
        ))}
        <text x={W - PAD.r} y={H - 5} textAnchor="end" className="chart-axis">{t('hoy')}</text>
        {hv && <line x1={PAD.l + hover! * step + step / 2} x2={PAD.l + hover! * step + step / 2} y1={PAD.t} y2={H - PAD.b} className="chart-cursor" />}
      </svg>
      {hv && (
        <div className="chart-tip" style={{ left: `${((PAD.l + hover! * step + step / 2) / W) * 100}%` }} role="status">
          <strong>{formatDay(new Date(hv.day), { month: 'short', timeZone: 'UTC' })}</strong> · {hv.laps === 1 ? t('1 vuelta') : t('{n} vueltas', { n: hv.laps })}
        </div>
      )}
    </div>
  );
}
