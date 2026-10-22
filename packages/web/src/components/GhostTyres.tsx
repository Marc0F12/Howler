import { useEffect, useState } from 'react';
import type { ReplayLapDto } from '@howler/shared';
import { t } from '../i18n';
import { pressureUnit, pressureValue, tempUnit, tempValue } from '../prefs';
import { tempColor } from './CompareTyres';
import { sampleChannel } from './ghost-math';

const WHEELS = [{ x: 4, y: 6 }, { x: 74, y: 6 }, { x: 4, y: 62 }, { x: 74, y: 62 }] as const;
const KEY = 'howler.ghost.tyres';

export interface TyreEls { rect: (SVGRectElement | null)[]; temp: (SVGTextElement | null)[]; pres: (SVGTextElement | null)[] }
export const hasTyres = (g: ReplayLapDto) => !!(g.trace?.temp && g.trace.pres);

/** Pinta en cada fotograma la temperatura y presión de las 4 ruedas de cada fantasma en el instante t (escribe directo en el DOM). */
export function updateTyres(ghosts: ReplayLapDto[], t: number, hidden: Set<number>, els: Map<number, TyreEls>) {
  for (const g of ghosts) {
    const tr = g.trace, e = els.get(g.rank);
    if (!tr?.temp || !tr.pres || !e || hidden.has(g.rank)) continue;
    const tt = Math.min(t, g.lapMs);
    for (let w = 0; w < 4; w++) {
      const c = sampleChannel(tr.t, tr.temp[w]!, tt), p = sampleChannel(tr.t, tr.pres[w]!, tt);
      e.rect[w]?.style.setProperty('fill', tempColor(c));
      if (e.temp[w]) e.temp[w]!.textContent = `${Math.round(tempValue(c))}`;
      if (e.pres[w]) e.pres[w]!.textContent = pressureValue(p).toFixed(1);
    }
  }
}

/** Neumáticos de cada fantasma: el coche visto desde arriba con sus 4 ruedas coloreadas por temperatura. Oculto por defecto (se recuerda). */
export function GhostTyres({ ghosts, colors, hidden, register, onShown }: {
  ghosts: ReplayLapDto[]; colors: Record<number, string>; hidden: Set<number>; onShown: () => void;
  register: (rank: number, els: TyreEls) => void;
}) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  useEffect(() => { if (on) onShown(); }); // al pintarse, rellena los números del instante actual
  const list = ghosts.filter(hasTyres);
  if (list.length === 0) {
    // Sin datos de ruedas en estas vueltas: se explica en vez de no enseñar nada (se graban solo con jugadores que usen CSP, en vueltas nuevas).
    return (
      <div className="ghost-tyres">
        <div className="ghost-forces-head"><strong>{t('Neumáticos')}</strong></div>
        <p className="muted">{t('Estas vueltas no traen datos de neumáticos. Se graban con jugadores que usen CSP, en las vueltas nuevas.')}</p>
      </div>
    );
  }
  const toggle = () => { const v = !on; setOn(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  return (
    <div className="ghost-tyres">
      <div className="ghost-forces-head">
        <strong>{t('Neumáticos')}</strong>
        <button type="button" className="ghost-btn small" aria-pressed={on} onClick={toggle}>{on ? t('Ocultar') : t('Mostrar')}</button>
      </div>
      {on && (
        <div className="ghost-tyres-row">
          {list.filter((g) => !hidden.has(g.rank)).map((g) => {
            const els: TyreEls = { rect: [], temp: [], pres: [] };
            return (
              <figure key={g.rank} className="ghost-tyre" style={{ ['--lapc' as string]: colors[g.rank] }}>
                <figcaption><i className="swatch" />{g.driverName}</figcaption>
                <svg viewBox="0 0 140 130" role="img" aria-label={t('Neumáticos de {name}', { name: g.driverName })} ref={() => register(g.rank, els)}>
                  {WHEELS.map((p, w) => (
                    <g key={w}>
                      <rect ref={(el) => { els.rect[w] = el; }} x={p.x} y={p.y} width={62} height={62} rx={8} className="tyre-rubber" style={{ fill: 'var(--surface2)' }} />
                      <text ref={(el) => { els.temp[w] = el; }} x={p.x + 31} y={p.y + 28} textAnchor="middle" className="tyre-temp">—</text>
                      <text ref={(el) => { els.pres[w] = el; }} x={p.x + 31} y={p.y + 48} textAnchor="middle" className="tyre-pres">—</text>
                    </g>
                  ))}
                </svg>
                <small className="muted">{tempUnit()} · {pressureUnit()}</small>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
