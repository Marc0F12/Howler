import { useEffect, useMemo, useState } from 'react';
import type { InstalledContentDto } from '@howler/shared';
import { carImage, trackImage, trackOutline, useContentCard } from '../content';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';

export type CarOption = InstalledContentDto['cars'][number];
export interface SkinOption { id: string; name: string }

export const skinUrl = (model: string, skin: string) => `/admin/api/content/cars/${encodeURIComponent(model)}/skins/${encodeURIComponent(skin)}/preview`;

interface Tile { id: string; name: string; sub: string | null; image: string; /** Por qué se puede filtrar: faceta → valores. */ facets?: Record<string, string[]>; /** Longitudes en km (de cada recorrido), para el filtro por distancia. */ kms?: number[] }
interface Facet { key: string; label: string }
interface FacetApi { /** Pone o quita un filtro (pulsar una etiqueta de la ficha). */ toggle: (key: string, value: string) => void; active: Record<string, string> }

/**
 * Marco de los selectores, como el de Content Manager: a la izquierda lo elegido en grande con su ficha, a la derecha la lista
 * con buscador y vistas previas, y abajo Aceptar / Cancelar. `list` = null deja solo la ficha (para elegir solo la skin).
 */
function Shell({ title, onCancel, onOk, okLabel, okDisabled, left, list, selected, onSelect, footer, searchLabel, facets = [] }: {
  title: string; onCancel: () => void; onOk: () => void; okLabel: string; okDisabled?: boolean; left: (f: FacetApi) => React.ReactNode;
  list: Tile[] | null; selected: string; onSelect: (id: string) => void; footer?: React.ReactNode; searchLabel: string; facets?: Facet[];
}) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onCancel]);
  const toggle = (key: string, value: string) => setFilters((f) => { const n = { ...f }; if (n[key] === value) delete n[key]; else n[key] = value; return n; });
  const options = useMemo(() => facets.map((f) => {
    const counts = new Map<string, number>();
    for (const x of list ?? []) for (const v of x.facets?.[f.key] ?? []) counts.set(v, (counts.get(v) ?? 0) + 1);
    return { ...f, values: [...counts].sort((a, b) => a[0].localeCompare(b[0], 'es')) };
  }).filter((f) => f.values.length > 0), [list, facets]);
  const LEN_CAP = 30;
  const bounds = useMemo(() => {
    const all = (list ?? []).flatMap((x) => x.kms ?? []);
    // Los mapas de conducción libre pueden medir cientos de km y estirarían la barra: se corta en 30 km («30+»).
    return all.length ? { min: Math.min(Math.floor(Math.min(...all)), LEN_CAP), max: Math.min(Math.ceil(Math.max(...all)), LEN_CAP), capped: Math.max(...all) > LEN_CAP } : null;
  }, [list]);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [lo, hi] = range && bounds ? [Math.max(range[0], bounds.min), Math.min(range[1], bounds.max)] : bounds ? [bounds.min, bounds.max] : [0, 0];
  const ranged = !!bounds && (lo > bounds.min || hi < bounds.max);
  const shown = useMemo(() => {
    if (!list) return [];
    const n = q.trim().toLowerCase();
    return list.filter((x) => (!n || `${x.name} ${x.sub ?? ''} ${x.id}`.toLowerCase().includes(n)) && Object.entries(filters).every(([k, v]) => x.facets?.[k]?.includes(v))
      && (!ranged || (x.kms ?? []).some((k) => k >= lo && (k <= hi || (!!bounds?.capped && hi >= bounds.max)))));
  }, [list, q, filters, ranged, lo, hi]);
  const nFilters = Object.keys(filters).length + (ranged ? 1 : 0);
  return (
    <div className="pick-overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`cm-dialog ${list ? '' : 'solo'}`}>
        <div className="cm-left">{left({ toggle, active: filters })}</div>
        {list && (
          <div className="cm-right">
            {options.length > 0 && (
              <div className="cm-facets">
                {options.map((f) => (
                  <select key={f.key} value={filters[f.key] ?? ''} className={filters[f.key] ? 'on' : ''} aria-label={f.label} onChange={(e) => setFilters((cur) => { const n = { ...cur }; if (e.target.value) n[f.key] = e.target.value; else delete n[f.key]; return n; })}>
                    <option value="">{f.label}</option>
                    {f.values.map(([v, c]) => <option key={v} value={v}>{v} ({c})</option>)}
                  </select>
                ))}
                {nFilters > 0 && <button type="button" className="btn small" onClick={() => { setFilters({}); setRange(null); }}>{t('Quitar filtros')}</button>}
              </div>
            )}
            {bounds && bounds.max > bounds.min && (
              <div className="cm-range" role="group" aria-label={t('Longitud')}>
                <span className="cm-range-label">{t('Longitud')}: <b>{lo}</b>–<b>{hi}{bounds.capped && hi >= bounds.max ? '+' : ''}</b> km</span>
                <div className="cm-range-bar">
                  <input type="range" min={bounds.min} max={bounds.max} step={1} value={lo} aria-label={t('Longitud mínima (km)')} onChange={(e) => setRange([Math.min(Number(e.target.value), hi), hi])} />
                  <input type="range" min={bounds.min} max={bounds.max} step={1} value={hi} aria-label={t('Longitud máxima (km)')} onChange={(e) => setRange([lo, Math.max(Number(e.target.value), lo)])} />
                </div>
              </div>
            )}
            <input type="search" className="pick-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
            <div className="cm-list" role="listbox" aria-label={title}>
              {shown.map((x) => (
                <button key={x.id} type="button" role="option" aria-selected={x.id === selected} className={`cm-tile ${x.id === selected ? 'on' : ''}`} onClick={() => onSelect(x.id)} onDoubleClick={() => { onSelect(x.id); onOk(); }} title={x.id}>
                  <img src={x.image} alt="" loading="lazy" width={150} height={84} />
                  <span className="cm-tile-name">{x.name}</span>
                  {x.sub && <span className="cm-tile-sub">{x.sub}</span>}
                </button>
              ))}
              {shown.length === 0 && <p className="hint">{t('No coincide ninguno.')}</p>}
            </div>
            <p className="cm-count">{t('{n} de {m}', { n: shown.length, m: list.length })}</p>
          </div>
        )}
        <footer className="cm-foot">
          <span className="cm-foot-extra">{footer}</span>
          <button type="button" className="btn primary" disabled={okDisabled} onClick={onOk}>{okLabel}</button>
          <button type="button" className="btn" onClick={onCancel}>{t('Cancelar')}</button>
        </footer>
      </div>
    </div>
  );
}

