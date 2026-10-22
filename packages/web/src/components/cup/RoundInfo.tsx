import type { ChampionshipDto, ChampionshipEntryDto, ChampionshipModDto, ChampionshipRoundDto } from '@howler/shared';
import { folderKey } from '@howler/shared';
import { carImage, useContentCard, useContentNames } from '../../content';
import { t, tm } from '../../i18n';
import { when } from '../championship-parts';
import { powerToWeight, timeline, type TimelineItem } from './cup-math';
import { SpecIcon, specKind } from './spec-icons';

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

const KIND_LABEL = (i: TimelineItem) => i.title || (i.kind === 'practice' ? t('Práctica') : i.kind === 'quali' ? t('Clasificación') : i.kind === 'race' ? t('Carrera') : i.kind === 'post' ? t('Post carrera') : t('Sesión'));

/** Horarios del fin de semana como línea de tiempo: punto, tipo en color, hora o duración en grande y una descripción opcional. */
export function Timeline({ r }: { r: ChampionshipRoundDto }) {
  const items = timeline(r);
  if (items.length === 0) return <p className="muted">{t('Aún no hay horarios para esta carrera.')}</p>;
  return (
    <ol className="cup-tl">
      {items.map((i, k) => (
        <li key={k} className={`k-${i.kind}`}>
          <span className="cup-tl-kind">{KIND_LABEL(i)}</span>
          <strong className="cup-tl-main">{i.at ? when(i.at) : i.duration || '—'}</strong>
          {i.at && i.duration && <span className="cup-tl-dur">{i.duration}</span>}
          {i.text && <p className="cup-tl-text">{i.text}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Qué mod de coche corresponde a un coche permitido: por nombre y, si no, por posición cuando hay tantos mods como coches. */
export function matchCarMod(mods: ChampionshipModDto[], carId: string, carName: string, index: number, total: number): ChampionshipModDto | undefined {
  const keys = [folderKey(carId), folderKey(carName)].filter(Boolean);
  const byName = mods.find((m) => { const k = folderKey(m.name); return keys.some((x) => k === x || k.includes(x) || x.includes(k)); });
  return byName ?? (mods.length === total ? mods[index] : undefined);
}

const DownloadIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>;
const MAX_GRID = 8;

/** Ficha de un coche: imagen grande, nombre, cifras clave en una línea (sin cajas), los pilotos que lo llevan con su skin y la descarga del mod. */
function CarFicha({ id, mod, grid }: { id: string | null; mod?: ChampionshipModDto; grid: ChampionshipEntryDto[] }) {
  const { carName } = useContentNames();
  const card = useContentCard('car', id ?? undefined);
  const title = mod?.name || card?.name || (id ? carName(id) : '');
  const specs = mod && Object.keys(mod.specs).length > 0 ? mod.specs : card?.specs ?? {};
  const ptw = powerToWeight(specs);
  const stats = [...Object.entries(specs).map(([k, v]) => ({ label: tm(k), value: v })), ...(ptw != null ? [{ label: t('Potencia/peso'), value: `${ptw} cv/t` }] : [])];
  const img = safeHttp(mod?.imageUrl) ?? (id ? carImage(id) : undefined);
  const href = safeHttp(mod?.url);
  const shown = grid.slice(0, MAX_GRID);
  return (
    <article className="cup-car-card">
      <div className="cup-car-pic">{img && <img src={img} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}</div>
      <div className="cup-car-body">
        {card?.subtitle && <p className="cup-car-brand">{card.subtitle}</p>}
        <h4>{title}</h4>
        {stats.length > 0 && <dl className="cup-stats">{stats.map((x) => <div key={x.label}><span className="cup-stat-ic"><SpecIcon kind={specKind(x.label)} value={x.value} /></span><dd>{x.value}</dd><dt>{x.label}</dt></div>)}</dl>}
        {shown.length > 0 && (
          <div className="cup-grid-skins">
            <h5>{t('En la parrilla')}</h5>
            <ul>
              {shown.map((e) => (
                <li key={e.driverId} title={e.name}>
                  <img src={`/api/content/cars/${encodeURIComponent(e.car!)}/skins/${encodeURIComponent(e.skin!)}/preview`} alt="" loading="lazy" draggable={false} onError={(ev) => { ev.currentTarget.style.visibility = 'hidden'; }} />
                  <span>{e.name}</span>
                </li>
              ))}
              {grid.length > MAX_GRID && <li className="more">+{grid.length - MAX_GRID}</li>}
            </ul>
          </div>
        )}
        {href && <a className="cup-dl" href={href} target="_blank" rel="noopener noreferrer nofollow"><DownloadIcon />{t('Descargar')}</a>}
      </div>
    </article>
  );
}

/** Coches de la carrera: una ficha por coche. */
export function RoundCars({ c, r }: { c: ChampionshipDto; r: ChampionshipRoundDto }) {
  const carMods = [...r.mods, ...c.mods].filter((m) => m.kind === 'car');
  if (r.cars.length === 0 && carMods.length === 0) return <p className="muted">{t('Cualquier coche.')}</p>;
  if (r.cars.length === 0) return <div className="cup-cars">{carMods.map((m) => <CarFicha key={m.id} id={null} mod={m} grid={[]} />)}</div>;
  return (
    <div className="cup-cars">
      {r.cars.map((id, i) => <CarWithMod key={id} id={id} mods={carMods} index={i} total={r.cars.length} grid={c.entries.filter((e) => e.car === id && e.skin)} />)}
    </div>
  );
}

function CarWithMod({ id, mods, index, total, grid }: { id: string; mods: ChampionshipModDto[]; index: number; total: number; grid: ChampionshipEntryDto[] }) {
  const { carName } = useContentNames();
  return <CarFicha id={id} mod={matchCarMod(mods, id, carName(id), index, total)} grid={grid} />;
}
