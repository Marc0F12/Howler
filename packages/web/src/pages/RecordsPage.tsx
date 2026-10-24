import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLapTime, type ComboDto } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { useContentNames } from '../content';
import { FilterPanel } from '../components/FilterPanel';
import { GhostReplay } from '../components/GhostReplay';
import { CarLink, TrackLink } from '../components/links';
import { RecordsTable } from '../components/RecordsTable';

const trackKey = (c: Pick<ComboDto, 'track' | 'layout'>) => `${c.track}|${c.layout}`;

/**
 * Tiempos: se elige un circuito y uno o varios coches (cada lista solo ofrece lo que se ha jugado con la otra
 * elección). Con un circuito sale la tabla con la mejor vuelta de cada piloto; sin circuito, el récord de cada
 * combinación, y al pulsar una fila se abre su tabla. Al entrar se parte de la última combinación jugada.
 */
export function RecordsPage() {
  const [server, setServer] = useState('all');
  const servers = useLive(api.servers, [], (e) => e.type === 'results').data ?? [];
  const combos = useLive(() => api.combos(server), [server], (e) => e.type === 'lap' || e.type === 'results');
  const [track, setTrack] = useState('');
  const [cars, setCars] = useState<string[]>([]);
  const [ghostOpen, setGhostOpen] = useState(false);
  const started = useRef(false);

  const all = useMemo(() => combos.data ?? [], [combos.data]);

  useEffect(() => {
    if (started.current || !all.length) return;
    started.current = true;
    setTrack(trackKey(all[0]!));
    setCars([all[0]!.car]);
  }, [all]);

  const { carName, trackName } = useContentNames();
  const tracks = useMemo(
    () => [...new Set(all.filter((c) => !cars.length || cars.includes(c.car)).map(trackKey))],
    [all, cars],
  );
  const carOptions = useMemo(
    () => [...new Set(all.filter((c) => !track || trackKey(c) === track).map((c) => c.car))],
    [all, track],
  );

  const pickTrack = (v: string) => {
    setTrack(v);
    if (v) setCars((prev) => prev.filter((car) => all.some((c) => trackKey(c) === v && c.car === car)));
  };
  const pickCars = (next: string[]) => {
    setCars(next);
    if (track && next.length && !all.some((c) => trackKey(c) === track && next.includes(c.car))) setTrack('');
  };

  const selectedTrack = all.find((c) => trackKey(c) === track);
  const matching = all.filter((c) => (!track || trackKey(c) === track) && (!cars.length || cars.includes(c.car)));


  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('Tiempos')}</h2>
        {selectedTrack && (
          <button type="button" className="ghost-open" onClick={() => setGhostOpen(true)} title={t('Reproduce las 3 mejores vueltas a la vez sobre el mapa')}>
            <span aria-hidden="true">▶</span> {t('Ver fantasmas')} <span className="beta-tag">Beta</span>
          </button>
        )}
      </div>
      {servers.length > 1 && (
        <label className="server-pick">{t('Servidor')}{' '}
          <select value={server} onChange={(e) => { setServer(e.target.value); setTrack(''); setCars([]); }}>
            <option value="all">{t('Todos juntos')}</option>
            {servers.map((s) => <option key={s.key} value={s.key}>{s.badge} {s.name}{s.local ? ` (${t('este')})` : ''} · {t('{n} vueltas', { n: s.laps })}</option>)}
          </select>
        </label>
      )}
      {all.length > 0 && (
        <FilterPanel
          track={track}
          cars={cars}
          tracks={tracks}
          carOptions={carOptions}
          onTrack={pickTrack}
          onCars={pickCars}
          onClear={() => { setTrack(''); setCars([]); }}
        />
      )}
      {ghostOpen && selectedTrack && (
        <GhostReplay
          track={selectedTrack.track}
          layout={selectedTrack.layout}
          cars={cars}
          title={`${trackName(selectedTrack.track, selectedTrack.layout)} · ${cars.length ? cars.map(carName).join(', ') : t('todos los coches')}`}
          onClose={() => setGhostOpen(false)}
        />
      )}
      {!all.length ? (
        <p className="empty">{t('Todavía no hay vueltas. En cuanto alguien complete una, aparecerá aquí.')}</p>
      ) : selectedTrack ? (
        <RecordsTable track={selectedTrack.track} layout={selectedTrack.layout} cars={cars} server={server} />
      ) : (
        <CombosOverview combos={matching} carName={carName} trackName={trackName} onPick={(c) => { setTrack(trackKey(c)); setCars([c.car]); }} />
      )}
    </section>
  );
}

/** Una fila por combinación con su récord; pulsar una abre la tabla de tiempos de ese circuito. */
function CombosOverview({ combos, carName, trackName, onPick }: {
  combos: ComboDto[]; carName: (id: string) => string; trackName: (track: string, layout: string) => string; onPick: (c: ComboDto) => void;
}) {
  if (!combos.length) return <p className="empty">{t('Ningún circuito coincide con esos coches.')}</p>;
  return (
    <div className="table-scroll">
      <table className="timing overview">
        <thead>
          <tr>
            <th>{t('Circuito')}</th>
            <th>{t('Coche')}</th>
            <th className="num">{t('Récord')}</th>
            <th>{t('Piloto')}</th>
            <th className="num">{t('Pilotos')}</th>
            <th className="num">{t('Vueltas')}</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((c) => (
            <tr
              key={`${trackKey(c)}|${c.car}`}
              className="pick"
              tabIndex={0}
              onClick={() => onPick(c)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c); } }}
            >
              <td className="driver"><TrackLink track={c.track} layout={c.layout} name={trackName(c.track, c.layout)} /></td>
              <td><CarLink car={c.car} name={carName(c.car)} /></td>
              <td className="num lap">{c.bestMs != null ? formatLapTime(c.bestMs) : '—'}</td>
              <td>{c.bestDriverName ?? <span className="muted">{t('Sin vueltas válidas')}</span>}</td>
              <td className="num muted">{c.drivers}</td>
              <td className="num muted">{c.laps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
