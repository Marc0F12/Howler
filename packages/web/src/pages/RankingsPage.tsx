import { useState } from 'react';
import type { RankingEntryDto } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { useContentNames } from '../content';
import { DriverLink } from '../components/links';
import { Avatar } from '../components/profile-parts';
import { fmtDuration, num } from '../format';

function Board({ title, hint, rows, show }: { title: string; hint: string; rows: RankingEntryDto[]; show: (v: number) => string }) {
  return (
    <section className="panel rank-board">
      <div className="panel-head"><h3>{title}</h3><span className="muted">{hint}</span></div>
      {rows.length === 0 ? <p className="empty">{t('Todavía no hay datos suficientes.')}</p> : (
        <ol className="rank-list">
          {rows.map((r, i) => (
            <li key={r.driverId}>
              <span className={`rank rank-${i + 1}`}>{t('{n}º', { n: i + 1 })}</span>
              <Avatar driverId={r.driverId} name={r.driverName} size={28} />
              <DriverLink id={r.driverId} name={r.driverName} />
              <span className="num lap">{show(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Clasificaciones de pilotos: quién da más vueltas, tiene más récords, pasa más tiempo en pista o conduce más limpio. */
export function RankingsPage() {
  const { trackName } = useContentNames();
  const [trackKey, setTrackKey] = useState('');
  const [days, setDays] = useState('');
  const tracks = useLive(api.tracks, [], (e) => e.type === 'results').data;
  const [track, layout] = trackKey ? (trackKey.split('|') as [string, string]) : [undefined, undefined];
  const { data, error } = useLive(() => api.rankings({ track, layout, days: days ? Number(days) : undefined }), [trackKey, days], (e) => e.type === 'lap' || e.type === 'results');
  if (error && !data) return <p className="empty">{t('No se pudieron cargar los rankings.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  return (
    <>
    <div className="sess-filters">
      <select value={trackKey} onChange={(e) => setTrackKey(e.target.value)} aria-label={t('Circuito')}>
        <option value="">{t('Todos los circuitos')}</option>
        {(tracks ?? []).map((tk) => <option key={`${tk.track}|${tk.layout}`} value={`${tk.track}|${tk.layout}`}>{trackName(tk.track, tk.layout)}</option>)}
      </select>
      <select value={days} onChange={(e) => setDays(e.target.value)} aria-label={t('Periodo')}>
        <option value="">{t('Desde siempre')}</option><option value="7">{t('Últimos 7 días')}</option><option value="30">{t('Últimos 30 días')}</option><option value="365">{t('Último año')}</option>
      </select>
    </div>
    <div className="grid-2">
      <Board title={t('Más récords')} hint={t('Tiempos vigentes')} rows={data.records} show={(v) => `${num(v)}`} />
      <Board title={t('Más vueltas')} hint={t('Todas las vueltas dadas')} rows={data.laps} show={(v) => num(v)} />
      <Board title={t('Más tiempo en pista')} hint={t('Dando vueltas')} rows={data.timeMs} show={(v) => fmtDuration(v)} />
      <Board title={t('Más limpios')} hint={t('% de vueltas válidas (mín. 20 vueltas)')} rows={data.cleanPct} show={(v) => `${v.toFixed(1)} %`} />
      <Board title={t('Más circuitos')} hint={t('Circuitos distintos probados')} rows={data.tracks} show={(v) => num(v)} />
    </div>
    </>
  );
}
