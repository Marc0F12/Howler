import { formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { CarLink, DriverLink, TrackLink } from '../components/links';
import { Avatar, Section, StatGrid } from '../components/profile-parts';
import { versus } from '../components/versus-math';
import { useContentNames } from '../content';
import { num } from '../format';

/** Cara a cara entre dos pilotos: en cada circuito y coche que han corrido los dos, quién tiene la mejor vuelta y por cuánto. */
export function VersusPage({ a, b }: { a: number; b: number }) {
  const { carName, trackName } = useContentNames();
  const { data, error } = useLive(() => Promise.all([api.driver(a), api.driver(b)]), [a, b], (e) => e.type === 'results' || e.type === 'lap');
  if (error && !data) return <p className="empty">{t('No encuentro a alguno de los pilotos.')} <a href="#/drivers">{t('Ver pilotos')}</a></p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  const [da, db] = data;
  const v = versus(da.combos, db.combos);

  return (
    <>
      <header className="profile-head">
        <Avatar driverId={da.id} name={da.name} size={64} />
        <div className="profile-title">
          <span className="profile-kicker">{t('Cara a cara')}</span>
          <h2><DriverLink id={da.id} name={da.name} /> vs <DriverLink id={db.id} name={db.name} /></h2>
          <p className="muted">{v.rows.length === 0 ? t('No han corrido ninguna combinación en común.') : t('{n} combinaciones de circuito y coche en común', { n: num(v.rows.length) })}</p>
        </div>
        <Avatar driverId={db.id} name={db.name} size={64} />
      </header>
      <Section title={t('Marcador')}>
        <StatGrid stats={[
          { label: da.name, value: num(v.winsA), sub: t('mejores vueltas ganadas') },
          { label: db.name, value: num(v.winsB), sub: t('mejores vueltas ganadas') },
          { label: t('Empates'), value: num(v.ties) },
        ]} />
      </Section>
      {v.rows.length > 0 && (
        <Section title={t('Combinación a combinación')} aside={<span className="muted">{t('Mejor vuelta válida de cada uno')}</span>}>
          <div className="table-scroll">
            <table className="timing">
              <thead><tr><th>{t('Circuito')}</th><th>{t('Coche')}</th><th className="num">{da.name}</th><th className="num">{db.name}</th><th className="num">{t('Diferencia')}</th></tr></thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={`${r.track}|${r.layout}|${r.car}`}>
                    <td className="driver"><TrackLink track={r.track} layout={r.layout} name={trackName(r.track, r.layout)} /></td>
                    <td><CarLink car={r.car} name={carName(r.car)} /></td>
                    <td className={`num lap${r.winner === 'a' ? ' best' : ''}`}>{formatLapTime(r.a.bestMs)}</td>
                    <td className={`num lap${r.winner === 'b' ? ' best' : ''}`}>{formatLapTime(r.b.bestMs)}</td>
                    <td className="num muted">{r.deltaMs == null ? '—' : r.deltaMs === 0 ? t('igual') : `${r.deltaMs > 0 ? da.name : db.name} +${(Math.abs(r.deltaMs) / 1000).toFixed(3)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
