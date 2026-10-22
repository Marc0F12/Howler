import { t, tm } from '../i18n';
import { METRIC_LOWER_WINS, SCORING_PRESETS, type Bonus, type RoundMetric, type ScoringConfig, type Tiebreak } from '@howler/shared';
import { parsePoints, pointsPreview } from './championship-form';

const METRICS: [RoundMetric, string][] = [
  ['finish', t('Posición de llegada')], ['bestLap', t('Mejor vuelta')], ['avgLap', t('Media de vuelta')], ['consistency', t('Regularidad')], ['laps', t('Número de vueltas')], ['topSpeed', t('Velocidad máxima')],
];
const BONUS_KINDS: [Bonus['kind'], string][] = [['pole', t('Pole (mejor de la clasificación)')], ['bestLap', t('Vuelta rápida de la carrera')], ['topSpeed', t('Mayor velocidad')], ['mostLaps', t('Más vueltas')], ['participation', t('Por participar')]];
const TIEBREAKS: [Tiebreak, string][] = [['wins', t('Más victorias')], ['bestFinish', t('Mejor posición')], ['bestRound', t('Mejor carrera')]];

/** Paso 4: cómo se puntúa. Todo editable; las plantillas solo rellenan los campos. */
export function ScoringEditor({ scoring, onChange, teamed }: { scoring: ScoringConfig; onChange: (s: ScoringConfig) => void; teamed: boolean }) {
  const s = scoring;
  const patch = (p: Partial<ScoringConfig>) => onChange({ ...s, ...p });
  const metricLabel = (m: RoundMetric) => `${METRICS.find(([k]) => k === m)![1]} (${METRIC_LOWER_WINS[m] ? t('gana el más bajo') : t('gana el más alto')})`;
  return (
    <div className="scoring">
      <label className="mini">{t('Plantilla')}
        <select aria-label={t('Plantilla de puntuación')} value="" onChange={(e) => e.target.value && onChange(structuredClone(SCORING_PRESETS[e.target.value]!.config))}>
          <option value="">{t('Elegir una plantilla…')}</option>
          {Object.entries(SCORING_PRESETS).map(([k, p]) => <option key={k} value={k}>{tm(p.label)}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>{t('Qué decide la clasificación')}</legend>
        <label><input type="radio" name="mode" checked={s.mode === 'points'} onChange={() => patch({ mode: 'points' })} /> {t('Puntos por puesto en cada carrera')}</label>
        <label><input type="radio" name="mode" checked={s.mode === 'aggregate'} onChange={() => patch({ mode: 'aggregate' })} /> {t('Sin puntos: acumular una medida entre carreras')}</label>
      </fieldset>

      {s.mode === 'points' ? (
        <>
          <label className="mini">{t('Cómo se ordena cada carrera')}
            <select value={s.metric} onChange={(e) => patch({ metric: e.target.value as RoundMetric })}>{METRICS.map(([k]) => <option key={k} value={k}>{metricLabel(k)}</option>)}</select>
          </label>
          <label className="mini">{t('Puntos por puesto (1.º, 2.º, 3.º… separados por comas)')}
            <input type="text" className="wide" aria-label={t('Tabla de puntos')} defaultValue={s.pointsTable.join(', ')} key={s.pointsTable.join(',')} onBlur={(e) => patch({ pointsTable: parsePoints(e.target.value) })} />
          </label>
          <p className="hint">{t('Vista previa:')} {pointsPreview(s.pointsTable) || t('sin puntos')}</p>
          <div className="row">
            <label className="mini">{t('Puntos fuera de la tabla')}<input type="number" value={s.defaultPoints} onChange={(e) => patch({ defaultPoints: Number(e.target.value) || 0 })} /></label>
            <label className="mini">{t('Descartar las N peores carreras')}<input type="number" min={0} value={s.dropWorst} onChange={(e) => patch({ dropWorst: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          </div>
        </>
      ) : (
        <div className="row">
          <label className="mini">{t('Medida')}
            <select value={s.aggregate.metric} onChange={(e) => patch({ metric: e.target.value as RoundMetric, aggregate: { ...s.aggregate, metric: e.target.value as RoundMetric } })}>{METRICS.filter(([k]) => k !== 'finish').map(([k]) => <option key={k} value={k}>{metricLabel(k)}</option>)}</select>
          </label>
          <label className="mini">{t('Cómo se junta entre carreras')}
            <select value={s.aggregate.how} onChange={(e) => patch({ aggregate: { ...s.aggregate, how: e.target.value as 'sum' | 'best' | 'mean' } })}>
              <option value="sum">{t('Suma de todas')}</option><option value="best">{t('La mejor de todas')}</option><option value="mean">{t('Media de todas')}</option>
            </select>
          </label>
        </div>
      )}
      <label className="mini">{t('Vueltas mínimas para clasificar en una carrera')}<input type="number" min={0} value={s.minLaps} onChange={(e) => patch({ minLaps: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>

      {s.mode === 'points' && (
        <fieldset>
          <legend>{t('Puntos extra')}</legend>
          {s.bonuses.map((b, i) => (
            <div className="row" key={i}>
              <select aria-label={t('Tipo de extra')} value={b.kind} onChange={(e) => patch({ bonuses: s.bonuses.map((x, j) => (j === i ? { ...x, kind: e.target.value as Bonus['kind'] } : x)) })}>{BONUS_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="mini inline">{t('Puntos')}<input type="number" value={b.points} onChange={(e) => patch({ bonuses: s.bonuses.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) || 0 } : x)) })} /></label>
              <label className="mini inline">{t('Solo si acaba en el top')}<input type="number" min={0} placeholder="—" value={b.maxFinish ?? ''} onChange={(e) => patch({ bonuses: s.bonuses.map((x, j) => (j === i ? { ...x, maxFinish: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined } : x)) })} /></label>
              <button type="button" className="btn small" onClick={() => patch({ bonuses: s.bonuses.filter((_, j) => j !== i) })}>{t('Quitar')}</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => patch({ bonuses: [...s.bonuses, { kind: 'pole', points: 1 }] })}>{t('+ Añadir extra')}</button>
          <label className="mini">{t('Puntos por puesto en la clasificación (opcional, 1.º, 2.º… separados por comas)')}
            <input type="text" className="wide" aria-label={t('Puntos de clasificación')} defaultValue={(s.qualiTable ?? []).join(', ')} key={`q${(s.qualiTable ?? []).join(',')}`} onBlur={(e) => patch({ qualiTable: parsePoints(e.target.value) })} />
          </label>
          <p className="hint">{t('La pole necesita que la clasificación se juegue como sesión aparte y esté asignada a la carrera. Las penalizaciones o extras puntuales se anotan a mano después, en la gestión del campeonato.')}</p>
        </fieldset>
      )}

      {teamed && (
        <div className="row">
          <label className="mini">{t('Cómo puntúa un equipo')}
            <select value={s.team.rule} onChange={(e) => patch({ team: { ...s.team, rule: e.target.value as ScoringConfig['team']['rule'] } })}>
              <option value="sumAll">{t('Suman todos sus pilotos')}</option><option value="bestN">{t('Cuentan solo los N mejores')}</option><option value="mean">{t('Media de sus pilotos')}</option>
            </select>
          </label>
          {s.team.rule === 'bestN' && <label className="mini">N<input type="number" min={1} value={s.team.n} onChange={(e) => patch({ team: { ...s.team, n: Math.max(1, Math.floor(Number(e.target.value) || 1)) } })} /></label>}
        </div>
      )}

      <fieldset>
        <legend>{t('Desempates (en este orden)')}</legend>
        {TIEBREAKS.map(([k, l]) => (
          <label key={k}><input type="checkbox" checked={s.tiebreaks.includes(k)} onChange={(e) => patch({ tiebreaks: e.target.checked ? [...s.tiebreaks, k] : s.tiebreaks.filter((x) => x !== k) })} /> {l}</label>
        ))}
      </fieldset>
    </div>
  );
}
