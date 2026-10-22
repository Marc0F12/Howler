import { useMemo, useState } from 'react';
import { formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { Preview } from '../components/Carousel3D';
import { CarLink, DriverLink, TrackLink } from '../components/links';
import { Avatar } from '../components/profile-parts';
import { carImage, trackImage, useContentNames } from '../content';
import { ago, num, pct } from '../format';

const onLap = (e: { type: string }) => e.type === 'lap' || e.type === 'results';

/** Caja de búsqueda sencilla: filtra por lo escrito sin distinguir mayúsculas ni tildes. */
function Search({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="search" className="dir-search" placeholder={label} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />;
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cara a cara: se eligen dos pilotos y se abre su comparación. */
function VersusLauncher({ drivers }: { drivers: { id: number; name: string }[] }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const ok = a !== '' && b !== '' && a !== b;
  return (
    <div className="versus-launch">
      <span className="muted">{t('Cara a cara')}</span>
      <select value={a} onChange={(e) => setA(e.target.value)} aria-label={t('Primer piloto')}>
        <option value="">{t('Piloto…')}</option>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <span className="muted">{t('contra')}</span>
      <select value={b} onChange={(e) => setB(e.target.value)} aria-label={t('Segundo piloto')}>
        <option value="">{t('Piloto…')}</option>
        {drivers.filter((d) => String(d.id) !== a).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {ok ? <a className="btn primary" href={`#/versus/${a}/${b}`}>{t('Comparar')}</a> : <button type="button" className="btn primary" disabled>{t('Comparar')}</button>}
    </div>
  );
}

/** Todos los pilotos que han dado alguna vuelta; pulsar uno abre su ficha. */
export function DriversPage() {
  const { data, error } = useLive(api.drivers, [], onLap);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data ?? []).filter((d) => norm(d.name).includes(norm(q))), [data, q]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Pilotos')}</h2><Search value={q} onChange={setQ} label={t('Buscar piloto')} /></div>
      {(data?.length ?? 0) > 1 && <VersusLauncher drivers={data!} />}
      {error && !data ? <p className="empty">{t('No se pudieron cargar los pilotos.')}</p> : !data ? <p className="empty">{t('Cargando…')}</p> : rows.length === 0 ? (
        <p className="empty">{data.length ? t('Ningún piloto coincide con la búsqueda.') : t('Todavía no hay pilotos con vueltas.')}</p>
      ) : (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Piloto')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Válidas')}</th><th className="num">{t('Circuitos')}</th><th className="num">{t('Coches')}</th><th className="num">{t('Última vez')}</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="driver"><span className="who"><Avatar driverId={d.id} name={d.name} size={28} /><DriverLink id={d.id} name={d.name} /></span></td>
                  <td className="num">{num(d.laps)}</td>
                  <td className="num muted">{pct(d.validLaps, d.laps)}</td>
                  <td className="num muted">{d.tracks}</td>
                  <td className="num muted">{d.cars}</td>
                  <td className="num muted">{ago(d.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Todos los circuitos en los que se ha corrido, con su récord; pulsar uno abre su ficha. */
export function TracksPage() {
  const { carName, trackName } = useContentNames();
  const { data, error } = useLive(api.tracks, [], onLap);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data ?? []).filter((tk) => norm(trackName(tk.track, tk.layout)).includes(norm(q))), [data, q, trackName]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Circuitos')}</h2><Search value={q} onChange={setQ} label={t('Buscar circuito')} /></div>
      {error && !data ? <p className="empty">{t('No se pudieron cargar los circuitos.')}</p> : !data ? <p className="empty">{t('Cargando…')}</p> : rows.length === 0 ? (
        <p className="empty">{data.length ? t('Ningún circuito coincide con la búsqueda.') : t('Todavía no hay vueltas.')}</p>
      ) : (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Circuito')}</th><th className="num">{t('Récord')}</th><th>{t('Piloto')}</th><th>{t('Coche')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Pilotos')}</th><th className="num">{t('Última vez')}</th></tr></thead>
            <tbody>
              {rows.map((tk) => (
                <tr key={`${tk.track}|${tk.layout}`}>
                  <td className="driver"><span className="who"><Preview className="thumb" image={trackImage(tk.track, tk.layout)} title={trackName(tk.track, tk.layout)} /><TrackLink track={tk.track} layout={tk.layout} name={trackName(tk.track, tk.layout)} /></span></td>
                  <td className="num lap">{formatLapTime(tk.recordMs)}</td>
                  <td>{tk.recordDriverId != null && tk.recordDriverName ? <DriverLink id={tk.recordDriverId} name={tk.recordDriverName} /> : <span className="muted">—</span>}</td>
                  <td>{tk.recordCar ? <CarLink car={tk.recordCar} name={carName(tk.recordCar)} /> : <span className="muted">—</span>}</td>
                  <td className="num muted">{num(tk.laps)}</td>
                  <td className="num muted">{tk.drivers}</td>
                  <td className="num muted">{ago(tk.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Todos los coches con los que se ha corrido; pulsar uno abre su ficha. */
export function CarsPage() {
  const { carName } = useContentNames();
  const { data, error } = useLive(api.cars, [], onLap);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (data ?? []).filter((c) => norm(carName(c.car)).includes(norm(q))), [data, q, carName]);
  return (
    <section className="panel">
      <div className="panel-head"><h2>{t('Coches')}</h2><Search value={q} onChange={setQ} label={t('Buscar coche')} /></div>
      {error && !data ? <p className="empty">{t('No se pudieron cargar los coches.')}</p> : !data ? <p className="empty">{t('Cargando…')}</p> : rows.length === 0 ? (
        <p className="empty">{data.length ? t('Ningún coche coincide con la búsqueda.') : t('Todavía no hay vueltas.')}</p>
      ) : (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Coche')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Pilotos')}</th><th className="num">{t('Circuitos')}</th><th className="num">{t('Última vez')}</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.car}>
                  <td className="driver"><span className="who"><Preview className="thumb" image={carImage(c.car)} title={carName(c.car)} /><CarLink car={c.car} name={carName(c.car)} /></span></td>
                  <td className="num">{num(c.laps)}</td>
                  <td className="num muted">{c.drivers}</td>
                  <td className="num muted">{c.tracks}</td>
                  <td className="num muted">{ago(c.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
