import { motion } from 'motion/react';
import { formatDelta, formatLapTime, type TimingRowDto } from '@howler/shared';
import { carImage, useContentNames } from '../content';
import { t } from '../i18n';
import { Preview } from './Carousel3D';
import { CarLink, DriverLink } from './links';

const MEDAL = () => [t('oro'), t('plata'), t('bronce')];

/**
 * Los tres primeros de la sesión por mejor vuelta válida, con marco de oro, plata y bronce y la foto de su coche.
 * Entran escalonados (3.º, 2.º, 1.º) y, si alguien adelanta, las tarjetas se deslizan a su nuevo puesto.
 */
export function Podium({ rows }: { rows: TimingRowDto[] }) {
  const { carName } = useContentNames();
  const top = rows.filter((r) => r.bestMs != null).slice(0, 3);
  if (top.length === 0) return <p className="empty">{t('Todavía no hay ningún tiempo válido en esta sesión.')}</p>;
  return (
    <ol className="podium">
      {top.map((r) => (
        <motion.li
          key={r.driverId}
          layout="position"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1], delay: (3 - r.position) * 0.08 }}
          className={`podium-card p${r.position}`}
        >
          <Preview className="podium-img" image={r.car ? carImage(r.car) : undefined} title={r.car ? carName(r.car) : r.driverName} />
          <span className="podium-rank" role="img" aria-label={t('Puesto {n}, {medal}', { n: r.position, medal: MEDAL()[r.position - 1]! })}>{r.position}</span>
          <span className="podium-who">
            <span className="podium-name"><DriverLink id={r.driverId} name={r.driverName} /></span>
            <span className="podium-car">{r.car ? <CarLink car={r.car} name={carName(r.car)} /> : ''}</span>
          </span>
          <span className="podium-time num">{formatLapTime(r.bestMs)}</span>
          <span className="podium-gap num">{r.position === 1 ? (r.laps === 1 ? t('1 vuelta') : t('{n} vueltas', { n: r.laps })) : r.gapMs != null ? formatDelta(r.gapMs) : ''}</span>
        </motion.li>
      ))}
    </ol>
  );
}
