import { useEffect, useState } from 'react';
import { type ChampionshipDto } from '@howler/shared';
import { useContentCard, useContentNames } from '../../content';
import { t, tm } from '../../i18n';
import { CupCover } from './CupList';
import { CupResults } from './CupResults';
import { CupRoster } from './CupRoster';
import { ModsMenu } from './ModsMenu';
import { initialRound } from './cup-math';
import { RoundCarousel } from './RoundCarousel';
import { RoundCars, Timeline } from './RoundInfo';

const FORMAT = () => ({ individual: t('Individual'), pairs: t('Parejas'), teams: t('Equipos') }) as const;

function RoundHead({ c, index }: { c: ChampionshipDto; index: number }) {
  const r = c.roundList[index]!;
  const { trackName } = useContentNames();
  const card = useContentCard('track', r.track, r.layout);
  const facts = Object.entries(card?.specs ?? {});
  return (
    <header className="cup-round-head">
      <h2>{t('Carrera {n}', { n: r.number })} <span className="muted">· {card?.name ?? trackName(r.track, r.layout)}</span></h2>
      {facts.length > 0 && <ul className="cup-facts">{facts.map(([k, v]) => <li key={k}><span className="muted">{tm(k)}</span> {v}</li>)}</ul>}
    </header>
  );
}

/** Un campeonato: cabecera, participantes (siempre arriba, no cambian), carrusel de carreras y, debajo, lo de la carrera elegida (horarios, coches y resultados). */
export function CupDetail({ c }: { c: ChampionshipDto }) {
  const [index, setIndex] = useState(() => initialRound(c));
  useEffect(() => { setIndex((i) => Math.min(i, c.roundList.length)); }, [c.roundList.length]);
  const r = c.roundList[index];
  return (
    <div className="cup">
      <header className="cup-head">
        <a className="muted" href="#/championships">← {t('Campeonatos')}</a>
        <div className="cup-head-row">
          <CupCover c={c} size={96} />
          <div className="cup-head-text">
            <h1>{c.name}</h1>
            <p className="muted">
              {FORMAT()[c.format]} · {t('{n} participantes', { n: c.participants })} · {t('{played}/{total} carreras', { played: c.played, total: c.rounds })} · {c.status === 'finished' ? t('Terminado') : t('En curso')}
              {c.sharedFrom ? ` · ${t('Compartido por {name}', { name: c.sharedFrom })}` : ''}
            </p>
            {c.description && <p className="cup-desc">{c.description}</p>}
          </div>
          <ModsMenu c={c} />
        </div>
      </header>

      <section className="cup-sec" aria-label={t('Participantes')}>
        <div className="cup-sec-head"><h2>{c.teams.length ? t('Equipos y pilotos') : t('Pilotos')}</h2></div>
        <CupRoster c={c} />
      </section>

      {c.roundList.length > 0 && (
        <section className="cup-sec" aria-label={t('Carreras')}>
          <div className="cup-sec-head"><h2>{t('Carreras')}</h2></div>
          <RoundCarousel c={c} index={index} onSelect={setIndex} />
          {r && (
            <>
              <RoundHead c={c} index={index} />
              <div className="cup-round-grid">
                <div><h3 className="cup-h3">{t('Horarios')}</h3><Timeline r={r} /></div>
                <div><h3 className="cup-h3">{r.cars.length > 1 ? t('Coches') : t('Coche')}</h3><RoundCars c={c} r={r} /></div>
              </div>
            </>
          )}
        </section>
      )}

      {c.roundList.length > 0 && <CupResults c={c} index={index} onSelect={setIndex} />}
    </div>
  );
}
