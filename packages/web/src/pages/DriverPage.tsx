import { speedText } from '../prefs';
import { formatLapTime, type DriverProfileDto } from '@howler/shared';
import { useState } from 'react';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { CarLink, TrackLink } from '../components/links';
import { ProgressChart } from '../components/ProgressChart';
import { ActivityChart, Avatar, Section, StatGrid, type Stat } from '../components/profile-parts';
import { useContentNames } from '../content';
import { ago, fmtDate, fmtDuration, num, pct, sessionTypeName } from '../format';

/** Evolución del mejor tiempo: elige combinación (por defecto la que más ha mejorado). */
function Progress({ data }: { data: DriverProfileDto }) {
  const { carName, trackName } = useContentNames();
  const [sel, setSel] = useState(0);
  const list = data.progress.filter((p) => p.points.length >= 1);
  if (list.length === 0) return <p className="empty">{t('Sin vueltas válidas todavía.')}</p>;
  const cur = list[Math.min(sel, list.length - 1)]!;
  return (
    <div className="progress-wrap">
      <select value={Math.min(sel, list.length - 1)} onChange={(e) => setSel(Number(e.target.value))} aria-label={t('Circuito y coche')}>
        {list.map((p, i) => <option key={i} value={i}>{trackName(p.track, p.layout)} · {carName(p.car)} ({t('{n} mejoras', { n: p.points.length - 1 })})</option>)}
      </select>
      <ProgressChart progress={cur} />
    </div>
  );
}

