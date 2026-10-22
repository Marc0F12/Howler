import { useState } from 'react';
import type { ChampionshipDto } from '@howler/shared';
import { useContentCard, useContentNames } from '../../content';
import { t } from '../../i18n';
import { ChampionshipPodium, PointsChart, RoundResults, StandingsTable } from '../championship-parts';
import { countryCode } from './cup-math';

function Chip({ r, on, onPick }: { r: ChampionshipDto['roundList'][number]; on: boolean; onPick: () => void }) {
  const { trackName } = useContentNames();
  const card = useContentCard('track', r.track, r.layout);
  return (
    <button type="button" role="tab" aria-selected={on} className={`cup-rchip ${on ? 'on' : ''} ${r.played ? '' : 'later'}`} onClick={onPick} title={card?.name ?? trackName(r.track, r.layout)}>
      <span className="cup-rchip-no">{String(r.number).padStart(2, '0')}</span>
      <span className="cup-rchip-name">{countryCode(card?.specs['País'])} {card?.name ?? trackName(r.track, r.layout)}</span>
    </button>
  );
}

/** Resultados: un slider con la clasificación general y cada carrera. Sigue a la carrera elegida en el carrusel y también puede cambiarla. */
export function CupResults({ c, index, onSelect }: { c: ChampionshipDto; index: number; onSelect: (i: number) => void }) {
  const [mode, setMode] = useState<'drivers' | 'teams'>('drivers');
  const r = c.roundList[index];
  const general = index >= c.roundList.length;
  const hasTeams = c.standings.teams.length > 0;
  return (
    <section className="cup-sec" aria-label={t('Resultados')}>
      <div className="cup-sec-head">
        <h2>{t('Resultados')}</h2>
        {general && hasTeams && (
          <span className="segmented" role="group" aria-label={t('Tipo de clasificación')}>
            <button type="button" className={mode === 'drivers' ? 'on' : ''} aria-pressed={mode === 'drivers'} onClick={() => setMode('drivers')}>{t('Pilotos')}</button>
            <button type="button" className={mode === 'teams' ? 'on' : ''} aria-pressed={mode === 'teams'} onClick={() => setMode('teams')}>{c.format === 'pairs' ? t('Parejas') : t('Equipos')}</button>
          </span>
        )}
      </div>
      <div className="cup-rchips" role="tablist" aria-label={t('Resultados de cada carrera')}>
        <button type="button" role="tab" aria-selected={general} className={`cup-rchip general ${general ? 'on' : ''}`} onClick={() => onSelect(c.roundList.length)}><span className="cup-rchip-name">{t('General')}</span></button>
        {c.roundList.map((x, i) => <Chip key={x.id} r={x} on={!general && i === index} onPick={() => onSelect(i)} />)}
      </div>
      <div className="cup-results-body">
        {general
          ? <><ChampionshipPodium c={c} /><StandingsTable c={c} mode={hasTeams ? mode : 'drivers'} />{c.scoring.mode === 'points' && c.roundList.filter((x) => x.played).length >= 2 && <PointsChart c={c} />}</>
          : r && <RoundResults c={c} r={r} />}
      </div>
    </section>
  );
}
