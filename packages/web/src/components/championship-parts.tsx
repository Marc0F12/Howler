import { formatDay, timeOf } from '../format';
import { useMemo, useState } from 'react';
import { formatLapTime, type ChampionshipDto, type ChampionshipModDto, type ChampionshipRoundDto, type StandingRow } from '@howler/shared';
import { carImage, trackImage, useContentCard, useContentNames } from '../content';
import { t, tm } from '../i18n';
import { Preview } from './Carousel3D';
import { DriverLink } from './links';
import { Avatar } from './profile-parts';

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** Fecha y hora en la zona horaria de quien mira la web. */
export const when = (iso: string | null) => (iso ? `${formatDay(new Date(iso), { month: 'short', weekday: true })} ${timeOf(new Date(iso))}` : null);

/** Botón de descarga de un mod: lleva a su enlace en una pestaña nueva. */
export function DownloadButton({ mod }: { mod: Pick<ChampionshipModDto, 'name' | 'url' | 'kind'> }) {
  const href = safeHttp(mod.url);
  if (!href) return null;
  return (
    <a className="dl-btn" href={href} target="_blank" rel="noopener noreferrer nofollow">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>
      <span><strong>{t('Descargar')}</strong><small>{mod.name}</small></span>
    </a>
  );
}

function Specs({ specs }: { specs: Record<string, string> }) {
  const entries = Object.entries(specs);
  if (entries.length === 0) return null;
  return <dl className="specs">{entries.map(([k, v]) => <div key={k}><dt>{tm(k)}</dt><dd>{v}</dd></div>)}</dl>;
}

function Card({ kind, title, sub, image, fallbackImage, specs, mods }: { kind: string; title: string; sub?: string; image?: string; fallbackImage?: string; specs: Record<string, string>; mods: ChampionshipModDto[] }) {
  return (
    <article className="cp-card">
      <div className="cp-pic"><span className="cp-tag">{kind}</span><Preview className="cp-img" image={image ?? fallbackImage} title={title} /></div>
      <div className="cp-body"><h4>{title}</h4>{sub && <p className="muted">{sub}</p>}<Specs specs={specs} />{mods.map((m) => <DownloadButton key={m.id} mod={m} />)}</div>
    </article>
  );
}

/** Una carrera: fechas, tarjeta de coche y de circuito (con su ficha) y los botones de descarga de sus mods. */
export function RoundCard({ c, r, onOpen }: { c: ChampionshipDto; r: ChampionshipRoundDto; onOpen?: () => void }) {
  const { carName, trackName } = useContentNames();
  const nextNo = c.next?.number;
  const all = [...r.mods, ...c.mods];
  const carMods = all.filter((m) => m.kind === 'car');
  const trackMods = all.filter((m) => m.kind === 'track');
  const others = r.mods.filter((m) => m.kind !== 'car' && m.kind !== 'track'); // los mods globales ya salen en su propia sección
  const trackMod = r.mods.find((m) => m.kind === 'track') ?? (c.roundList.length === 1 || new Set(c.roundList.map((x) => `${x.track}|${x.layout}`)).size === 1 ? trackMods[0] : undefined);
  const car = r.cars[0];
  const carMod = carMods[0];
  const carCard = useContentCard('car', car);
  const trackCard = useContentCard('track', r.track, r.layout);
  return (
    <section className={`cp-round ${nextNo === r.number ? 'next' : ''}`} aria-label={t('Carrera {n}', { n: r.number })}>
      <header>
        <h3>{t('Carrera {n}', { n: r.number })}</h3>
        <span className={`badge ${r.played ? 'ok' : nextNo === r.number ? 'pending' : ''}`}>{r.played ? t('Disputada') : nextNo === r.number ? t('Próxima') : t('Pendiente')}</span>
        <ul className="cp-sessions">
          {([[t('Práctica'), r.practiceAt], [t('Clasificación'), r.qualiAt], [t('Carrera'), r.raceAt]] as const).map(([l, at]) => at && <li key={l}><span className="muted">{l}</span> <strong>{when(at)}</strong></li>)}
        </ul>
        {onOpen && r.played && <button type="button" className="btn small" onClick={onOpen}>{t('Ver resultados')}</button>}
      </header>
      <div className="cp-cards">
        <Card kind={t('Circuito')} title={trackMod?.name || trackCard?.name || trackName(r.track, r.layout)} sub={trackMod ? (trackCard?.name ?? trackName(r.track, r.layout)) : trackCard?.subtitle ?? undefined} image={safeHttp(trackMod?.imageUrl)} fallbackImage={trackImage(r.track, r.layout)} specs={{ ...trackCard?.specs, ...trackMod?.specs }} mods={trackMods.filter((m) => m === trackMod || !trackMod)} />
        {(car || carMod) && <Card kind={r.cars.length > 1 ? t('Coches permitidos') : t('Coche')} title={carMod?.name || carCard?.name || (car ? carName(car) : '')} sub={r.cars.length > 1 ? r.cars.map(carName).join(' · ') : carCard?.subtitle ?? undefined} image={safeHttp(carMod?.imageUrl)} fallbackImage={car ? carImage(car) : undefined} specs={{ ...carCard?.specs, ...carMod?.specs }} mods={carMods} />}
      </div>
      {others.length > 0 && <div className="cp-dl-row">{others.map((m) => <DownloadButton key={m.id} mod={m} />)}</div>}
    </section>
  );
}

