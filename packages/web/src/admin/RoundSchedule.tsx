import { CSP_WEATHER_TYPES, type ScheduleKind } from '@howler/shared';
import { WeatherIcon, weatherKind } from '../components/weather-icons';
import { t, tm } from '../i18n';
import { emptySession, type DraftSession } from './championship-form';

const KINDS = (): [ScheduleKind, string][] => [['practice', t('Práctica')], ['quali', t('Clasificación')], ['race', t('Carrera')], ['post', t('Post carrera')], ['custom', t('Otra')]];

/** Horarios de una carrera: cada cita lleva su tipo, hora (opcional), duración (opcional, texto libre) y una descripción (opcional). Se enseñan como línea de tiempo. */
export function RoundSchedule({ sessions, onChange }: { sessions: DraftSession[]; onChange: (s: DraftSession[]) => void }) {
  const patch = (i: number, p: Partial<DraftSession>) => onChange(sessions.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sessions.length) return;
    const next = [...sessions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="sched-edit">
      <p className="hint">{t('Horarios del fin de semana. Pon la hora, la duración o las dos; la descripción es opcional y sale bajo cada cita.')}</p>
      {sessions.map((s, i) => (
        <div className="sched-row" key={i}>
          <select aria-label={t('Tipo de sesión')} value={s.kind} onChange={(e) => patch(i, { kind: e.target.value as ScheduleKind })}>
            {KINDS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {s.kind === 'custom' && <input type="text" aria-label={t('Título')} placeholder={t('Título')} maxLength={60} value={s.title} onChange={(e) => patch(i, { title: e.target.value })} />}
          <input type="datetime-local" aria-label={t('Hora')} value={s.at} onChange={(e) => patch(i, { at: e.target.value })} />
          <input type="text" aria-label={t('Duración')} placeholder={t('Duración, p. ej. 20 minutos')} maxLength={40} value={s.duration} onChange={(e) => patch(i, { duration: e.target.value })} />
          <input type="text" className="grow" aria-label={t('Descripción')} placeholder={t('Descripción (opcional)')} maxLength={400} value={s.text} onChange={(e) => patch(i, { text: e.target.value })} />
          <span className="row">
            <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Subir')}>↑</button>
            <button type="button" className="btn small" disabled={i === sessions.length - 1} onClick={() => move(i, 1)} aria-label={t('Bajar')}>↓</button>
            <button type="button" className="btn small" onClick={() => onChange(sessions.filter((_, j) => j !== i))} aria-label={t('Quitar')}>✕</button>
          </span>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => onChange([...sessions, emptySession(sessions.some((s) => s.kind === 'race') ? 'post' : 'race')])}>{t('+ Añadir sesión')}</button>
    </div>
  );
}

/** Clima de la carrera: se enseña como icono en su tarjeta de la web. Sin elegir, sale sol con nubes. */
export function WeatherPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = [...new Set(CSP_WEATHER_TYPES.map((w) => w.group))];
  return (
    <label className="mini weather-pick">
      {t('Clima de la carrera')}
      <span className="row">
        <span className="weather-pick-icon"><WeatherIcon kind={weatherKind(value || 'FewClouds')} size={22} /></span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('Sin decir (sol con nubes)')}</option>
          {groups.map((g) => (
            <optgroup key={g} label={tm(g)}>
              {CSP_WEATHER_TYPES.filter((w) => w.group === g).map((w) => <option key={w.type} value={w.type}>{tm(w.name)}</option>)}
            </optgroup>
          ))}
        </select>
      </span>
    </label>
  );
}
