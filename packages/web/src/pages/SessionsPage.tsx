import { ServerBadge } from '../components/ServerBadge';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { formatLapTime, type SessionHistoryItemDto } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentNames } from '../content';
import { fmtDate, clock, num, sessionTypeName } from '../format';

const PAGE = 30;

/** Historial de sesiones: cada práctica, clasificación o carrera por separado (aunque coincidan circuito y coche). Pulsar una abre sus tiempos. */
export function SessionsPage() {
  const { carName, trackName } = useContentNames();
  const [type, setType] = useState('');
  const [trackKey, setTrackKey] = useState('');
  const [car, setCar] = useState('');
  const [server, setServer] = useState('all');
  const [driverId, setDriverId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const drivers = useLive(api.drivers, [], (e) => e.type === 'results').data;
  const servers = useLive(api.servers, [], (e) => e.type === 'results').data ?? [];
  const [extra, setExtra] = useState<SessionHistoryItemDto[]>([]);
  const [more, setMore] = useState(0);
  const tracks = useLive(api.tracks, [], (e) => e.type === 'results').data;
  const cars = useLive(api.cars, [], (e) => e.type === 'results').data;
  const [track, layout] = trackKey ? (trackKey.split('|') as [string, string]) : [undefined, undefined];
  const filters = { track, layout, car: car || undefined, type: type ? Number(type) : undefined, server, driverId: driverId ? Number(driverId) : undefined, from: from || undefined, to: to || undefined };
  const page = useLive(() => api.sessions({ ...filters, limit: PAGE }), [type, trackKey, car, server, driverId, from, to], (e) => e.type === 'session' || e.type === 'lap' || e.type === 'results');
  // Al cambiar un filtro se empieza de cero
  useEffect(() => { setExtra([]); setMore(0); }, [type, trackKey, car, server, driverId, from, to]);

  // Si llega una sesión nueva, la primera página se desplaza: lo ya cargado de más páginas no debe repetirse.
  const firstIds = new Set((page.data?.items ?? []).map((s) => s.id));
  const items = [...(page.data?.items ?? []), ...extra.filter((s) => !firstIds.has(s.id))];
  const total = page.data?.total ?? 0;
  const filtersKey = [type, trackKey, car, server, driverId, from, to].join('|');
  const currentKey = useRef(filtersKey);
  currentKey.current = filtersKey;
  const loadMore = async () => {
    const mine = filtersKey;
    const next = await api.sessions({ ...filters, limit: PAGE, offset: PAGE * (more + 1) });
    if (currentKey.current !== mine) return; // mientras tanto cambió un filtro: esa página ya no vale
    setExtra((e) => [...e, ...next.items.filter((n) => !e.some((x) => x.id === n.id))]);
    setMore(more + 1);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('Historial de sesiones')}</h2>
        <span className="muted">{page.data ? (total === 1 ? t('1 sesión') : t('{n} sesiones', { n: num(total) })) : ''}</span>
      </div>
      <div className="sess-filters">
        {servers.length > 1 && (
          <select value={server} onChange={(e) => setServer(e.target.value)} aria-label={t('Servidor')}>
            <option value="all">{t('Todos los servidores')}</option>
            {servers.map((s) => <option key={s.key} value={s.key}>{s.badge} {s.name}{s.local ? ` (${t('este')})` : ''}</option>)}
          </select>
        )}
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('Tipo de sesión')}>
          <option value="">{t('Todos los tipos')}</option><option value="1">{t('Práctica')}</option><option value="2">{t('Clasificación')}</option><option value="3">{t('Carrera')}</option>
        </select>
        <select value={trackKey} onChange={(e) => setTrackKey(e.target.value)} aria-label={t('Circuito')}>
          <option value="">{t('Todos los circuitos')}</option>
          {(tracks ?? []).map((tk) => <option key={`${tk.track}|${tk.layout}`} value={`${tk.track}|${tk.layout}`}>{trackName(tk.track, tk.layout)}</option>)}
        </select>
        <select value={car} onChange={(e) => setCar(e.target.value)} aria-label={t('Coche')}>
          <option value="">{t('Todos los coches')}</option>
          {(cars ?? []).map((c) => <option key={c.car} value={c.car}>{carName(c.car)}</option>)}
        </select>
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label={t('Piloto')}>
          <option value="">{t('Todos los pilotos')}</option>
          {(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="sess-date">{t('Desde')} <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="sess-date">{t('Hasta')} <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {page.error && !page.data ? <p className="empty">{t('No se pudo cargar el historial.')}</p> : !page.data ? <p className="empty">{t('Cargando…')}</p> : items.length === 0 ? (
        <p className="empty">{t('No hay sesiones con esos filtros.')}</p>
      ) : (
        <ul className="sess-list">
          {items.map((s) => (
            <li key={s.id}>
              <a className="sess-row" href={`#/session/${s.id}`}>
                <span className="sess-when"><b>{fmtDate(s.startedAt)}</b><span className="muted">{clock(s.startedAt)}</span></span>
                <span className={`sess-type type-${s.type}`}>{sessionTypeName(s.type)}</span>
                <span className="sess-what">
                  <b>{servers.length > 1 && <><ServerBadge text={s.serverBadge} bg={s.serverBadgeBg} fg={s.serverBadgeFg} title={t('Servidor')} />{' '}</>}{trackName(s.track, s.layout)}</b>
                  <span className="muted">{s.cars.map(carName).join(', ')}</span>
                </span>
                <span className="sess-who muted">{s.driverNames.map((d) => d.name).join(', ')}{s.drivers > s.driverNames.length ? ` ${t('y {n} más', { n: s.drivers - s.driverNames.length })}` : ''}</span>
                <span className="sess-laps num muted">{s.validLaps}<span className="of">/{s.laps}</span> {t('vueltas')}</span>
                <span className="sess-best num lap" title={s.bestDriverName ?? undefined}>{formatLapTime(s.bestMs)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {items.length < total && <p className="sess-more"><button type="button" className="btn" onClick={() => void loadMore()}>{t('Ver más ({n} restantes)', { n: num(total - items.length) })}</button></p>}
    </section>
  );
}
