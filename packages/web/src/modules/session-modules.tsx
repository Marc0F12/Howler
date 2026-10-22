import { formatConditions } from '@howler/shared';
import { KingOfTheHill } from '../components/KingOfTheHill';
import { LatestRecords } from '../components/LatestRecords';
import { LiveMap } from '../components/LiveMap';
import { RecordTicker } from '../components/RecordTicker';
import { Podium } from '../components/Podium';
import { SessionTable } from '../components/SessionTable';
import { StatusLight } from '../components/StatusLight';
import { CarLink, TrackLink } from '../components/links';
import { useContentNames } from '../content';
import { ago, clock, fmtDate, sessionTypeName } from '../format';
import { t, tm } from '../i18n';
import type { SessionCtx } from './context';

/** Circuito, tipo, condiciones y coches de la sesión (en la portada con el estado en directo). */
export function SessionHeadModule({ c }: { c: SessionCtx }) {
  const { carName, trackName } = useContentNames();
  const s = c.session;
  const conditions = formatConditions(s.conditions);
  return (
    <header className="session-head">
      <div>
        <span className="session-kicker">
          {c.variant === 'home' ? (
            <>
              <span className={`flag ${c.live ? 'live' : 'down'}`}><StatusLight state={c.live ? 'live' : 'down'} />{c.live ? t('Sesión en directo') : t('Última sesión')}</span> · {sessionTypeName(s.type)} · {c.live ? t('empezó') : t('fue')} {ago(s.startedAt)} · <a href="#/sessions">{t('Ver historial')}</a>
            </>
          ) : (
            <><a href="#/sessions">← {t('Historial')}</a> · {sessionTypeName(s.type)} · {fmtDate(s.startedAt)} {clock(s.startedAt)}</>
          )}
        </span>
        <h2 className="session-title"><TrackLink track={s.track} layout={s.layout} name={trackName(s.track, s.layout)} /></h2>
        {conditions.length > 0 && <p className="session-conditions">{conditions.map((x) => <span key={x} className="chip">{tm(x)}</span>)}</p>}
      </div>
      {c.cars.length > 0 && <p className="session-cars">{c.cars.map((x) => <span key={x} className="chip-car"><CarLink car={x} name={carName(x)} /></span>)}</p>}
    </header>
  );
}

export const LiveMapModule = ({ c }: { c: SessionCtx }) => (
  <section className="panel">
    <div className="panel-head"><h2>{t('En pista')}</h2></div>
    <LiveMap track={c.session.track} layout={c.session.layout} online={c.live && c.status ? c.status.online : []} />
  </section>
);

export const PodiumModule = ({ c }: { c: SessionCtx }) => c.data.rows.length === 0 ? null : (
  <section className="panel">
    <div className="panel-head"><h2>{t('Los tres primeros')}</h2></div>
    <Podium rows={c.data.rows} />
  </section>
);

export const StandingsModule = ({ c }: { c: SessionCtx }) => c.data.rows.length === 0 ? null : (
  <section className="panel">
    <div className="panel-head"><h2>{t('Clasificación general')}</h2><span className="muted">{t('Pulsa un piloto para ver su evolución')}</span></div>
    <SessionTable data={c.data} />
  </section>
);

export const KingModule = ({ c }: { c: SessionCtx }) => c.data.rows.length === 0 ? null : (
  <section className="panel">
    <div className="panel-head"><h2>{t('Rey de la colina')}</h2></div>
    <KingOfTheHill sessionId={c.session.id} />
  </section>
);

export const LatestRecordsModule = () => (
  <section className="panel">
    <div className="panel-head"><h2>{t('Últimos récords')}</h2></div>
    <LatestRecords />
  </section>
);

export const RecordTickerModule = () => <RecordTicker />;
