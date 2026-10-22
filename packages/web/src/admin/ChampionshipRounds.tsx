import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import type { InstalledContentDto } from '@howler/shared';
import { FilterPanel } from '../components/FilterPanel';
import { pretty } from '../format';
import { api, useLive } from '../api';
import { adminApi } from './adminApi';
import { RoundSchedule, WeatherPick } from './RoundSchedule';
import { emptyMod, emptyRound, missingPitboxes, type Draft, type DraftMod, type DraftRound } from './championship-form';
import { Notice, useNotice } from './ui';

const KINDS: [DraftMod['kind'], string][] = [['car', t('Coche')], ['track', t('Circuito')], ['skins', 'Skins'], ['weather', t('Clima')], ['other', t('Otro')]];

/** Un mod: enlace de descarga + ficha. «Leer ficha» intenta rellenar nombre, imagen y datos desde la web del mod. */
export function ModEditor({ mod, onChange, onRemove }: { mod: DraftMod; onChange: (m: DraftMod) => void; onRemove: () => void }) {
  const { notice, run } = useNotice();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const read = () => run(async () => {
    setBusy(true);
    try {
      const i = await adminApi.modInfo(mod.url.trim());
      const found = Object.keys(i.specs).length;
      onChange({ ...mod, name: mod.name || i.title || '', kind: mod.kind === 'other' && i.kind !== 'other' ? i.kind : mod.kind, imageUrl: mod.imageUrl || i.imageUrl || '', note: mod.note || i.description || '', specs: { ...i.specs, ...mod.specs } });
      return { ok: true, reply: found ? t('{n} datos leídos', { n: found }) : t('título e imagen leídos; esta web no trae datos técnicos, añádelos a mano si quieres') };
    } finally { setBusy(false); }
  }, t('Ficha leída'));
  return (
    <div className="mod-edit">
      <div className="row">
        <input type="text" className="wide" placeholder={t('Enlace de descarga (https://…)')} aria-label={t('Enlace de descarga del mod')} value={mod.url} onChange={(e) => onChange({ ...mod, url: e.target.value })} />
        <button type="button" className="btn small" disabled={busy || !/^https?:\/\//i.test(mod.url.trim())} onClick={read} title={t('Lee la página del mod para rellenar su nombre, imagen y datos')}>{busy ? t('Leyendo…') : t('Leer ficha de la web')}</button>
        <button type="button" className="btn small" onClick={onRemove}>{t('Quitar')}</button>
      </div>
      <div className="row">
        <input type="text" placeholder={t('Nombre del mod')} aria-label={t('Nombre del mod')} maxLength={120} value={mod.name} onChange={(e) => onChange({ ...mod, name: e.target.value })} />
        <select aria-label={t('Tipo de mod')} value={mod.kind} onChange={(e) => onChange({ ...mod, kind: e.target.value as DraftMod['kind'] })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="text" className="wide" placeholder={t('Imagen (enlace, opcional)')} aria-label={t('Imagen del mod')} value={mod.imageUrl} onChange={(e) => onChange({ ...mod, imageUrl: e.target.value })} />
      </div>
      {(mod.kind === 'car' || mod.kind === 'track') && (
        <div className="row spec-row">
          {Object.entries(mod.specs).map(([k, v]) => (
            <span className="chip" key={k}>{k}: {v} <button type="button" aria-label={t('Quitar {name}', { name: k })} onClick={() => { const { [k]: _, ...rest } = mod.specs; onChange({ ...mod, specs: rest }); }}>×</button></span>
          ))}
          <input type="text" placeholder={t('Dato (p. ej. Potencia)')} aria-label={t('Nombre del dato')} value={key} onChange={(e) => setKey(e.target.value)} maxLength={40} />
          <input type="text" placeholder={t('Valor (p. ej. 450 CV)')} aria-label={t('Valor del dato')} value={val} onChange={(e) => setVal(e.target.value)} maxLength={80} />
          <button type="button" className="btn small" disabled={!key.trim() || !val.trim()} onClick={() => { onChange({ ...mod, specs: { ...mod.specs, [key.trim()]: val.trim() } }); setKey(''); setVal(''); }}>{t('Añadir dato')}</button>
        </div>
      )}
      <Notice notice={notice} />
    </div>
  );
}

function ModList({ mods, onChange }: { mods: DraftMod[]; onChange: (m: DraftMod[]) => void }) {
  return (
    <div className="mod-list">
      {mods.map((m, i) => <ModEditor key={i} mod={m} onChange={(x) => onChange(mods.map((y, j) => (j === i ? x : y)))} onRemove={() => onChange(mods.filter((_, j) => j !== i))} />)}
      <button type="button" className="btn small" onClick={() => onChange([...mods, emptyMod()])}>{t('+ Añadir mod con enlace de descarga')}</button>
    </div>
  );
}

/** Paso 3: las carreras con su calendario, coches permitidos y mods, y los mods de todo el campeonato. */
export function ChampionshipRounds({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const { data: tracks } = useLive(api.tracks, [], (e) => e.type === 'lap');
  const { data: cars } = useLive(api.cars, [], (e) => e.type === 'lap');
  // Lo instalado en AC (se puede elegir un circuito que aún no se ha corrido); si no se encuentra AC, lo ya jugado
  const [installed, setInstalled] = useState<InstalledContentDto | null>(null);
  useEffect(() => { adminApi.installedContent().then(setInstalled).catch(() => setInstalled({ cars: [], tracks: [] })); }, []);
  const pickList = useMemo(() => {
    const trackNames = new Map<string, string>(), carNames = new Map<string, string>();
    for (const t of installed?.tracks ?? []) trackNames.set(`${t.track}|${t.layout}`, t.name);
    for (const c of installed?.cars ?? []) carNames.set(c.id, c.name);
    const trackKeys = installed?.tracks.length ? installed.tracks.map((t) => `${t.track}|${t.layout}`) : (tracks ?? []).map((t) => `${t.track}|${t.layout}`);
    const carIds = installed?.cars.length ? installed.cars.map((c) => c.id) : (cars ?? []).map((c) => c.car);
    return { trackKeys, carIds, names: { track: (t: string, l: string) => trackNames.get(`${t}|${l}`) ?? `${pretty(t)}${l ? ` (${pretty(l)})` : ''}`, car: (id: string) => carNames.get(id) ?? pretty(id) } };
  }, [installed, tracks, cars]);
  const patch = (i: number, p: Partial<DraftRound>) => set({ ...draft, rounds: draft.rounds.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.rounds.length) return;
    const rounds = [...draft.rounds];
    [rounds[i], rounds[j]] = [rounds[j]!, rounds[i]!];
    set({ ...draft, rounds });
  };
  return (
    <div className="wiz-rounds">
      <datalist id="dl-tracks">{[...new Set((tracks ?? []).map((t) => t.track))].map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="dl-cars">{(cars ?? []).map((c) => <option key={c.car} value={c.car} />)}</datalist>
      {draft.rounds.map((r, i) => (
        <section className="round-edit" key={r.id ?? `n${i}`}>
          <div className="row between">
            <h4>{t('Carrera {n}', { n: i + 1 })}</h4>
            <span className="row">
              <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Subir carrera')}>↑</button>
              <button type="button" className="btn small" disabled={i === draft.rounds.length - 1} onClick={() => move(i, 1)} aria-label={t('Bajar carrera')}>↓</button>
              <button type="button" className="btn small" onClick={() => set({ ...draft, rounds: draft.rounds.filter((_, j) => j !== i) })}>{t('Quitar')}</button>
            </span>
          </div>
          <FilterPanel variant="pick" names={pickList.names} track={r.track ? `${r.track}|${r.layout}` : ''} cars={r.cars}
            tracks={pickList.trackKeys} carOptions={pickList.carIds}
            onTrack={(k) => { const i2 = k.indexOf('|'); patch(i, k ? { track: k.slice(0, i2), layout: k.slice(i2 + 1) } : { track: '', layout: '' }); }}
            onCars={(ids) => patch(i, { cars: ids })} onClear={() => patch(i, { track: '', layout: '', cars: [] })} />
          {(() => { const px = installed?.tracks.find((x) => x.track === r.track && x.layout === r.layout)?.pitboxes; const miss = missingPitboxes(draft.entries.length, px); return miss > 0 ? <p className="warn" role="status">{t('Este circuito tiene {boxes} plazas y hay {n} inscritos: faltan {miss}.', { boxes: px ?? 0, n: draft.entries.length, miss })}</p> : null; })()}
          <details className="round-manual">
            <summary>{t('Escribir circuito y coches a mano (mods que no están instalados aquí)')}</summary>
          <div className="row">
            <label className="mini">{t('Circuito')}<input type="text" list="dl-tracks" placeholder={t('p. ej. monza')} value={r.track} onChange={(e) => patch(i, { track: e.target.value })} /></label>
            <label className="mini">Layout<input type="text" placeholder={t('vacío = el único')} value={r.layout} onChange={(e) => patch(i, { layout: e.target.value })} /></label>
            <label className="mini grow">{t('Coches permitidos')}<input type="text" list="dl-cars" className="wide" placeholder={t('vacío = cualquiera; varios separados por coma')} value={r.cars.join(', ')}
              onChange={(e) => patch(i, { cars: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
          </div>
          </details>
          <WeatherPick value={r.weather} onChange={(weather) => patch(i, { weather })} />
          <RoundSchedule sessions={r.schedule} onChange={(schedule) => patch(i, { schedule })} />
          <details>
            <summary>{t('Mods de esta carrera ({n})', { n: r.mods.length })}</summary>
            <ModList mods={r.mods} onChange={(mods) => patch(i, { mods })} />
          </details>
        </section>
      ))}
      <button type="button" className="btn" onClick={() => set({ ...draft, rounds: [...draft.rounds, { ...emptyRound(), track: draft.rounds.at(-1)?.track ?? '', layout: draft.rounds.at(-1)?.layout ?? '', cars: draft.rounds.at(-1)?.cars ?? [] }] })}>{t('+ Añadir carrera')}</button>
      <section className="round-edit">
        <h4>{t('Mods de todo el campeonato')}</h4>
        <p className="hint">{t('Coche, circuitos, skins o clima. Cada mod sale como un botón de descarga para que la gente practique; si es coche o circuito, también como tarjeta.')}</p>
        <ModList mods={draft.mods} onChange={(mods) => set({ ...draft, mods })} />
      </section>
    </div>
  );
}
