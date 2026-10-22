import { useEffect, useRef, useState } from 'react';
import type { ChampionshipDto, ChampionshipEntryDto } from '@howler/shared';
import { useContentNames } from '../../content';
import { t } from '../../i18n';
import { DriverLink } from '../links';
import { Avatar } from '../profile-parts';
import { groupRoster } from './cup-math';

/** Skin de un participante en un desplegable: su imagen si tiene una asignada o, si no, «Skin no asignada». */
function SkinPeek({ e }: { e: ChampionshipEntryDto }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const { carName } = useContentNames();
  useEffect(() => {
    if (!open) return;
    const away = (ev: PointerEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const has = !!(e.car && e.skin);
  return (
    <span className="cup-skin" ref={box}>
      <button type="button" className={`cup-skin-btn ${has ? 'has' : ''}`} aria-expanded={open} aria-label={t('Skin de {name}', { name: e.name })} title={has ? t('Ver su skin') : t('Skin no asignada')} onClick={() => setOpen((o) => !o)}>
                {t('Skin')} <span aria-hidden="true" className="cup-skin-caret">▾</span>
      </button>
      {open && (
        <div className="cup-skin-pop" role="dialog" aria-label={t('Skin de {name}', { name: e.name })}>
          {has
            ? <><img src={`/api/content/cars/${encodeURIComponent(e.car!)}/skins/${encodeURIComponent(e.skin!)}/preview`} alt="" loading="lazy" draggable={false} onError={(ev) => { ev.currentTarget.style.display = 'none'; }} /><span>{carName(e.car!)}</span></>
            : <p>{e.car ? t('{car}: skin no asignada', { car: carName(e.car) }) : t('Skin no asignada')}</p>}
        </div>
      )}
    </span>
  );
}

/** Participantes del campeonato agrupados por equipo (si hay), cada uno con su foto de Steam y un desplegable con su skin. Solo quién corre: aquí no hay puntos ni resultados. */
export function CupRoster({ c }: { c: ChampionshipDto }) {
  const groups = groupRoster(c);
  if (groups.length === 0) return <p className="muted">{t('Todavía no hay participantes.')}</p>;
  return (
    <div className={`cup-roster ${c.teams.length ? 'teams' : 'flat'}`}>
      {groups.map((g) => (
        <section key={g.team?.id ?? 'x'} className="cup-team" style={g.team ? { ['--team' as string]: g.team.color } : undefined} aria-label={g.team?.name ?? t('Sin equipo')}>
          {c.teams.length > 0 && <h3 className="cup-team-name">{g.team?.name ?? t('Sin equipo')}</h3>}
          <ul>
            {g.entries.map((e) => (
              <li key={e.driverId} className="cup-pilot">
                <Avatar driverId={e.driverId} name={e.name} size={40} />
                <span className="cup-pilot-who"><DriverLink id={e.driverId} name={e.name} /></span>
                <SkinPeek e={e} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
