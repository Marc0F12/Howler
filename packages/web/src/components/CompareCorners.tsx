import { useState } from 'react';
import { formatDelta } from '@howler/shared';
import { t } from '../i18n';
import { shortDistText, speedValue } from '../prefs';
import type { CornerStat } from './compare-corners';

/**
 * Tabla curva a curva: velocidades de cada vuelta (en su color) y lo que pierde o gana cada una frente a la más rápida.
 * Por defecto ordenada por la curva donde más tiempo se pierde; pasar el ratón por una fila marca la curva en el mapa y en las gráficas.
 */
export function CompareCorners({ stats, names, colors, refLap, hot, onHot, hasBrake }: {
  stats: CornerStat[]; names: string[]; colors: string[]; refLap: number; hot: number | null; onHot: (n: number | null) => void; hasBrake: boolean;
}) {
  const [byLoss, setByLoss] = useState(true);
  const others = names.map((_, i) => i).filter((i) => i !== refLap);
  const worst = (s: CornerStat) => Math.max(...others.map((i) => s.loseMs[i]!));
  const rows = [...stats].sort((a, b) => (byLoss ? worst(b) - worst(a) : a.corner.n - b.corner.n));
  const cells = (v: number[]) => v.map((x, i) => <span key={i} className="num" style={{ color: colors[i] }}>{Math.round(speedValue(x))}</span>);

  return (
    <div className="table-scroll">
      <table className="timing corners">
        <thead>
          <tr>
            <th><button type="button" className="th-sort" onClick={() => setByLoss(false)} aria-pressed={!byLoss}>{t('Curva')}</button></th>
            <th className="num">{t('Entrada')}</th>
            <th className="num">{t('Mínima')}</th>
            <th className="num">{t('Salida')}</th>
            {hasBrake && <th className="num" title={t('Metros en que frena después (+) o antes (−) que la más rápida')}>{t('Frenada')}</th>}
            <th className="num"><button type="button" className="th-sort" onClick={() => setByLoss(true)} aria-pressed={byLoss}>{t('Tiempo')}{byLoss ? ' ↓' : ''}</button></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.corner.n} className={hot === s.corner.n ? 'hot' : undefined} onPointerEnter={() => onHot(s.corner.n)} onPointerLeave={() => onHot(null)}>
              <td><strong>{s.corner.n}</strong></td>
              <td className="num"><span className="cell-laps">{cells(s.entry)}</span></td>
              <td className="num"><span className="cell-laps">{cells(s.min)}</span></td>
              <td className="num"><span className="cell-laps">{cells(s.exit)}</span></td>
              {hasBrake && <td className="num"><span className="cell-laps">{others.map((i) => <span key={i} style={{ color: colors[i] }}>{s.brakeM[i] == null ? '—' : `${s.brakeM[i]! > 0 ? '+' : s.brakeM[i]! < 0 ? '−' : ''}${shortDistText(Math.abs(s.brakeM[i]!))}`}</span>)}</span></td>}
              <td className="num"><span className="cell-laps">{others.map((i) => <span key={i} style={{ color: colors[i] }}>{formatDelta(s.loseMs[i]!)}</span>)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">{t('Aproximado: unas 10 muestras por segundo.')}</p>
    </div>
  );
}
