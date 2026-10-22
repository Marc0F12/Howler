import type { ReplayLapDto } from '@howler/shared';
import { t } from '../i18n';
import { sampleChannel } from './ghost-math';

const S = 100, R = 88; // centro y radio del dibujo (viewBox 200 × 200)
const TRAIL_STEPS = 12, TRAIL_STEP_MS = 150; // estela: los últimos ~1,8 s

/** Escala del círculo (g): lo que llega la vuelta que más fuerza hace, entre 1,2 y 4; null si ningún fantasma trae g. */
export function forcesLimit(ghosts: ReplayLapDto[]): number | null {
  const withG = ghosts.filter((g) => g.trace?.latG && g.trace.lonG);
  if (withG.length === 0) return null;
  const peak = Math.max(...withG.flatMap((g) => [...g.trace!.latG!, ...g.trace!.lonG!].map(Math.abs)));
  return Math.max(1.2, Math.min(4, peak * 1.05));
}

export interface ForceEls { dot: SVGCircleElement | null; trail: SVGPolylineElement | null }

/**
 * Mueve el punto de cada fantasma por el círculo de fuerzas (g lateral en horizontal, g longitudinal en vertical) con una estela de
 * los últimos instantes, igual que se reproduce el coche en el mapa. Escribe directamente en el DOM (se llama en cada fotograma).
 */
export function updateForces(ghosts: ReplayLapDto[], t: number, lim: number, hidden: Set<number>, els: Map<number, ForceEls>) {
  const px = (g: number) => (S + (g / lim) * R).toFixed(1), py = (g: number) => (S + (g / lim) * R).toFixed(1);
  for (const g of ghosts) {
    const tr = g.trace, e = els.get(g.rank);
    if (!tr?.latG || !tr.lonG || !e?.dot || !e.trail) continue;
    const off = hidden.has(g.rank);
    e.dot.style.display = off ? 'none' : '';
    e.trail.style.display = off ? 'none' : '';
    if (off) continue;
    const tt = Math.min(t, g.lapMs);
    e.dot.setAttribute('cx', px(sampleChannel(tr.t, tr.latG, tt)));
    e.dot.setAttribute('cy', py(sampleChannel(tr.t, tr.lonG, tt)));
    const pts: string[] = [];
    for (let k = TRAIL_STEPS; k >= 0; k--) {
      const q = Math.max(0, tt - k * TRAIL_STEP_MS);
      pts.push(`${px(sampleChannel(tr.t, tr.latG, q))},${py(sampleChannel(tr.t, tr.lonG, q))}`);
    }
    e.trail.setAttribute('points', pts.join(' '));
  }
}

/** El «círculo de fuerzas»: anillos de 1, 2, 3 g y un punto por fantasma con su estela. */
export function GhostForces({ ghosts, colors, lim, register }: {
  ghosts: ReplayLapDto[]; colors: Record<number, string>; lim: number;
  register: (rank: number, part: 'dot' | 'trail', el: SVGElement | null) => void;
}) {
  const rings = [1, 2, 3, 4].filter((g) => g <= lim);
  return (
    <svg className="ghost-forces-svg" viewBox="0 0 200 200" role="img" aria-label={t('Círculo de fuerzas de cada vuelta')}>
      {rings.map((g) => <circle key={g} cx={S} cy={S} r={(g / lim) * R} className="chart-grid" fill="none" />)}
      <line x1={S - R} x2={S + R} y1={S} y2={S} className="chart-grid" />
      <line x1={S} x2={S} y1={S - R} y2={S + R} className="chart-grid" />
      {rings.map((g) => <text key={g} x={S + (g / lim) * R - 3} y={S - 3} textAnchor="end" className="chart-axis">{g} g</text>)}
      <text x={S} y={10} textAnchor="middle" className="chart-axis">{t('frena')}</text>
      <text x={S} y={196} textAnchor="middle" className="chart-axis">{t('acelera')}</text>
      {ghosts.filter((g) => g.trace?.latG && g.trace.lonG).map((g) => (
        <g key={g.rank}>
          <polyline ref={(el) => register(g.rank, 'trail', el)} fill="none" stroke={colors[g.rank]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
          <circle ref={(el) => register(g.rank, 'dot', el)} cx={S} cy={S} r={5.5} fill={colors[g.rank]} stroke="var(--bg)" strokeWidth={1.5} />
        </g>
      ))}
    </svg>
  );
}
