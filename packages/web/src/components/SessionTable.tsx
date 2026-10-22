import { useId, useMemo, useState } from 'react';
import { Empty } from './Empty';
import { motion } from 'motion/react';
import { formatDelta, formatLapTime, type TimingDto, type TimingRowDto } from '@howler/shared';
import { useContentNames } from '../content';
import { usePositionChanges } from '../hooks/usePositionChanges';
import { LapHistory } from './LapHistory';
import { t } from '../i18n';
import { CarLink, DriverLink } from './links';
import { Marker } from './markers';

const KIND_LABEL = () => ({ purple: t('mejor de la sesión'), green: t('mejor personal'), yellow: '', none: '' }) as const;

/** Un piloto fuera de pista se dibuja como un marcador vacío, para que se vea quién está y quién ya se fue. */
function Ghost() {
  return <svg viewBox="-14 -14 28 28" width="24" height="24" aria-hidden="true"><circle r="10" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="3 3" /></svg>;
}

function Row({ row, prevBestMs, change, sectors, sessionId, open, onToggle }: {
  row: TimingRowDto; prevBestMs: number | null; change: 'up' | 'down' | undefined; sectors: number; sessionId: number; open: boolean; onToggle: () => void;
}) {
  const { carName } = useContentNames();
  const panel = useId();
  const interval = row.position > 1 && row.bestMs != null && prevBestMs != null ? row.bestMs - prevBestMs : null;
  return (
    <motion.li layout="position" transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} className={`stable-item ${open ? 'open' : ''}`}>
      <div className={`stable-row ${row.online ? '' : 'offline'}`} onClick={onToggle}>
        <span className="stable-pos"><span className="rank">{row.position}</span></span>
        <span className={`stable-arrow ${change ?? ''}`} aria-hidden="true">{change === 'up' ? '▲' : change === 'down' ? '▼' : ''}</span>
        <span className="stable-marker">
          {row.carId != null ? <svg viewBox="-14 -14 28 28" width="24" height="24" aria-label={t('Coche {n}', { n: row.carId + 1 })}><Marker carId={row.carId} r={12} /></svg> : <Ghost />}
        </span>
        <span className="stable-name"><DriverLink id={row.driverId} name={row.driverName} /></span>
        <span className="stable-car">{row.car ? <CarLink car={row.car} name={carName(row.car)} /> : ''}</span>
        <span className={`stable-best num ${row.bestMs == null ? "none" : ""}`}>{formatLapTime(row.bestMs)}</span>
        <span className="stable-gap num" title={interval != null ? t('Al de delante: {d}', { d: formatDelta(interval) }) : undefined}>{row.position === 1 || row.gapMs == null ? '' : formatDelta(row.gapMs)}{interval != null && interval > 0 && row.position > 2 && <small className="stable-int">{formatDelta(interval)}</small>}</span>
        <span className={`stable-last num ${row.lastMs != null && !row.lastValid ? (row.lastPending ? 'pending' : 'void') : ''}`} title={row.lastMs != null && !row.lastValid ? (row.lastPending ? t('Pendiente de revisión: no cuenta hasta que el administrador la apruebe') : t('Vuelta anulada')) : undefined}>
          {formatLapTime(row.lastMs)}
        </span>
        <span className="stable-sectors" style={{ gridTemplateColumns: `repeat(${Math.max(sectors, 1)}, 1fr)` }}>
          {Array.from({ length: sectors }, (_, i) => {
            const s = row.lastSectors[i] ?? { ms: null, kind: 'none' as const };
            return (
              <span
                key={i}
                className={`sector-block ${s.kind}`}
                title={s.ms != null ? `S${i + 1}: ${formatLapTime(s.ms)}${KIND_LABEL()[s.kind] ? ` · ${KIND_LABEL()[s.kind]}` : ''}` : `S${i + 1}`}
              />
            );
          })}
        </span>
        <span className="stable-laps num">{row.laps}</span>
        <button type="button" className="stable-chevron" aria-expanded={open} aria-controls={panel} aria-label={t('Historial de {name}', { name: row.driverName })} onClick={(e) => { e.stopPropagation(); onToggle(); }}>▾</button>
      </div>
      <div className={`stable-detail ${open ? 'open' : ''}`} id={panel} role="region" aria-label={t('Historial de {name}', { name: row.driverName })} aria-hidden={!open}>
        <div className="stable-detail-inner">{open && <LapHistory sessionId={sessionId} driverId={row.driverId} />}</div>
      </div>
    </motion.li>
  );
}

/**
 * Clasificación completa de la sesión, del primero al último, al estilo de las retransmisiones de F1: mejor vuelta,
 * hueco con el primero, última vuelta y sus sectores en morado (mejor de la sesión), verde (mejor personal) o amarillo.
 * Pulsar un piloto despliega su historial de la sesión (uno abierto a la vez).
 */
export function SessionTable({ data }: { data: TimingDto }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const changes = usePositionChanges(useMemo(() => data.rows.map((r) => ({ id: r.driverId, position: r.position })), [data.rows]), String(data.session?.id ?? ''));

  if (data.rows.length === 0) return <Empty next={t('En cuanto alguien salga a pista, aparecerá aquí.')}>{t('Todavía no hay nadie en la sesión.')}</Empty>;

  return (
    <div className="stable" role="table" aria-label={t('Clasificación de la sesión')}>
      <div className="stable-head" role="row">
        <span>#</span><span /><span />
        <span>{t('Piloto')}</span>
        <span className="stable-car">{t('Coche')}</span>
        <span className="num">{t('Mejor')}</span>
        <span className="num">{t('Dif.')}</span>
        <span className="num stable-last">{t('Última')}</span>
        <span className="stable-sectors-h">{data.sectorCount ? t('Sectores') : ''}</span>
        <span className="num">V.</span>
        <span />
      </div>
      <ol className="stable-list">
        {data.rows.map((r, i) => (
          <Row
            key={r.driverId}
            prevBestMs={data.rows[i - 1]?.bestMs ?? null}
            row={r}
            change={changes.get(r.driverId)}
            sectors={data.sectorCount}
            sessionId={data.session!.id}
            open={openId === r.driverId}
            onToggle={() => setOpenId(openId === r.driverId ? null : r.driverId)}
          />
        ))}
      </ol>
    </div>
  );
}
