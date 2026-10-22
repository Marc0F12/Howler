import { useState } from 'react';
import { formatDelta, formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentNames } from '../content';
import { clock } from '../format';
import { t } from '../i18n';
import { CarLink, DriverLink } from './links';

const RECENT = 8;

/**
 * «Rey de la colina»: cómo ha ido bajando el mejor tiempo de la sesión. Cada paso es una vuelta válida que superó
 * al anterior rey. En orden de lectura (el primero arriba, el rey actual abajo); si hay muchos pasos se enseñan
 * los últimos y el resto se despliega.
 */
export function KingOfTheHill({ sessionId }: { sessionId: number }) {
  const { carName } = useContentNames();
  const [all, setAll] = useState(false);
  const { data, error } = useLive(
    () => api.progression(sessionId),
    [sessionId],
    (e) => e.type === 'results' || (e.type === 'lap' && e.sessionId === sessionId && e.valid),
  );

  if (error && !data) return <p className="empty">{t('No se pudo cargar la progresión.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  if (data.length === 0) return <p className="empty">{t('Todavía no hay ningún tiempo válido. El primero que lo haga abrirá la colina.')}</p>;

  const shown = all ? data : data.slice(-RECENT);
  const hidden = data.length - shown.length;
  const first = data[0]!, king = data.at(-1)!;

  return (
    <div className="koth">
      <p className="koth-summary">
        {data.length === 1
          ? <>{t('Primer tiempo:')} <strong>{formatLapTime(first.lapMs)}</strong> {t('de {name}.', { name: first.driverName })}</>
          : <>{t('El mejor tiempo ha bajado de')} <strong>{formatLapTime(first.lapMs)}</strong> {t('a')} <strong>{formatLapTime(king.lapMs)}</strong> ({formatDelta(king.lapMs - first.lapMs)}) {t('en {n} pasos.', { n: data.length })}</>}
      </p>
      {hidden > 0 && (
        <button type="button" className="btn-link koth-more" onClick={() => setAll(true)}>{t('Ver los {n} pasos anteriores', { n: hidden })}</button>
      )}
      <ol className="koth-list">
        {shown.map((s) => {
          const isKing = s.lapId === king.lapId;
          return (
            <li key={s.lapId} className={`koth-step ${isKing ? 'king' : ''}`}>
              <span className="koth-dot" aria-hidden="true" />
              <span className="koth-time num">{formatLapTime(s.lapMs)}</span>
              <span className="koth-who">
                <span className="koth-name"><DriverLink id={s.driverId} name={s.driverName} />{isKing && <span className="koth-badge">{t('Rey actual')}</span>}</span>
                <span className="koth-detail">
                  {s.previousMs == null
                    ? t('Primer tiempo de la sesión')
                    : <>{t('Superó a {name}', { name: s.previousDriverName === s.driverName ? t('su propio tiempo') : (s.previousDriverName ?? '') })} ({formatLapTime(s.previousMs)})</>}
                  {' · '}<CarLink car={s.car} name={carName(s.car)} />
                </span>
              </span>
              <span className="koth-delta num">{s.previousMs != null ? formatDelta(s.lapMs - s.previousMs) : ''}</span>
              <span className="koth-at num">{clock(s.at)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
