import { speedText } from '../prefs';
import { useState } from 'react';
import { formatDelta, formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { Preview } from '../components/Carousel3D';
import { CompareBar, PickBox, useComparePicks } from '../components/compare-select';
import { CarLink, DriverLink } from '../components/links';
import { ActivityChart, Avatar, Section, StatGrid, type Stat } from '../components/profile-parts';
import { trackImage, useContentNames } from '../content';
import { ago, fmtDate, fmtDuration, num, pct } from '../format';

const TOP_OPTIONS = [5, 10, 25, 50] as const;

/** Ficha de un circuito: los mejores tiempos (5, 10, 25 o 50), el récord de cada coche y quién más corre allí. */
export function TrackPage({ track, layout }: { track: string; layout: string }) {
  const { carName, trackName } = useContentNames();
  const [limit, setLimit] = useState<(typeof TOP_OPTIONS)[number]>(10);
  const picks = useComparePicks(track, layout);
  const { data, error } = useLive(
    () => api.trackProfile(track, layout), [track, layout],
    (e) => e.type === 'results' || (e.type === 'lap' && e.track === track && e.layout === layout),
  );

  if (error && !data) return <p className="empty">{t('No hay vueltas en este circuito todavía.')} <a href="#/tracks">{t('Ver todos los circuitos')}</a></p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  const tot = data.totals;
  const name = trackName(track, layout);

  const stats: Stat[] = [
    { label: t('Vueltas'), value: num(tot.laps), sub: t('{n} válidas ({pct})', { n: num(tot.validLaps), pct: pct(tot.validLaps, tot.laps) }) },
    { label: t('Pilotos'), value: num(tot.drivers) },
    { label: t('Coches distintos'), value: num(tot.cars) },
    { label: t('Tiempo dando vueltas'), value: fmtDuration(tot.timeMs) },
    { label: t('Sesiones'), value: num(tot.sessions) },
    { label: t('Velocidad máxima'), value: tot.maxSpeedKmh != null ? speedText(tot.maxSpeedKmh) : '—' },
    { label: t('Cortes de pista'), value: num(tot.cuts) },
    { label: t('Última actividad'), value: tot.lastAt ? ago(tot.lastAt) : '—' },
  ];

  return (
    <>
      <header className="profile-head">
        <Preview className="profile-img" image={trackImage(track, layout)} title={name} />
        <div className="profile-title">
          <span className="profile-kicker">{t('Circuito')}</span>
          <h2>{name}</h2>
          {data.record && (
            <p className="muted">
              {t('Récord:')} <strong className="mono">{formatLapTime(data.record.lapMs)}</strong> {t('de')} <DriverLink id={data.record.driverId} name={data.record.driverName} /> {t('con')}{' '}
              <CarLink car={data.record.car} name={carName(data.record.car)} />
            </p>
          )}
        </div>
      </header>

      <Section title={t('Resumen')}><StatGrid stats={stats} /></Section>

      <Section
        title={t('Mejores tiempos')}
        aside={
          <span className="segmented" role="group" aria-label={t('Cuántos tiempos mostrar')}>
            {TOP_OPTIONS.map((n) => <button key={n} type="button" className={limit === n ? 'on' : ''} aria-pressed={limit === n} onClick={() => setLimit(n)}>{t('Top {n}', { n })}</button>)}
          </span>
        }
      >
        <CompareBar picks={picks} />
        <div className="table-scroll">
          <table className="timing">
            <thead>
              <tr><th className="pick-col" aria-label={t('Comparar')} title={t('Elige 2 o 3 para comparar sus mejores vueltas')} /><th className="pos">#</th><th>{t('Piloto')}</th><th>{t('Coche')}</th><th className="num">{t('Tiempo')}</th><th className="num">{t('Dif.')}</th><th className="num">{t('V. máx.')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Fecha')}</th></tr>
            </thead>
            <tbody>
              {data.top.slice(0, limit).map((r) => (
                <tr key={r.driverId}>
                  <td className="pick-col"><PickBox picks={picks} driverId={r.driverId} car={r.car} name={r.driverName} /></td>
                  <td className="pos"><span className={`rank rank-${r.position}`}>{r.position}</span></td>
                  <td className="driver"><span className="who"><Avatar driverId={r.driverId} name={r.driverName} size={24} /><DriverLink id={r.driverId} name={r.driverName} /></span></td>
                  <td><CarLink car={r.car} name={carName(r.car)} /></td>
                  <td className="num lap">{formatLapTime(r.lapMs)}</td>
                  <td className="num muted">{r.position === 1 ? '' : formatDelta(r.gapMs)}</td>
                  <td className="num muted">{r.maxSpeedKmh != null ? speedText(r.maxSpeedKmh) : '—'}</td>
                  <td className="num muted">{r.laps}</td>
                  <td className="num muted">{fmtDate(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.top.length < limit && <p className="note">{data.top.length === 1 ? t('Solo hay 1 piloto con tiempo válido en este circuito.') : t('Solo hay {n} pilotos con tiempo válido en este circuito.', { n: data.top.length })}</p>}
      </Section>

      <Section title={t('Récord por coche')}>
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Coche')}</th><th className="num">{t('Mejor tiempo')}</th><th>{t('Piloto')}</th><th className="num">{t('Pilotos')}</th><th className="num">{t('Vueltas')}</th></tr></thead>
            <tbody>
              {data.cars.map((c) => (
                <tr key={c.car}>
                  <td className="driver"><CarLink car={c.car} name={carName(c.car)} /></td>
                  <td className="num lap">{formatLapTime(c.bestMs)}</td>
                  <td>{c.driverId != null && c.driverName ? <DriverLink id={c.driverId} name={c.driverName} /> : <span className="muted">{t('Sin vueltas válidas')}</span>}</td>
                  <td className="num muted">{c.drivers}</td>
                  <td className="num muted">{c.laps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="home-grid">
        <Section title={t('Quién más corre aquí')}>
          <ol className="busy-list">
            {data.busiest.map((b, i) => (
              <li key={b.driverId}><span className="pos">{i + 1}</span><Avatar driverId={b.driverId} name={b.driverName} size={28} /><DriverLink id={b.driverId} name={b.driverName} /><span className="num muted">{t('{n} vueltas', { n: num(b.laps) })}</span></li>
            ))}
          </ol>
        </Section>
        <Section title={t('Actividad')} aside={<span className="muted">{t('Últimos 90 días')}</span>}><ActivityChart days={data.activity} /></Section>
      </div>
    </>
  );
}