/** Marca, país, tracción y etiquetas de la ficha: al pulsar una se filtra la lista por ella (como en Content Manager). */
function Chips({ chips, f }: { chips: { key: string; label: string; value: string | null | undefined }[]; f: FacetApi }) {
  const list = chips.filter((c): c is { key: string; label: string; value: string } => !!c.value);
  return list.length === 0 ? null : (
    <div className="cm-chips">{list.map((c) => (
      <button key={`${c.key}:${c.value}`} type="button" className={`cm-chip ${f.active[c.key] === c.value ? 'on' : ''}`} title={`${c.label}: ${c.value}`} onClick={() => f.toggle(c.key, c.value)}>{c.value}</button>
    ))}</div>
  );
}

const Specs = ({ specs }: { specs: Record<string, string> | undefined }) => {
  const rows = Object.entries(specs ?? {});
  return rows.length === 0 ? null : (
    <dl className="cm-specs">{rows.map(([k, v]) => <div key={k}><dt>{tm(k)}</dt><dd>{v}</dd></div>)}</dl>
  );
};

const CAR_FACETS: Facet[] = [
  { key: 'creador', label: t('Creador') }, { key: 'marca', label: t('Marca') }, { key: 'pais', label: t('País') }, { key: 'traccion', label: t('Tracción') }, { key: 'clase', label: t('Clase') }, { key: 'etiqueta', label: t('Etiqueta') },
];
const TRACK_FACETS: Facet[] = [{ key: 'creador', label: t('Creador') }, { key: 'pais', label: t('País') }, { key: 'ciudad', label: t('Ciudad') }, { key: 'etiqueta', label: t('Etiqueta') }];
const some = (...v: (string | null | undefined)[]) => v.filter((x): x is string => !!x);

/**
 * Elegir un coche y su skin (o solo la skin, con `skinOnly`: entonces la lista de la derecha son las skins con su vista previa).
 * Con `withCount`, además cuántas plazas añadir. `onOk` recibe el coche, la skin elegida y las plazas.
 */