/** Pilotos o equipos: posición, nombre con su color y puntos de cada carrera. Las carreras descartadas salen tachadas. */
export function StandingsTable({ c, mode }: { c: ChampionshipDto; mode: 'drivers' | 'teams' }) {
  const rows = mode === 'drivers' ? c.standings.drivers : c.standings.teams;
  const played = c.roundList.filter((r) => r.played);
  const lower = c.scoring.mode === 'aggregate';
  const label = (row: StandingRow) => {
    if (mode === 'teams') { const tm = c.teams.find((x) => x.id === row.id); return { name: tm?.name ?? '', color: tm?.color ?? 'var(--muted)', sub: c.entries.filter((e) => e.teamId === row.id).map((e) => e.name).join(' · ') }; }
    const e = c.entries.find((x) => x.driverId === row.id);
    const tm = c.teams.find((x) => x.id === e?.teamId);
    return { name: e?.name ?? '', color: e?.color ?? tm?.color ?? 'var(--muted)', sub: tm?.name ?? '' };
  };
  const fmt = (v: number | null) => (v == null ? '—' : c.scoring.mode === 'aggregate' && ['bestLap', 'avgLap', 'consistency'].includes(c.scoring.aggregate.metric) ? formatLapTime(Math.round(v)) : String(Math.round(v * 100) / 100));
  if (rows.length === 0) return <p className="empty">{t('Todavía no hay clasificación.')}</p>;
  return (
    <div className="table-scroll">
      <table className="timing cp-standings">
        <thead><tr><th>#</th><th>{mode === 'drivers' ? t('Piloto') : t('Equipo')}</th>{played.map((r) => <th key={r.id} className="num">C{r.number}</th>)}<th className="num">{lower ? t('Total') : t('Puntos')}</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const l = label(row);
            return (
              <tr key={row.id}>
                <td className="num"><strong>{row.position}</strong></td>
                <td><span className="team-dot" style={{ background: l.color }} aria-hidden="true" />{mode === 'drivers' ? <DriverLink id={row.id} name={l.name} /> : <strong>{l.name}</strong>}{l.sub && <span className="muted"> · {l.sub}</span>}</td>
                {c.roundList.map((r, i) => r.played && <td key={r.id} className={`num ${row.rounds[i]?.dropped ? 'void' : ''}`} title={row.rounds[i]?.dropped ? t('Resultado descartado') : undefined}>{fmt(row.rounds[i]?.score ?? null)}</td>)}
                <td className="num total"><strong>{fmt(row.total)}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Los tres primeros de la clasificación de pilotos, con su foto. */
export function ChampionshipPodium({ c }: { c: ChampionshipDto }) {
  const top = c.standings.drivers.filter((r) => r.rounds.some((x) => x.score != null)).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <ol className="podium cp-podium">
      {top.map((r) => {
        const e = c.entries.find((x) => x.driverId === r.id);
        const tm = c.teams.find((x) => x.id === e?.teamId);
        return (
          <li key={r.id} className={`podium-card p${r.position}`} style={{ borderColor: e?.color ?? tm?.color }}>
            <Avatar driverId={r.id} name={e?.name ?? ''} size={72} />
            <span className="podium-rank" role="img" aria-label={t('Puesto {n}', { n: r.position })}>{r.position}</span>
            <span className="podium-who"><DriverLink id={r.id} name={e?.name ?? ''} />{tm && <span className="muted"> {tm.name}</span>}</span>
            <strong className="num">{Math.round(r.total * 100) / 100}</strong>
          </li>
        );
      })}
    </ol>
  );
}

/** Resultado de una carrera: puesto, piloto, salida, tiempo con penalizaciones, mejor vuelta, vueltas y puntos. */
export function RoundResults({ c, r }: { c: ChampionshipDto; r: ChampionshipRoundDto }) {
  const rows = useMemo(() => [...r.results].sort((a, b) => (a.finishPos ?? 99) - (b.finishPos ?? 99)), [r.results]);
  const name = (id: number) => c.entries.find((e) => e.driverId === id)?.name ?? '';
  const anyPenalty = r.results.some((x) => x.penaltyMs > 0 || x.dsq);
  if (!r.played) return <p className="empty">{t('Esta carrera aún no se ha disputado.')}</p>;
  return (
    <div className="table-scroll">
      <table className="timing">
        <thead><tr><th>#</th><th>{t('Piloto')}</th><th className="num">{t('Salida')}</th><th className="num">{t('Tiempo')}</th>{anyPenalty && <th className="num">{t('Penaliz.')}</th>}<th className="num">{t('Mejor vuelta')}</th><th className="num">{t('Vueltas')}</th>{c.scoring.mode === 'points' && <th className="num">{t('Puntos')}</th>}</tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.driverId} className={x.dsq ? 'void' : ''}>
              <td className="num">{x.dsq ? 'DSQ' : x.finishPos}</td><td><DriverLink id={x.driverId} name={name(x.driverId)} /></td><td className="num muted">{x.qualiPos ?? '—'}</td>
              <td className="num">{x.dsq ? '—' : formatLapTime(x.totalMs)}</td>
              {anyPenalty && <td className="num" title={x.notes.join(' · ') || undefined}>{x.dsq ? <span className="badge bad">{t('Descalificado')}</span> : x.penaltyMs > 0 ? <span className="badge bad">+{Math.round(x.penaltyMs / 100) / 10} s</span> : ''}</td>}
              <td className="num">{formatLapTime(x.bestLapMs)}</td><td className="num">{x.laps}</td>{c.scoring.mode === 'points' && <td className="num"><strong>{x.points}</strong></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Puntos acumulados tras cada carrera (solo campeonatos por puntos con al menos 2 carreras jugadas). Cada línea lleva trazo distinto además del color. */
export function PointsChart({ c }: { c: ChampionshipDto }) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const idx = c.roundList.map((r, i) => (r.played ? i : -1)).filter((i) => i >= 0);
  if (c.scoring.mode !== 'points' || idx.length < 2) return null;
  const series = c.standings.drivers.map((row) => {
    let acc = 0;
    return { id: row.id, pts: idx.map((i) => (acc += row.rounds[i]?.dropped ? 0 : (row.rounds[i]?.score ?? 0))) };
  });
  const W = 720, H = 240, P = { l: 40, r: 16, t: 14, b: 28 };
  const max = Math.max(1, ...series.flatMap((s) => s.pts));
  const x = (k: number) => P.l + ((W - P.l - P.r) * k) / (idx.length - 1);
  const y = (v: number) => H - P.b - ((H - P.t - P.b) * v) / max;
  const color = (id: number) => { const e = c.entries.find((q) => q.driverId === id); return e?.color ?? c.teams.find((x) => x.id === e?.teamId)?.color ?? 'var(--accent)'; };
  const dash = ['', '7 4', '2 4', '10 4 2 4'];
  const visible = series.filter((s) => !hidden.has(s.id));
  const slot = new Map(series.map((s, i) => [s.id, i])); // el trazo de cada piloto es siempre el mismo, esté o no oculto otro
  return (
    <div className="cp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Puntos acumulados tras cada carrera')} onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(idx.length - 1, Math.round((((e.clientX - b.left) / b.width) * W - P.l) / ((W - P.l - P.r) / (idx.length - 1)))))); }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="grid" /><text x={P.l - 6} y={y(max * f) + 4} textAnchor="end">{Math.round(max * f)}</text></g>)}
        {idx.map((ri, k) => <text key={ri} x={x(k)} y={H - 8} textAnchor="middle">C{c.roundList[ri]!.number}</text>)}
        {visible.map((s) => (
          <g key={s.id}>
            <polyline fill="none" stroke={color(s.id)} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash[slot.get(s.id)! % dash.length]} points={s.pts.map((v, k) => `${x(k)},${y(v)}`).join(' ')} />
            {s.pts.map((v, k) => <circle key={k} cx={x(k)} cy={y(v)} r={3.5} fill={color(s.id)} />)}
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} className="cursor" />}
      </svg>
      <p className="cp-tip" aria-live="polite">{hover == null ? t('Pasa el cursor por la gráfica para ver los puntos tras cada carrera.') : `${t('Tras la carrera {n}:', { n: c.roundList[idx[hover]!]!.number })} ` + visible.map((s) => ({ n: c.entries.find((e) => e.driverId === s.id)?.name ?? '', v: s.pts[hover]! })).sort((a, b) => b.v - a.v).map((o) => `${o.n} ${Math.round(o.v * 100) / 100}`).join(' · ')}</p>
      <div className="cp-legend">
        {series.map((s, n) => (
          <button key={s.id} type="button" aria-pressed={!hidden.has(s.id)} onClick={() => setHidden((h) => { const q = new Set(h); q.has(s.id) ? q.delete(s.id) : q.add(s.id); return q; })}>
            <svg width="26" height="8" aria-hidden="true"><line x1="0" x2="26" y1="4" y2="4" stroke={color(s.id)} strokeWidth="3" strokeDasharray={dash[n % dash.length]} /></svg>{c.entries.find((e) => e.driverId === s.id)?.name}
          </button>
        ))}
      </div>
    </div>
  );
}
