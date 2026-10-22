import { Empty } from './Empty';
import { formatDelta, formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentNames } from '../content';
import { ago } from '../format';
import { t } from '../i18n';

/** Últimos récords: el récord vigente de cada combinación de circuito y coche, el más reciente primero. */
export function LatestRecords({ limit = 6 }: { limit?: number }) {
  const { carName, trackName } = useContentNames();
  const { data } = useLive(() => api.latestRecords(limit), [limit], (e) => e.type === 'lap' || e.type === 'results');
  if (!data) return null;
  if (data.length === 0) {
    return <Empty next={t('El primer récord saldrá aquí.')}>{t('Todavía no hay ninguna vuelta válida.')}</Empty>;
  }
  return (
    <ul className="record-wall">
      {data.map((r) => (
        <li key={r.lapId} className="record-card">
          <span className="record-time num">{formatLapTime(r.lapMs)}</span>
          {r.previousMs != null && <span className="record-delta num">{formatDelta(r.lapMs - r.previousMs)}</span>}
          <span className="record-who">{r.driverName}</span>
          <span className="record-where">{trackName(r.track, r.layout)} · {carName(r.car)}</span>
          <span className="record-prev">
            {r.previousMs == null
              ? t('Primer tiempo de la combinación')
              : r.previousDriverName === r.driverName
                ? t('Mejoró su propio récord ({time})', { time: formatLapTime(r.previousMs) })
                : t('Batió a {name} ({time})', { name: r.previousDriverName || t('el récord anterior'), time: formatLapTime(r.previousMs) })} · {ago(r.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}