export function CarDialog({ cars, model: initialModel, skin: initialSkin, skinOnly, withCount, free, title, onOk, onCancel }: {
  cars: CarOption[]; model?: string; skin?: string; skinOnly?: boolean; withCount?: boolean;
  /** Plazas de boxes libres (null = no se sabe). */ free?: number | null; title: string;
  onOk: (model: string, skin: string, count: number, skins: SkinOption[]) => void; onCancel: () => void;
}) {
  const [model, setModel] = useState(initialModel ?? cars[0]?.id ?? '');
  const [skin, setSkin] = useState(initialSkin ?? '');
  const [skins, setSkins] = useState<SkinOption[]>([]);
  const [count, setCount] = useState(1);
  const card = useContentCard('car', model);
  useEffect(() => {
    let live = true;
    setSkins([]);
    if (model) void adminApi.carSkins(model).then((l) => { if (live) { setSkins(l); setSkin((cur) => (cur && l.some((k) => k.id === cur) ? cur : l[0]?.id ?? '')); } }, () => undefined);
    return () => { live = false; };
  }, [model]);
  const opt = cars.find((c) => c.id === model);
  const tiles = useMemo<Tile[]>(() => cars.map((c) => ({
    id: c.id, name: c.name, sub: c.brand, image: carImage(c.id),
    facets: { creador: some(c.author), marca: some(c.brand), pais: some(c.country), traccion: some(c.drive), clase: some(c.cls), etiqueta: c.tags },
  })), [cars]);
  const skinTiles = useMemo<Tile[]>(() => skins.map((k) => ({ id: k.id, name: k.name, sub: null, image: skinUrl(model, k.id) })), [skins, model]);
  const over = withCount && free != null && count > free;
  const big = skin ? skinUrl(model, skin) : carImage(model);
  return (
    <Shell title={title} onCancel={onCancel} okLabel={skinOnly ? t('Aceptar') : withCount ? t('Añadir') : t('Aceptar')} okDisabled={!model}
      onOk={() => onOk(model, skin, count, skins)} list={skinOnly ? skinTiles : tiles} selected={skinOnly ? skin : model}
      onSelect={(id) => { if (skinOnly) setSkin(id); else { setModel(id); setSkin(''); } }}
      searchLabel={skinOnly ? t('Buscar skin…') : t('Buscar coche…')} facets={skinOnly ? [] : CAR_FACETS}
      footer={withCount && (
        <>
          <label className="mini inline">{t('Plazas')}<input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
          {over ? <span className="warn">{t('Solo caben {n} más en los boxes del circuito.', { n: Math.max(0, free!) })}</span>
            : free != null && <span className="muted">{t('Quedan {n} plazas de boxes.', { n: free })}</span>}
        </>
      )}
      left={(f) => (
        <>
          <h3 className="cm-title">{opt?.name ?? model}</h3>
          {!skinOnly && skins.length > 0 && (
            <div className="cm-skins" role="listbox" aria-label={t('Skins')}>
              {skins.map((k) => (
                <button key={k.id} type="button" role="option" aria-selected={k.id === skin} className={`cm-skin ${k.id === skin ? 'on' : ''}`} onClick={() => setSkin(k.id)} title={k.name}>
                  <img src={skinUrl(model, k.id)} alt={k.name} loading="lazy" width={44} height={28} />
                </button>
              ))}
            </div>
          )}
          <div className="cm-big"><img src={big} alt="" /></div>
          <p className="cm-sub">{[skins.find((k) => k.id === skin)?.name, card?.subtitle].filter(Boolean).join(' · ')}</p>
          {skins.length === 0 && <p className="hint">{t('Este coche no tiene skins instaladas en este PC.')}</p>}
          {!skinOnly && opt && <Chips f={f} chips={[
            { key: 'creador', label: t('Creador'), value: opt.author }, { key: 'marca', label: t('Marca'), value: opt.brand }, { key: 'pais', label: t('País'), value: opt.country }, { key: 'traccion', label: t('Tracción'), value: opt.drive },
            { key: 'clase', label: t('Clase'), value: opt.cls }, ...opt.tags.map((v) => ({ key: 'etiqueta', label: t('Etiqueta'), value: v })),
          ]} />}
          <Specs specs={card?.specs} />
        </>
      )} />
  );
}

/** Nombre común de los recorridos de un circuito (lo que va antes del último « - »), o el del primero. */
function baseName(names: string[]): string {
  const heads = names.map((n) => n.split(' - ')[0]!.trim());
  return heads.every((h) => h === heads[0]) && heads[0] ? heads[0] : names[0]!;
}

