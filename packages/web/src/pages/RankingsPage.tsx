import { useState } from 'react';
import type { RankingEntryDto, RankingsDto } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { useContentNames } from '../content';
import { DriverLink } from '../components/links';
import { Avatar } from '../components/profile-parts';
import { fmtDuration, num } from '../format';
import { speedText } from '../prefs';

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

/** Todos los tops. Para añadir uno: su consulta en `Profiles.rankings`, el campo en `RankingsDto` y una entrada aquí. */
const BOARDS: { id: keyof RankingsDto; title: string; hint: string; group: 'rec' | 'act' | 'style'; show: (v: number) => string }[] = [
  { id: 'records', title: 'Más récords', hint: 'Tiempos vigentes', group: 'rec', show: (v) => num(v) },
  { id: 'podiums', title: 'Más podios', hint: 'Entre los 3 mejores de circuito y coche', group: 'rec', show: (v) => num(v) },
  { id: 'topSpeed', title: 'Más rápidos en recta', hint: 'Velocidad máxima alcanzada', group: 'rec', show: (v) => speedText(v) },
  { id: 'laps', title: 'Más vueltas', hint: 'Todas las vueltas dadas', group: 'act', show: (v) => num(v) },
  { id: 'validLaps', title: 'Más vueltas válidas', hint: 'Solo las que cuentan', group: 'act', show: (v) => num(v) },
  { id: 'timeMs', title: 'Más tiempo en pista', hint: 'Dando vueltas', group: 'act', show: (v) => fmtDuration(v) },
  { id: 'sessions', title: 'Más sesiones', hint: 'Sesiones distintas en las que ha dado vueltas', group: 'act', show: (v) => num(v) },
  { id: 'daysActive', title: 'Más días activo', hint: 'Días distintos con vueltas', group: 'act', show: (v) => num(v) },
  { id: 'cleanPct', title: 'Más limpios', hint: '% de vueltas válidas (mín. 20 vueltas)', group: 'style', show: (v) => `${v.toFixed(1)} %` },
  { id: 'tracks', title: 'Más circuitos', hint: 'Circuitos distintos probados', group: 'style', show: (v) => num(v) },
  { id: 'cars', title: 'Más coches', hint: 'Coches distintos probados', group: 'style', show: (v) => num(v) },
];
const GROUPS: { id: 'rec' | 'act' | 'style'; title: string }[] = [
  { id: 'rec', title: 'Los más rápidos' }, { id: 'act', title: 'Los más constantes' }, { id: 'style', title: 'Los más completos' },
];
const TOPS = [3, 5, 10, 30];

/** Clasificaciones de pilotos con filtros de circuito, periodo y tamaño del top (3, 5, 10 o 30). */
export function RankingsPage() {
  const { trackName } = useContentNames();
  const [trackKey, setTrackKey] = useState('');
  const [days, setDays] = useState('');
  const [top, setTop] = useState(10);
  const tracks = useLive(api.tracks, [], (e) => e.type === 'results').data;
  const [track, layout] = trackKey ? (trackKey.split('|') as [string, string]) : [undefined, undefined];
  const { data, error } = useLive(() => api.rankings({ track, layout, days: days ? Number(days) : undefined, top }), [trackKey, days, top], (e) => e.type === 'lap' || e.type === 'results');
  if (error && !data) return <p className="empty">{t('No se pudieron cargar los rankings.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Rankings')}</h2></div>
      <div className="sess-filters">
        <select value={trackKey} onChange={(e) => setTrackKey(e.target.value)} aria-label={t('Circuito')}>
          <option value="">{t('Todos los circuitos')}</option>
          {(tracks ?? []).map((tk) => <option key={`${tk.track}|${tk.layout}`} value={`${tk.track}|${tk.layout}`}>{trackName(tk.track, tk.layout)}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label={t('Periodo')}>
          <option value="">{t('Desde siempre')}</option><option value="7">{t('Últimos 7 días')}</option><option value="30">{t('Últimos 30 días')}</option><option value="365">{t('Último año')}</option>
        </select>
        <select value={top} onChange={(e) => setTop(Number(e.target.value))} aria-label={t('Tamaño del top')}>
          {TOPS.map((n) => <option key={n} value={n}>{t('Top {n}', { n })}</option>)}
        </select>
      </div>
      {GROUPS.map((g) => (
        <div key={g.id}>
          <h3 className="rank-group">{t(g.title)}</h3>
          <div className="grid-2">
            {BOARDS.filter((b) => b.group === g.id).map((b) => <Board key={b.id} title={t(b.title)} hint={t(b.hint)} rows={data[b.id]} show={b.show} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