/** Selector para abrir el cara a cara con otro piloto. */
function VersusPicker({ id }: { id: number }) {
  const [drivers, setDrivers] = useState<{ id: number; name: string }[] | null>(null);
  const load = () => { if (!drivers) api.drivers().then(setDrivers).catch(() => setDrivers([])); };
  return (
    <select className="versus-pick" value="" onFocus={load} onMouseEnter={load} aria-label={t('Comparar con otro piloto')}
      onChange={(e) => { if (e.target.value) window.location.hash = `#/versus/${id}/${e.target.value}`; }}>
      <option value="">{t('Comparar con…')}</option>
      {(drivers ?? []).filter((d) => d.id !== id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  );
}

/** Ficha de un piloto: todo lo que Howler sabe de él, con enlaces a sus circuitos y coches. */
export function DriverPage({ id }: { id: number }) {
  const { carName, trackName } = useContentNames();
  const { data, error } = useLive(() => api.driver(id), [id], (e) => e.type === 'results' || (e.type === 'lap' && e.driverId === id));

  if (error && !data) return <p className="empty">{t('No encuentro a este piloto.')} <a href="#/drivers">{t('Ver todos los pilotos')}</a></p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  const tot = data.totals;

  const stats: Stat[] = [
    { label: t('Vueltas'), value: num(tot.laps), sub: t('{n} válidas ({pct})', { n: num(tot.validLaps), pct: pct(tot.validLaps, tot.laps) }) },
    ...(tot.pendingLaps > 0 ? [{ label: t('Pendientes de revisión'), value: num(tot.pendingLaps), sub: t('salidas de boxes sin aprobar') }] : []),
    { label: t('Tiempo dando vueltas'), value: fmtDuration(tot.timeMs) },
    ...(data.km != null ? [{ label: t('Kilómetros recorridos'), value: `${num(Math.round(data.km))} km`, sub: t('según la longitud del circuito') }] : []),
    { label: t('Sesiones'), value: num(tot.sessions) },
    { label: t('Circuitos'), value: num(tot.tracks) },
    { label: t('Coches'), value: num(tot.cars) },
    { label: t('Récords vigentes'), value: num(data.records), sub: t('{n} podios (top 3)', { n: num(data.podiums) }) },
    { label: t('Cortes de pista'), value: num(tot.cuts) },
    { label: t('Choques con coches'), value: num(data.carCollisions) },
    { label: t('Choques con el entorno'), value: num(data.envCollisions) },
    { label: t('Velocidad máxima'), value: tot.maxSpeedKmh != null ? speedText(tot.maxSpeedKmh) : '—' },
    {
      label: t('Circuito favorito'),
      value: data.favoriteTrack ? <TrackLink track={data.favoriteTrack.track} layout={data.favoriteTrack.layout} name={trackName(data.favoriteTrack.track, data.favoriteTrack.layout)} /> : '—',
      sub: data.favoriteTrack ? t('{n} vueltas', { n: num(data.favoriteTrack.laps) }) : undefined,
    },
    {
      label: t('Coche favorito'),
      value: data.favoriteCar ? <CarLink car={data.favoriteCar.car} name={carName(data.favoriteCar.car)} /> : '—',
      sub: data.favoriteCar ? t('{n} vueltas', { n: num(data.favoriteCar.laps) }) : undefined,
    },
  ];

  return (
    <>
      <header className="profile-head">
        <Avatar driverId={data.id} name={data.name} size={88} />
        <div className="profile-title">
          <span className="profile-kicker">{t('Piloto')}</span>
          <h2>{data.name}</h2>
          <p className="muted">{t('Desde el {date} · visto por última vez {ago}', { date: fmtDate(data.firstSeen), ago: ago(data.lastSeen) })}</p>
          <VersusPicker id={data.id} />
        </div>
      </header>

      <Section title={t('Resumen')}><StatGrid stats={stats} /></Section>

      <Section title={t('Mejores tiempos')} aside={<span className="muted">{t('Por circuito y coche')}</span>}>
        <div className="table-scroll">
          <table className="timing">
            <thead>
              <tr>
                <th>{t('Circuito')}</th><th>{t('Coche')}</th><th className="num">{t('Mejor vuelta')}</th><th className="num">{t('Puesto')}</th>
                <th className="num">{t('Dif. récord')}</th><th className="num" title={t('Media de sus vueltas válidas, sin contar las salidas de boxes')}>{t('Media')}</th>
                <th className="num" title={t('Desviación típica de sus vueltas válidas (sin salidas de boxes): cuanto menor, más regular')}>{t('Regularidad')}</th>
                <th className="num">{t('V. máx.')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Última vez')}</th>
              </tr>
            </thead>
            <tbody>
              {data.combos.map((c) => (
                <tr key={`${c.track}|${c.layout}|${c.car}`}>
                  <td className="driver"><TrackLink track={c.track} layout={c.layout} name={trackName(c.track, c.layout)} /></td>
                  <td><CarLink car={c.car} name={carName(c.car)} /></td>
                  <td className="num lap">{formatLapTime(c.bestMs)}</td>
                  <td className="num"><span className={`rank rank-${c.rank ?? 0}`}>{c.rank != null ? t('{n}º', { n: c.rank }) : '—'}<span className="of">/{c.drivers}</span></span></td>
                  <td className="num muted">{c.bestMs != null && c.recordMs != null && c.bestMs > c.recordMs ? `+${((c.bestMs - c.recordMs) / 1000).toFixed(3)}` : c.rank === 1 ? t('récord') : ''}</td>
                  <td className="num muted">{c.avgMs != null ? formatLapTime(Math.round(c.avgMs)) : '—'}</td>
                  <td className="num muted">{c.stdMs != null && c.validLaps > 1 ? `±${(c.stdMs / 1000).toFixed(2)} s` : '—'}</td>
                  <td className="num muted">{c.maxSpeedKmh != null ? speedText(c.maxSpeedKmh) : '—'}</td>
                  <td className="num muted">{c.validLaps}<span className="of">/{c.laps}</span></td>
                  <td className="num muted">{fmtDate(c.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('Evolución del mejor tiempo')} aside={<span className="muted">{t('Cada escalón es una mejora')}</span>}>
        <Progress data={data} />
      </Section>

      <Section title={t('Actividad')} aside={<span className="muted">{t('Vueltas por día, últimos 90 días')}</span>}>
        <ActivityChart days={data.activity} />
      </Section>

      <Section title={t('Sesiones recientes')}>
        <div className="table-scroll">
          <table className="timing">
            <thead>
              <tr><th>{t('Fecha')}</th><th>{t('Circuito')}</th><th>{t('Sesión')}</th><th>{t('Coches')}</th><th className="num">{t('Mejor vuelta')}</th><th className="num">{t('Puesto')}</th><th className="num">{t('Vueltas')}</th></tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="muted"><a href={`#/session/${s.id}`} title={t('Ver esta sesión')}>{fmtDate(s.startedAt)}</a></td>
                  <td className="driver"><TrackLink track={s.track} layout={s.layout} name={trackName(s.track, s.layout)} /></td>
                  <td className="muted">{sessionTypeName(s.type)}</td>
                  <td className="muted">{s.cars.map((c, i) => <span key={c}>{i > 0 && ', '}<CarLink car={c} name={carName(c)} /></span>)}</td>
                  <td className="num lap">{formatLapTime(s.bestMs)}</td>
                  <td className="num"><span className={`rank rank-${s.position ?? 0}`}>{s.position != null ? t('{n}º', { n: s.position }) : '—'}<span className="of">/{s.drivers}</span></span></td>
                  <td className="num muted">{s.validLaps}<span className="of">/{s.laps}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
