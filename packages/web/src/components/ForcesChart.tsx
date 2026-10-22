import { t } from '../i18n';
import type { compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;

/**
 * «Círculo de fuerzas»: cada punto es una muestra de la vuelta (g lateral en horizontal, g longitudinal en vertical). Son los g
 * que mide el juego de cada jugador (script de CSP), no una estimación; por eso solo sale si todas las vueltas los traen.
 */
export function ForcesChart({ cmp, names, colors, hover, cursors }: { cmp: Comparison; names: string[]; colors: string[]; hover: number | null; cursors?: number[] | null }) {
  const lat = cmp.latG, lon = cmp.lonG;
  if (!lat || !lon) return null;
  const R = 220, M = 14, S = R + M;
  const peak = Math.max(...lat.flatMap((a) => a.map(Math.abs)), ...lon.flatMap((a) => a.map(Math.abs)));
  const lim = Math.max(1.2, Math.min(4, peak * 1.05));
  const px = (g: number) => S + (g / lim) * R;
  const py = (g: number) => S + (g / lim) * R; // como la sensación en el cuerpo: al acelerar el punto va hacia atrás (abajo), al frenar hacia delante (arriba)
  const rings = [1, 2, 3, 4].filter((g) => g <= lim);
  return (
    <div className="forces-chart">
      <svg viewBox={`0 0 ${2 * S} ${2 * S}`} role="img" aria-label={t('Círculo de fuerzas de cada vuelta')}>
        {rings.map((g) => <circle key={g} cx={S} cy={S} r={(g / lim) * R} className="chart-grid" fill="none" />)}
        <line x1={M} x2={2 * S - M} y1={S} y2={S} className="chart-grid" />
        <line x1={S} x2={S} y1={M} y2={2 * S - M} className="chart-grid" />
        {rings.map((g) => <text key={g} x={S + (g / lim) * R - 4} y={S - 4} textAnchor="end" className="chart-axis">{g} g</text>)}
        <text x={S} y={M + 2} textAnchor="middle" className="chart-axis">{t('frena')}</text>
        <text x={S} y={2 * S - 3} textAnchor="middle" className="chart-axis">{t('acelera')}</text>
        {lat.map((a, i) => (
          <g key={i} fill={colors[i]} opacity={0.55}>
            {a.map((x, k) => (k % 2 === 0 ? <circle key={k} cx={px(x)} cy={py(lon[i]![k]!)} r={2.2} /> : null))}
          </g>
        ))}
        {/* El punto de cada vuelta: bajo el puntero, o por donde va en la reproducción. */}
        {(hover != null || cursors) && lat.map((a, i) => { const k = hover != null ? hover : cursors![i]!; return <circle key={`h${i}`} cx={px(a[k]!)} cy={py(lon[i]![k]!)} r={6} fill={colors[i]} stroke="var(--bg)" strokeWidth={2} />; })}
      </svg>
      <ul className="compare-legend">{names.map((n, i) => <li key={i}><i className="swatch" style={{ background: colors[i] }} />{n}</li>)}</ul>
    </div>
  );
}
