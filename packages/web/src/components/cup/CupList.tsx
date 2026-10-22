import type { ChampionshipSummaryDto } from '@howler/shared';
import { isChampionshipImageRef } from '@howler/shared';
import { autoBadgeUri } from '../../badge/badge-image';
import { useContentNames } from '../../content';
import { t } from '../../i18n';
import { Empty } from '../Empty';
import { when } from '../championship-parts';
import { imageFit } from './cup-math';

const FORMAT = () => ({ individual: t('Individual'), pairs: t('Parejas'), teams: t('Equipos') }) as const;

/** Imagen del campeonato en un marco cuadrado: una foto lo llena y un PNG tipo insignia o copa se ve entero y centrado. Sin imagen, una insignia automática (determinista: sale de su nombre y de los colores de sus equipos). */
export function CupCover({ c, size }: { c: Pick<ChampionshipSummaryDto, 'imageUrl' | 'name'> & { imageFit?: 'cover' | 'contain' | null; teamColors?: string[] }; size?: number }) {
  const has = isChampionshipImageRef(c.imageUrl);
  const fit = imageFit(c);
  return (
    <span className={`cup-cover ${has ? `fit-${fit}` : 'fit-contain auto'}`} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <img src={has ? c.imageUrl! : autoBadgeUri(c.name, c.teamColors)} alt="" loading="lazy" decoding="async" draggable={false} />
    </span>
  );
}

/** Primera pantalla: la lista de campeonatos (activos y pasados) con su imagen cuadrada. */
export function CupList({ list }: { list: ChampionshipSummaryDto[] }) {
  const { trackName } = useContentNames();
  const active = list.filter((x) => x.status === 'active');
  const past = list.filter((x) => x.status === 'finished');
  const group = (title: string, items: ChampionshipSummaryDto[]) => items.length > 0 && (
    <section className="cup-sec" aria-label={title}>
      <div className="cup-sec-head"><h2>{title}</h2></div>
      <ul className="cup-list">
        {items.map((x) => (
          <li key={x.id}>
            <a className="cup-badge" data-status={x.status} href={`#/championship/${x.id}`}>
              <CupCover c={x} />
              <span className="cup-badge-info">
                <strong>{x.name}</strong>
                <span className="muted">{FORMAT()[x.format]} · {t('{n} participantes', { n: x.participants })}</span>
                <span className="muted">{t('{played}/{total} carreras', { played: x.played, total: x.rounds })}{x.sharedFrom ? ` · ${t('Compartido por {name}', { name: x.sharedFrom })}` : ''}</span>
                {x.next && <span className="cup-item-next">{t('Próxima:')} {trackName(x.next.track, x.next.layout)}{x.next.raceAt ? ` · ${when(x.next.raceAt)}` : ''}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
  if (list.length === 0) return <Empty next={t('El administrador los crea desde el panel, en Competición → Campeonatos.')}>{t('Todavía no hay campeonatos.')}</Empty>;
  return <div className="cup">{group(t('Campeonatos activos'), active)}{group(t('Campeonatos pasados'), past)}</div>;
}
