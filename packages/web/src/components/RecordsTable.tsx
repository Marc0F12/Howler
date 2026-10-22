import { formatDay } from '../format';
import { speedText } from '../prefs';
import { Empty } from './Empty';
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { formatAids, formatDelta, formatLapTime } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentNames } from '../content';
import { usePositionChanges } from '../hooks/usePositionChanges';
import { CompareBar, PickBox, useComparePicks } from './compare-select';
import { t, tm } from '../i18n';
import { CarLink, DriverLink } from './links';
import { ServerBadge } from './ServerBadge';
import { LapWeather } from './LapWeather';

const dateOf = (iso: string) => formatDay(new Date(iso), { month: '2-digit', year: true });

/**
 * Tabla de tiempos de un circuito: la mejor vuelta de cada piloto con cada coche, con su diferencia, los sectores
 * de esa vuelta, la vuelta óptima (suma de sus mejores sectores), las vueltas dadas y el agarre.
 * `cars` vacío = todos los coches jugados en el circuito.
 */
export function RecordsTable({ track, layout, cars, server = 'all' }: { track: string; layout: string; cars: string[]; server?: string }) {
  const { carName } = useContentNames();
  const picks = useComparePicks(track, layout);
  const carsKey = cars.join('|');
  // La insignia solo se enseña si hay más de un Howler vinculado (si no, no aporta nada).
  const multi = (useLive(api.servers, [], (e) => e.type === 'results').data?.length ?? 0) > 1;
  const { data, error } = useLive(
    () => api.records({ track, layout, cars, server }),
    [track, layout, carsKey, server],
    // Solo se recarga si la vuelta nueva es de este circuito y de uno de los coches mostrados.
    (e) => e.type === 'results' || (e.type === 'lap' && e.track === track && e.layout === layout && (!cars.length || cars.includes(e.car))),
  );
  const changes = usePositionChanges(useMemo(() => data?.entries.map((e) => ({ id: `${e.driverId}|${e.car}`, position: e.position })), [data]), `${track}|${layout}|${carsKey}|${server}`);

  if (error) return <p className="empty">{t('No se pudieron cargar los tiempos.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  if (!data.entries.length) return <Empty next={t('Prueba otra combinación de circuito y coche, o sé el primero en dar una vuelta.')}>{t('Todavía no hay vueltas válidas aquí.')}</Empty>;

  // El número de sectores depende del circuito (Gandía tiene 5).
  const sectorCount = Math.max(data.sectorBestsMs.length, ...data.entries.map((e) => e.sectorsMs.length));
  const sectorLabels = Array.from({ length: sectorCount }, (_, i) => `S${i + 1}`);
  const showCar = new Set(data.entries.map((e) => e.car)).size > 1;
  // Temperaturas y ayudas solo salen si alguna fila las tiene (con AssettoServer en directo no hay ayudas; vienen de importaciones).
  const showTemps = data.entries.some((e) => e.tempAir != null || e.tempTrack != null || e.weather != null || e.grip != null);
  const showAids = data.entries.some((e) => formatAids(e.aids).length > 0);

  return (
    <>
      <CompareBar picks={picks} />
      <div className="table-scroll">
        <table className="timing">
          <thead>
            <tr>
              <th className="pick-col" title={t('Elige 2 o 3 para comparar sus mejores vueltas')} aria-label={t('Comparar')} />
              <th className="pos">#</th>
              <th className="arrow"></th>
              <th>{t('Piloto')}</th>
              {showCar && <th>{t('Coche')}</th>}
              <th className="num">{t('Mejor vuelta')}</th>
              <th className="num">{t('Dif.')}</th>
              {sectorLabels.map((s) => <th key={s} className="num sector-col">{s}</th>)}
              <th className="num opt-col" title={t('Suma de sus mejores sectores')}>{t('Óptima')}</th>
              <th className="num" title={t('Velocidad máxima en su mejor vuelta')}>{t('V. máx.')}</th>
              <th className="num">{t('Vueltas')}</th>
              {showTemps && <th className="num" title={t('Pasa el ratón por el icono: clima, temperaturas y agarre de su mejor vuelta')}>{t('Clima')}</th>}
              {showAids && <th title={t('Ayudas que llevaba en su mejor vuelta')}>{t('Ayudas')}</th>}
              <th className="num date-col">{t('Fecha')}</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => {
              const key = `${e.driverId}|${e.car}`;
              const change = changes.get(key);
              const saves = e.optimalMs != null && e.optimalMs < e.lapMs;
              return (
                <motion.tr key={key} layout="position" transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}>
                  <td className="pick-col"><PickBox picks={picks} driverId={e.driverId} car={e.car} name={e.driverName} /></td>
                  <td className="pos"><span className="rank">{e.position}</span></td>
                  <td className={`arrow ${change ?? ''}`}>{change === 'up' ? '▲' : change === 'down' ? '▼' : ''}</td>
                  <td className="driver">{multi && <><ServerBadge text={e.serverBadge} bg={e.serverBadgeBg} fg={e.serverBadgeFg} title={t('Servidor')} />{' '}</>}<DriverLink id={e.driverId} name={e.driverName} /></td>
                  {showCar && <td className="muted car-col"><CarLink car={e.car} name={carName(e.car)} /></td>}
                  <td className="num lap">{formatLapTime(e.lapMs)}</td>
                  <td className="num muted">{e.position === 1 ? '' : formatDelta(e.gapMs)}</td>
                  {sectorLabels.map((_, i) => {
                    const s = e.sectorsMs[i] ?? null;
                    return (
                      <td
                        key={i}
                        className={`num sector ${s != null && s === data.sectorBestsMs[i] ? 'best' : ''} ${s != null && !e.sectorsExact ? 'est' : ''}`}
                        title={s != null && !e.sectorsExact ? t('Estimado en directo; se confirma al terminar la sesión') : undefined}
                      >
                        {formatLapTime(s)}
                      </td>
                    );
                  })}
                  <td className={`num opt-col ${saves ? 'gain' : 'muted'}`} title={saves ? t('Podría rebajar {delta}', { delta: formatDelta(e.optimalMs! - e.lapMs) }) : undefined}>
                    {e.optimalMs != null ? formatLapTime(e.optimalMs) : '—'}
                  </td>
                  <td className="num muted">{e.maxSpeedKmh != null ? speedText(e.maxSpeedKmh) : '—'}</td>
                  <td className="num muted" title={t('{valid} válidas de {total}', { valid: e.validLaps, total: e.laps })}>{e.validLaps}<span className="of">/{e.laps}</span></td>
                  {showTemps && <td className="num muted temp-col"><LapWeather weather={e.weather} tempAir={e.tempAir} tempTrack={e.tempTrack} grip={e.grip} /></td>}
                  {showAids && <td className="muted aids-cell">{formatAids(e.aids).map(tm).join(', ') || '—'}</td>}
                  <td className="num muted date-col">{dateOf(e.at)}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.entries.some((e) => !e.sectorsExact && e.sectorsMs.length > 0) && (
        <p className="note">{t('Los sectores en cursiva son una estimación en directo y se confirman al terminar la sesión. El tiempo de vuelta es siempre exacto.')}</p>
      )}
    </>
  );
}
