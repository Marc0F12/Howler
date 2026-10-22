import { useEffect, useMemo, useState } from 'react';
import type { ChampionshipDto, EntryListDto, EntrySlotDto, InstalledContentDto } from '@howler/shared';
import { carImage, trackImage, useContentNames } from '../content';
import { t, tm } from '../i18n';
import { adminApi, type SetupsDto } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';
import { SetupPicker } from './SetupPicker';
import { CarDialog, TrackDialog, skinUrl } from './EntryPickers';

type Skins = Record<string, { id: string; name: string }[]>;
const blank = (model: string, skin = ''): EntrySlotDto => ({ model, skin, driverName: '', team: '', guid: '', ballast: 0, restrictor: 0, fixedSetup: '', spectator: false, extras: [] });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lista de coches del servidor (la «Entry list» de Content Manager): un hueco por plaza con su coche, skin, piloto reservado,
 * equipo, Steam ID, lastre y restrictor. Se guarda en el `entry_list.ini` del preset (con copia) y mantiene coherentes
 * `CARS` y `MAX_CLIENTS`. Se aplica al arrancar el servidor.
 */
export function EntryListCard({ running }: { running: boolean }) {
  const { notice, run } = useNotice();
  const { trackName } = useContentNames();
  const [saved, setSaved] = useState<EntryListDto | null>(null);
  const [slots, setSlots] = useState<EntrySlotDto[]>([]);
  const [installed, setInstalled] = useState<InstalledContentDto | null>(null);
  const [skins, setSkins] = useState<Skins>({});
  const [open, setOpen] = useState<number | null>(null);
  const [setups, setSetups] = useState<SetupsDto | null>(null);
  const loadSetups = () => { adminApi.setups().then(setSetups, () => setSetups(null)); };
  useEffect(loadSetups, []);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [carFor, setCarFor] = useState<number | null>(null);
  const [skinFor, setSkinFor] = useState<number | null>(null);
  const [champs, setChamps] = useState<ChampionshipDto[]>([]);
  const [champId, setChampId] = useState<number | null>(null);

  const load = () => adminApi.entryList().then((d) => { setSaved(d); setSlots(d.slots); }, () => setSaved(null));
  useEffect(() => {
    void load();
    void adminApi.installedContent().then(setInstalled, () => undefined);
    // Campeonatos sin terminar: sus equipos y pilotos se pueden asignar a las plazas.
    void adminApi.championships().then(async (list) => {
      const live = list.filter((c) => c.status !== 'finished' && !c.sharedFrom);
      const full = await Promise.all(live.map((c) => adminApi.championship(c.id).catch(() => null)));
      const ok = full.filter((c): c is ChampionshipDto => c != null && (c.teams.length > 0 || c.entries.length > 0));
      setChamps(ok);
      setChampId((cur) => cur ?? ok.find((c) => c.status === 'active')?.id ?? ok[0]?.id ?? null);
    }, () => undefined);
  }, []);

  const models = useMemo(() => [...new Set(slots.map((s) => s.model))], [slots]);
  useEffect(() => {
    for (const m of models) {
      if (skins[m]) continue;
      setSkins((s) => ({ ...s, [m]: [] })); // marcado como pedido para no repetir
      void adminApi.carSkins(m).then((list) => setSkins((s) => ({ ...s, [m]: list })), () => undefined);
    }
  }, [models.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!saved) return null;
  const carList = installed?.cars ?? [];
  const names = new Map(carList.map((c) => [c.id, c.name]));
  const nameOf = (m: string) => names.get(m) ?? m;
  const dirty = !same(slots, saved.slots);
  const patch = (i: number, p: Partial<EntrySlotDto>) => setSlots((l) => l.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, by: -1 | 1) => setSlots((l) => { const n = [...l]; const j = i + by; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const guids = slots.flatMap((s) => s.guid.split(';').filter(Boolean));
  const dupGuid = new Set(guids.filter((g, i) => guids.indexOf(g) !== i));
  const champ = champs.find((c) => c.id === champId) ?? null;
  const teamOf = (c: ChampionshipDto, driverId: number) => c.teams.find((tm0) => tm0.id === c.entries.find((e) => e.driverId === driverId)?.teamId) ?? null;

  // Plazas de boxes: AC dice cuántas tiene el circuito (si lo trae); los espectadores no ocupan.
  const cars = slots.filter((s) => !s.spectator).length;
  const pits = saved.pitboxes;
  const over = pits != null && cars > pits;
  const track = saved.track ? (installed?.tracks.find((x) => x.track === saved.track && x.layout === saved.layout)?.name ?? trackName(saved.track, saved.layout)) : '';

  /** Añade `count` plazas del coche; la primera con la skin elegida y las demás con las siguientes de la lista. */
  const add = (model: string, skin: string, count: number, list: { id: string }[]) => {
    const start = Math.max(0, list.findIndex((k) => k.id === skin));
    const extra = Array.from({ length: Math.max(1, Math.min(count, 100)) }, (_, k) => blank(model, list.length ? list[(start + k) % list.length]!.id : ''));
    setSlots((l) => [...l, ...extra]);
  };
  const saveTrack = (track: string, layout: string) => run(async () => {
    const r = await adminApi.saveServerTrack(track, layout);
    setSaved((cur) => (cur ? { ...cur, track: r.track, layout: r.layout, pitboxes: r.pitboxes } : cur));
    setTrackOpen(false);
  }, t('Circuito guardado. Se aplicará al arrancar el servidor.'));
  /** Reparte skins distintas entre los huecos de cada coche (como «random skins» de CM, pero sin repetir mientras haya). */
  const spreadSkins = () => setSlots((l) => {
    const seen: Record<string, number> = {};
    return l.map((s) => { const list = skins[s.model] ?? []; if (!list.length) return s; const k = seen[s.model] ?? 0; seen[s.model] = k + 1; return { ...s, skin: list[k % list.length]!.id }; });
  });
  /** Asigna la plaza a un equipo del campeonato; si el piloto actual no es de ese equipo, se libera. */
  const setTeam = (i: number, name: string) => {
    const s = slots[i]!;
    const drv = s.driverId != null && champ ? teamOf(champ, s.driverId) : null;
    patch(i, { team: name, ...(drv && drv.name !== name ? { driverId: null, driverName: '', guid: '' } : {}) });
  };
  const setDriver = (i: number, driverId: number | null) => {
    if (driverId == null) { patch(i, { driverId: null, driverName: '', guid: '' }); return; }
    const e = champ?.entries.find((x) => x.driverId === driverId);
    const tm1 = champ ? teamOf(champ, driverId) : null;
    patch(i, { driverId, driverName: e?.name ?? '', guid: '', ...(tm1 ? { team: tm1.name } : {}) });
  };

  const save = (restart: boolean) => run(async () => {
    setProblem(null);
    try {
      const r = await adminApi.saveEntryList(slots, restart);
      setSaved(r); setSlots(r.slots);
    } catch (e) { setProblem(tm(e instanceof Error ? e.message : String(e))); throw e; }
  }, restart ? t('Guardado. Reiniciando el servidor…') : t('Guardado. Se aplicará al arrancar el servidor.'));

  return (
    <Card title={t('Coches del servidor')} aside={<span className={`pill ${dirty ? '' : 'ok'}`}>{dirty ? t('Cambios sin guardar') : t('{n} plazas', { n: slots.length })}</span>}>
      <p className="hint">{t('Es la lista de coches de Content Manager: cada fila es una plaza. Se guarda en el preset del servidor (con copia de seguridad) y se aplica al arrancar. Si lo cambias aquí, no hace falta guardar también en Content Manager; si luego guardas desde Content Manager, mandará lo que él tenga.')}</p>

      <div className={`el-track ${over ? 'over' : ''}`} role={over ? 'alert' : undefined}>
        {saved.track && <img src={trackImage(saved.track, saved.layout)} alt="" width={120} height={68} loading="lazy" />}
        <div className="el-track-info">
          <span className="muted">{t('Circuito')}</span>
          <b>{track || t('Sin circuito en el preset')}</b>
          <span className="muted">{pits != null ? t('{n} plazas de boxes', { n: pits }) : t('AC no dice cuántas plazas de boxes tiene')}</span>
        </div>
        <b className="num el-track-count" title={t('Coches / plazas de boxes')}>{pits != null ? `${cars}/${pits}` : cars}</b>
        <button type="button" className="btn small" disabled={!installed || installed.tracks.length === 0} onClick={() => setTrackOpen(true)}>{t('Cambiar circuito')}</button>
        {over && <span className="warn">{t('Hay {n} coches de más que no caben en los boxes: los sobrantes no tendrán sitio.', { n: cars - pits! })}</span>}
        {over && <button type="button" className="btn small" onClick={() => { let n = 0; setSlots((l) => l.filter((s) => s.spectator || ++n <= pits!)); }}>{t('Quitar los sobrantes')}</button>}
      </div>

      {champs.length > 0 && (
        <p className="el-champ">
          <span className="muted">{t('Asignar a un campeonato:')}</span>{' '}
          <select value={champId ?? ''} onChange={(e) => setChampId(Number(e.target.value))} aria-label={t('Campeonato')}>
            {champs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="muted"> {t('Elige el equipo o el piloto de cada plaza para que cada uno corra con su skin.')}</span>
        </p>
      )}

      <div className="el-add">
        <button type="button" className="btn small primary" onClick={() => setAdding(true)}>{t('+ Añadir coches')}</button>
        <button type="button" className="btn small" onClick={spreadSkins} title={t('Da una skin distinta a cada plaza del mismo coche')}>{t('Repartir skins distintas')}</button>
      </div>

      <ol className="el-list">
        {slots.map((s, i) => {
          const list = skins[s.model] ?? [];
          const unknown = installed != null && !names.has(s.model);
          const skinName = list.find((k) => k.id === s.skin)?.name ?? s.skin;
          const roster = champ?.entries.filter((e) => !s.team || teamOf(champ, e.driverId)?.name === s.team || !teamOf(champ, e.driverId)) ?? [];
          return (
            <li key={i} className={`el-row ${open === i ? 'open' : ''}`}>
              <div className="el-main">
                <span className="el-num">{i + 1}</span>
                <button type="button" className="el-skin" onClick={() => setSkinFor(i)} title={t('Cambiar la skin')} aria-label={t('Cambiar la skin')}>
                  <img className="el-thumb" src={s.skin ? skinUrl(s.model, s.skin) : carImage(s.model)} alt="" loading="lazy" width={96} height={54} />
                  <small>{skinName || '—'}</small>
                </button>
                <button type="button" className="el-carbtn" onClick={() => setCarFor(i)} title={t('Cambiar de coche')}>
                  <b>{nameOf(s.model)}</b>
                  {unknown && <span className="muted">{t('no está instalado en este PC')}</span>}
                </button>
                <label className="mini">{t('Equipo')}
                  {champ && champ.teams.length > 0 ? (
                    <select value={s.team} onChange={(e) => setTeam(i, e.target.value)}>
                      <option value="">{t('Sin equipo')}</option>
                      {s.team && !champ.teams.some((x) => x.name === s.team) && <option value={s.team}>{s.team}</option>}
                      {champ.teams.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
                    </select>
                  ) : <input type="text" value={s.team} maxLength={60} placeholder={t('Sin equipo')} onChange={(e) => setTeam(i, e.target.value)} />}
                </label>
                {champ ? (
                  <label className="mini">{t('Piloto')}
                    <select value={s.driverId ?? ''} onChange={(e) => setDriver(i, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">{s.driverName && s.driverId == null ? `${s.driverName} (${t('reservado a mano')})` : t('Cualquiera')}</option>
                      {roster.map((e) => <option key={e.driverId} value={e.driverId}>{e.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="mini">{t('Piloto reservado')}
                    <input type="text" value={s.driverName} placeholder={t('Cualquiera')} maxLength={60} onChange={(e) => patch(i, { driverName: e.target.value })} />
                  </label>
                )}
                <span className="el-actions">
                  <button type="button" className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Subir')}>↑</button>
                  <button type="button" className="btn small" disabled={i === slots.length - 1} onClick={() => move(i, 1)} aria-label={t('Bajar')}>↓</button>
                  <button type="button" className="btn small" onClick={() => setSlots((l) => [...l.slice(0, i + 1), { ...l[i]!, driverName: '', guid: '', driverId: null }, ...l.slice(i + 1)])} aria-label={t('Duplicar')} title={t('Duplicar plaza')}>⧉</button>
                  <button type="button" className="btn small" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} aria-label={t('Más opciones')} title={t('Steam ID, lastre, restrictor, setup fijo, espectador')}>⋯</button>
                  <button type="button" className="btn small danger" disabled={slots.length === 1} onClick={() => { setSlots((l) => l.filter((_, k) => k !== i)); setOpen(null); }} aria-label={t('Quitar')}>✕</button>
                </span>
              </div>
              {open === i && (
                <div className="el-more">
                  {champ && <label className="mini">{t('Piloto reservado (a mano)')}<input type="text" value={s.driverId == null ? s.driverName : ''} disabled={s.driverId != null} maxLength={60} onChange={(e) => patch(i, { driverName: e.target.value })} /></label>}
                  <label className="mini">{t('Steam ID (17 cifras)')}<input type="text" value={s.driverId != null ? '' : s.guid} disabled={s.driverId != null} placeholder={s.driverId != null ? t('Se toma del piloto elegido') : ''} className={s.guid && (dupGuid.has(s.guid) || !/^(\d{17}(;\d{17})*)?$/.test(s.guid)) ? 'bad' : ''} onChange={(e) => patch(i, { guid: e.target.value.trim() })} /></label>
                  <label className="mini">{t('Lastre (kg)')}<input type="number" min={0} max={500} value={s.ballast} onChange={(e) => patch(i, { ballast: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} /></label>
                  <label className="mini">{t('Restrictor (%)')}<input type="number" min={0} max={400} value={s.restrictor} onChange={(e) => patch(i, { restrictor: Math.max(0, Math.min(400, Math.floor(Number(e.target.value) || 0))) })} /></label>
                  <SetupPicker model={s.model} value={s.fixedSetup} setups={setups} onChange={(v) => patch(i, { fixedSetup: v })} onImported={loadSetups} />
                  <label className="check"><input type="checkbox" checked={s.spectator} onChange={(e) => patch(i, { spectator: e.target.checked })} /> {t('Plaza de espectador')}</label>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {dupGuid.size > 0 && <p className="warn">{t('Hay un Steam ID repetido en varias plazas.')}</p>}
      {problem && <p className="warn">{problem}</p>}
      {saved.maxClients != null && saved.maxClients < saved.slots.length && <p className="hint">{t('Ojo: en el servidor solo se permiten {n} jugadores a la vez, aunque haya más plazas.', { n: saved.maxClients })}</p>}

      <div className="actions">
        <button type="button" className="btn primary" disabled={!dirty} onClick={() => void save(false)}>{t('Guardar')}</button>
        {running && <ConfirmButton label={t('Guardar y reiniciar')} confirmLabel={t('¿Seguro? Se echa a los jugadores')} disabled={!dirty} onConfirm={() => save(true)} />}
        <button type="button" className="btn" disabled={!dirty} onClick={() => { setSlots(saved.slots); setProblem(null); }}>{t('Descartar cambios')}</button>
      </div>
      {running && <p className="hint">{t('El servidor está en marcha: los cambios se aplican al reiniciarlo.')}</p>}
      <Notice notice={notice} />

      {adding && <CarDialog title={t('Añadir coches')} cars={carList} withCount free={pits != null ? Math.max(0, pits - cars) : null}
        onOk={(m, skin, n, list) => { add(m, skin, n, list); setSkins((x) => ({ ...x, [m]: list })); setAdding(false); }} onCancel={() => setAdding(false)} />}
      {carFor != null && slots[carFor] && <CarDialog title={t('Cambiar de coche (plaza {n})', { n: carFor + 1 })} cars={carList} model={slots[carFor]!.model} skin={slots[carFor]!.skin}
        onOk={(m, skin) => { patch(carFor, { model: m, skin }); setCarFor(null); }} onCancel={() => setCarFor(null)} />}
      {skinFor != null && slots[skinFor] && <CarDialog title={t('Skin de {car}', { car: nameOf(slots[skinFor]!.model) })} cars={carList} model={slots[skinFor]!.model} skin={slots[skinFor]!.skin} skinOnly
        onOk={(_m, skin) => { patch(skinFor, { skin }); setSkinFor(null); }} onCancel={() => setSkinFor(null)} />}
      {trackOpen && installed && <TrackDialog tracks={installed.tracks} track={saved.track} layout={saved.layout} cars={cars} onOk={(tr, ly) => void saveTrack(tr, ly)} onCancel={() => setTrackOpen(false)} />}
    </Card>
  );
}
