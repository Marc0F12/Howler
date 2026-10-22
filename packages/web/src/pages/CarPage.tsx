import { speedText } from '../prefs';
import { formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { Preview } from '../components/Carousel3D';
import { DriverLink, TrackLink } from '../components/links';
import { ActivityChart, Avatar, Section, StatGrid, type Stat } from '../components/profile-parts';
import { carImage, useContentNames } from '../content';
import { ago, fmtDate, fmtDuration, num, pct } from '../format';

/** Ficha de un coche: su mejor tiempo en cada circuito donde se ha corrido y quién más lo usa. */
export function CarPage({ car }: { car: string }) {
  const { carName, trackName } = useContentNames();
  const { data, error } = useLive(() => api.carProfile(car), [car], (e) => e.type === 'results' || (e.type === 'lap' && e.car === car));

  if (error && !data) return <p className="empty">{t('No hay vueltas con este coche todavía.')} <a href="#/cars">{t('Ver todos los coches')}</a></p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  const tot = data.totals;
  const name = carName(car);

  const stats: Stat[] = [
    { label: t('Vueltas'), value: num(tot.laps), sub: t('{n} válidas ({pct})', { n: num(tot.validLaps), pct: pct(tot.validLaps, tot.laps) }) },
    { label: t('Pilotos'), value: num(tot.drivers) },
    { label: t('Circuitos'), value: num(tot.tracks) },
    { label: t('Tiempo dando vueltas'), value: fmtDuration(tot.timeMs) },
    { label: t('Sesiones'), value: num(tot.sessions) },
    { label: t('Velocidad máxima'), value: tot.maxSpeedKmh != null ? speedText(tot.maxSpeedKmh) : '—' },
    { label: t('Cortes de pista'), value: num(tot.cuts) },
    { label: t('Última actividad'), value: tot.lastAt ? ago(tot.lastAt) : '—' },
  ];

  return (
    <>
      <header className="profile-head">
        <Preview className="profile-img" image={carImage(car)} title={name} />
        <div className="profile-title">
          <span className="profile-kicker">{t('Coche')}</span>
          <h2>{name}</h2>
          <p className="muted">{tot.tracks === 1 ? t('1 circuito') : t('{n} circuitos', { n: tot.tracks })} · {tot.drivers === 1 ? t('1 piloto') : t('{n} pilotos', { n: tot.drivers })}</p>
        </div>
      </header>

      <Section title={t('Resumen')}><StatGrid stats={stats} /></Section>

      <Section title={t('Mejores tiempos en cada circuito')}>
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Circuito')}</th><th className="num">{t('Mejor tiempo')}</th><th>{t('Piloto')}</th><th className="num">{t('Pilotos')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Fecha')}</th></tr></thead>
            <tbody>
              {data.tracks.map((r) => (
                <tr key={`${r.track}|${r.layout}`}>
                  <td className="driver"><TrackLink track={r.track} layout={r.layout} name={trackName(r.track, r.layout)} /></td>
                  <td className="num lap">{formatLapTime(r.bestMs)}</td>
                  <td>{r.driverId != null && r.driverName ? <DriverLink id={r.driverId} name={r.driverName} /> : <span className="muted">{t('Sin vueltas válidas')}</span>}</td>
                  <td className="num muted">{r.drivers}</td>
                  <td className="num muted">{r.laps}</td>
                  <td className="num muted">{fmtDate(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="home-grid">
        <Section title={t('Quién más lo usa')}>
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