/** Elegir circuito (y layout) entre los instalados, con su vista previa, su ficha y filtros; avisa si no caben los coches en los boxes. */
export function TrackDialog({ tracks, track: initialTrack, layout: initialLayout, cars, onOk, onCancel }: {
  tracks: InstalledContentDto['tracks']; track: string; layout: string; cars: number; onOk: (track: string, layout: string) => void; onCancel: () => void;
}) {
  type TrackOpt = InstalledContentDto['tracks'][number];
  /** Un circuito = una tarjeta (como un coche); sus recorridos (layouts) se eligen como las skins de un coche. */
  const groups = useMemo(() => {
    const m = new Map<string, TrackOpt[]>();
    for (const x of tracks) m.set(x.track, [...(m.get(x.track) ?? []), x]);
    return m;
  }, [tracks]);
  const firstTrack = tracks[0]?.track ?? '';
  const [sel, setSel] = useState(groups.has(initialTrack) ? initialTrack : firstTrack);
  const [layout, setLayout] = useState(initialLayout);
  const layouts = groups.get(sel) ?? [];
  const cur = layouts.find((x) => x.layout === layout) ?? layouts[0];
  const card = useContentCard('track', cur?.track, cur?.layout ?? '');
  const tiles = useMemo<Tile[]>(() => [...groups.values()].map((l) => {
    const x = l[0]!;
    const n = l.length;
    const uniq = <T,>(f: (o: TrackOpt) => T | null | undefined) => [...new Set(l.map(f).filter((v): v is T => !!v))];
    return {
      id: x.track, name: n > 1 ? baseName(l.map((o) => o.name)) : x.name, sub: n > 1 ? t('{n} recorridos', { n }) : x.country, image: trackImage(x.track, x.layout),
      kms: l.map((o) => o.lengthKm).filter((v): v is number => v != null),
      facets: { creador: uniq((o) => o.author) as string[], pais: uniq((o) => o.country) as string[], ciudad: uniq((o) => o.city) as string[], etiqueta: [...new Set(l.flatMap((o) => o.tags))] },
    };
  }), [groups]);
  const boxes = cur?.pitboxes ?? NaN;
  const over = Number.isFinite(boxes) && cars > boxes;
  return (
    <Shell title={t('Elegir circuito')} onCancel={onCancel} okLabel={t('Aceptar')} okDisabled={!cur} onOk={() => cur && onOk(cur.track, cur.layout)}
      list={tiles} selected={sel} onSelect={(id) => { setSel(id); setLayout(''); }} searchLabel={t('Buscar circuito…')} facets={TRACK_FACETS}
      footer={Number.isFinite(boxes) && (over
        ? <span className="warn">{t('Tienes {n} coches y este circuito tiene {m} plazas de boxes.', { n: cars, m: boxes })}</span>
        : <span className="muted">{t('{n} coches · {m} plazas de boxes', { n: cars, m: boxes })}</span>)}
      left={(f) => cur ? (
        <>
          <h3 className="cm-title">{cur.name}</h3>
          {layouts.length > 1 && (
            <div className="cm-skins" role="listbox" aria-label={t('Recorridos')}>
              {layouts.map((k) => (
                <button key={k.layout} type="button" role="option" aria-selected={k.layout === cur.layout} className={`cm-skin ${k.layout === cur.layout ? 'on' : ''}`} onClick={() => setLayout(k.layout)} title={k.name}>
                  <img src={trackOutline(k.track, k.layout)} alt={k.name} loading="lazy" width={44} height={28} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = trackImage(k.track, k.layout); }} />
                </button>
              ))}
            </div>
          )}
          <div className="cm-big"><img src={trackImage(cur.track, cur.layout)} alt="" /><img className="cm-outline" src={trackOutline(cur.track, cur.layout)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></div>
          <p className="cm-sub">{card?.subtitle ?? cur.country ?? ''}</p>
          <Chips f={f} chips={[
            { key: 'creador', label: t('Creador'), value: cur.author }, { key: 'pais', label: t('País'), value: cur.country }, { key: 'ciudad', label: t('Ciudad'), value: cur.city },
            ...cur.tags.map((v) => ({ key: 'etiqueta', label: t('Etiqueta'), value: v })),
          ]} />
          <Specs specs={card?.specs} />
        </>
      ) : <p className="hint">{t('No hay circuitos instalados en este PC.')}</p>} />
  );
}
