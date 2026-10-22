import { useState } from 'react';
import { t } from '../i18n';
import { pressureUnit, pressureValue, tempUnit, tempValue } from '../prefs';
import { CompareChart, type CompareSeries, type CurveBand } from './CompareChart';
import type { View } from './chart-zoom';
import { ChartOrderButtons, type OrderProps } from './ChartOrder';
import type { compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;

/** Posición de cada rueda en el dibujo del coche visto desde arriba (FL, FR, RL, RR; el morro arriba). */
const WHEELS = [
  { x: 4, y: 22 }, { x: 154, y: 22 }, { x: 4, y: 130 }, { x: 154, y: 130 },
] as const;
const W_W = 62, W_H = 78;

/** Color de una temperatura (°C): azul = fría, verde = en ventana, ámbar = caliente, rojo = muy caliente. Mezcla colores del tema. */
export function tempColor(c: number): string {
  const stops: [number, string][] = [[50, 'var(--chart-1)'], [80, 'var(--chart-3)'], [100, 'var(--chart-4)'], [120, 'var(--down)']];
  if (c <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!, [t0, c0] = stops[i - 1]!;
    if (c <= t1) return `color-mix(in srgb, ${c1} ${Math.round(((c - t0) / (t1 - t0)) * 100)}%, ${c0})`;
  }
  return stops.at(-1)![1];
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/**
 * Neumáticos: por cada vuelta, el coche visto desde arriba con sus 4 ruedas, coloreadas por temperatura y con su temperatura
 * y presión. Siguen al cursor (puntero sobre las gráficas o reproducción); sin cursor, media de la vuelta. Pulsar una rueda
 * enseña debajo la gráfica de esa rueda (temperatura y presión de todas las vueltas).
 */
export function CompareTyres({ cmp, names, colors, dashes, hover, cursors, chart, order }: {
  cmp: Comparison; names: string[]; colors: string[]; dashes: (string | undefined)[]; hover: number | null; cursors?: number[];
  /** Lo que comparten todas las gráficas: longitud, cursor, zoom y bandas de curvas. */
  chart: { lengthM: number; hover: number | null; onHover: (i: number | null) => void; view: View; onView: (v: View) => void; bands?: CurveBand[]; cursors?: number[] };
  /** Flechas para subir o bajar de sitio (las pone `OrderedCharts`). */
  order?: OrderProps;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const temp = cmp.temp, pres = cmp.pres;
  if (!temp || !pres) return null;
  const wheelNames = [t('Delantera izquierda'), t('Delantera derecha'), t('Trasera izquierda'), t('Trasera derecha')];
  const series = (data: number[][][], w: number, f: (v: number) => number): CompareSeries[] =>
    names.map((label, i) => ({ label, color: colors[i]!, dash: dashes[i], values: data[i]![w]!.map(f) }));
  const at = (i: number) => (hover != null ? hover : cursors ? cursors[i]! : null);

  return (
    <div className="tyres">
      <div className="tyres-head"><strong>{t('Neumáticos')}</strong>{order && <ChartOrderButtons order={order} />}</div>
      <div className="tyres-row">
        {names.map((name, i) => {
          const k = at(i);
          return (
            <figure key={i} className="tyre-card" style={{ ['--lapc' as string]: colors[i] }}>
              <figcaption><i className="swatch" />{name}{k == null && <span className="muted"> · {t('media de la vuelta')}</span>}</figcaption>
              <svg viewBox="0 0 220 232" role="group" aria-label={t('Neumáticos de {name}', { name })}>
                {WHEELS.map((p, w) => {
                  const c = k == null ? mean(temp[i]![w]!) : temp[i]![w]![k]!;
                  const bar = k == null ? mean(pres[i]![w]!) : pres[i]![w]![k]!;
                  return (
                    <g key={w} className={`tyre-wheel ${sel === w ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={sel === w} aria-label={`${wheelNames[w]}: ${Math.round(tempValue(c))} ${tempUnit()}, ${pressureValue(bar).toFixed(2)} ${pressureUnit()}`}
                      onClick={() => setSel(sel === w ? null : w)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(sel === w ? null : w); } }}>
                      <rect x={p.x} y={p.y} width={W_W} height={W_H} rx={8} style={{ fill: tempColor(c) }} className="tyre-rubber" />
                      <text x={p.x + W_W / 2} y={p.y + 36} textAnchor="middle" className="tyre-temp">{Math.round(tempValue(c))}{tempUnit()}</text>
                      <text x={p.x + W_W / 2} y={p.y + 56} textAnchor="middle" className="tyre-pres">{pressureValue(bar).toFixed(2)}</text>
                      <text x={p.x + W_W / 2} y={p.y + 70} textAnchor="middle" className="tyre-pres-unit">{pressureUnit()}</text>
                    </g>
                  );
                })}
              </svg>
            </figure>
          );
        })}
      </div>
      <p className="note">{t('Pulsa una rueda para ver su gráfica.')}</p>
      {sel != null && (
        <div className="tyres-charts">
          <CompareChart title={`${t('Temperatura')} · ${wheelNames[sel]}`} subtitle={tempUnit()} series={series(temp, sel, tempValue)} {...chart}
            height={130} format={(v) => `${Math.round(v)} ${tempUnit()}`} tickFormat={(v) => String(Math.round(v))} />
          <CompareChart title={`${t('Presión')} · ${wheelNames[sel]}`} subtitle={pressureUnit()} series={series(pres, sel, pressureValue)} {...chart}
            height={130} format={(v) => `${v.toFixed(2)} ${pressureUnit()}`} tickFormat={(v) => v.toFixed(2)} />
          <button type="button" className="btn small" onClick={() => setSel(null)}>{t('Cerrar')}</button>
        </div>
      )}
    </div>
  );
}
