import { useEffect, useState } from 'react';
import type { ChampionshipDto, ChampionshipSummaryDto, ScheduledEventInput } from '@howler/shared';
import { t } from '../i18n';
import { adminApi, type SessionPresetsDto } from './adminApi';
import { EventSetupFields, useInstalled } from './ScheduleSetup';
import { Card, Field, Notice, useNotice } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DDTHH:mm` en hora local. */
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const plusMinutes = (at: string, min: number) => local(new Date(new Date(at).getTime() + min * 60_000));

type Presets = SessionPresetsDto['presets'];

const base = (name: string, at: string, p: Partial<ScheduledEventInput>): ScheduledEventInput => ({
  name, enabled: true, presetId: null, when: { kind: 'once', at }, stopAfterMinutes: null, announceMinutes: [10], track: null, entries: [], discord: true, ...p,
});

/** Crea varios eventos seguidos y cuenta cuántos salieron bien (los que ya han pasado no se crean: el servidor los rechaza). */
async function createAll(events: ScheduledEventInput[]): Promise<{ made: number; failed: string[] }> {
  let made = 0;
  const failed: string[] = [];
  for (const e of events) {
    try { await adminApi.addSchedule(e); made++; } catch (err) { failed.push(`${e.name}: ${(err as Error).message}`); }
  }
  return { made, failed };
}

const STAGES = [
  { key: 'practice', label: () => t('Práctica'), offset: 0, stop: 30 },
  { key: 'quali', label: () => t('Clasificación'), offset: 40, stop: 20 },
  { key: 'race', label: () => t('Carrera'), offset: 70, stop: 60 },
] as const;

/** Un fin de semana de carrera: práctica, clasificación y carrera como tres eventos seguidos, cada uno con su preset. */
export function WeekendCard({ presets, onDone }: { presets: Presets; onDone: () => void }) {
  const installed = useInstalled();
  const { notice, run } = useNotice();
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(21, 0, 0, 0); return local(d); });
  const [setup, setSetup] = useState<Pick<ScheduledEventInput, 'track' | 'entries'>>({ track: null, entries: [] });
  const [stages, setStages] = useState<{ on: boolean; presetId: string; offset: number; stop: number }[]>(STAGES.map((s) => ({ on: true, presetId: '', offset: s.offset, stop: s.stop })));
  const setStage = (i: number, p: Partial<(typeof stages)[number]>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const create = () => run(async () => {
    const events = STAGES.flatMap((s, i) => {
      const st = stages[i]!;
      return st.on ? [base(`${name.trim()} · ${s.label()}`, plusMinutes(start, st.offset), { presetId: st.presetId || null, stopAfterMinutes: st.stop || null, track: setup.track, entries: setup.entries })] : [];
    });
    const r = await createAll(events);
    onDone();
    if (r.failed.length) throw new Error(r.failed.join(' · '));
    return { ok: true, reply: t('{n} eventos creados', { n: r.made }) };
  }, t('Fin de semana creado'));

  return (
    <Card title={t('Fin de semana de carrera')}>
      <p className="hint">{t('Crea de una vez la práctica, la clasificación y la carrera como eventos seguidos. Cada uno puede tener su preset (por ejemplo, otra duración o sin combustible en la clasificación).')}</p>
      <Field label={t('Nombre')}><input type="text" value={name} maxLength={40} placeholder={t('Liga · Jornada 3')} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('Empieza la práctica')} hint={t('Hora del PC donde corre Howler.')}><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <EventSetupFields v={setup} onChange={setSetup} installed={installed} />
      <div className="table-scroll">
        <table className="timing sched">
          <thead><tr><th>{t('Sesión')}</th><th>{t('Preset')}</th><th>{t('Minutos tras el inicio')}</th><th>{t('Parar a los (min)')}</th></tr></thead>
          <tbody>
            {STAGES.map((s, i) => (
              <tr key={s.key}>
                <td><label className="inline"><input type="checkbox" checked={stages[i]!.on} onChange={(e) => setStage(i, { on: e.target.checked })} /> {s.label()}</label></td>
                <td>
                  <select value={stages[i]!.presetId} aria-label={t('Preset')} disabled={!stages[i]!.on} onChange={(e) => setStage(i, { presetId: e.target.value })}>
                    <option value="">{t('Sin cambiar ajustes')}</option>
                    {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td><input type="number" min={0} max={1440} value={stages[i]!.offset} aria-label={t('Minutos tras el inicio')} disabled={!stages[i]!.on} onChange={(e) => setStage(i, { offset: Number(e.target.value) || 0 })} /></td>
                <td><input type="number" min={0} max={1440} step={5} value={stages[i]!.stop} aria-label={t('Parar a los (min)')} disabled={!stages[i]!.on} onChange={(e) => setStage(i, { stop: Number(e.target.value) || 0 })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice notice={notice} />
      <p><button type="button" className="btn primary" disabled={name.trim() === '' || !stages.some((s) => s.on)} onClick={create}>{t('Crear eventos')}</button></p>
    </Card>
  );
}

/** Eventos para una carrera de un campeonato: circuito, coches permitidos y las fechas de práctica, clasificación y carrera que ya tiene. */
export function ChampionshipCard({ presets, onDone }: { presets: Presets; onDone: () => void }) {
  const { notice, run } = useNotice();
  const [list, setList] = useState<ChampionshipSummaryDto[]>([]);
  const [champ, setChamp] = useState<ChampionshipDto | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const [presetId, setPresetId] = useState('');
  const [slotsPerCar, setSlotsPerCar] = useState(8);

  useEffect(() => { adminApi.championships().then((l) => setList(l.filter((c) => c.status !== 'finished' && !c.sharedFrom)), () => undefined); }, []);
  const pick = (id: number) => {
    setChamp(null); setRound(null);
    if (id) adminApi.championship(id).then((c) => { setChamp(c); setRound(c.roundList.find((r) => !r.played)?.id ?? c.roundList[0]?.id ?? null); }, () => undefined);
  };
  const r = champ?.roundList.find((x) => x.id === round) ?? null;
  const dates = r ? ([['practice', t('Práctica'), r.practiceAt], ['quali', t('Clasificación'), r.qualiAt], ['race', t('Carrera'), r.raceAt]] as const).filter((d) => d[2]) : [];

  const create = () => run(async () => {
    if (!champ || !r) throw new Error(t('Elige una carrera.'));
    const events = dates.map(([k, label, at]) => base(`${champ.name} · ${t('Carrera {n}', { n: r.number })} · ${label}`, local(new Date(at!)), {
      presetId: presetId || null, track: { track: r.track, layout: r.layout }, entries: r.cars.map((car) => ({ car, count: slotsPerCar })),
      stopAfterMinutes: k === 'race' ? 90 : k === 'quali' ? 30 : 45,
    }));
    const res = await createAll(events);
    onDone();
    if (res.failed.length) throw new Error(res.failed.join(' · '));
    return { ok: true, reply: t('{n} eventos creados', { n: res.made }) };
  }, t('Eventos creados desde el campeonato'));

  return (
    <Card title={t('Desde un campeonato')}>
      <p className="hint">{t('Prepara el servidor para una carrera del calendario: pone su circuito y sus coches y programa la práctica, la clasificación y la carrera con las fechas que ya tienes en el campeonato. Las fechas que ya han pasado no se programan.')}</p>
      {list.length === 0 ? <p className="empty">{t('No hay campeonatos activos ni en borrador.')}</p> : (
        <>
          <Field label={t('Campeonato')}>
            <select defaultValue="" onChange={(e) => pick(Number(e.target.value))}>
              <option value="">{t('Elige uno…')}</option>
              {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {champ && (
            <>
              <Field label={t('Carrera')}>
                <select value={round ?? ''} onChange={(e) => setRound(Number(e.target.value))}>
                  {champ.roundList.map((x) => <option key={x.id} value={x.id}>{t('Carrera {n}', { n: x.number })} · {x.track}</option>)}
                </select>
              </Field>
              <Field label={t('Preset de sesión')} hint={t('El mismo para las tres sesiones; si quieres uno distinto en cada una, edítalas después.')}>
                <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  <option value="">{t('Sin cambiar ajustes')}</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              {r && r.cars.length > 0 && (
                <Field label={t('Plazas por coche')}><input type="number" min={1} max={50} value={slotsPerCar} onChange={(e) => setSlotsPerCar(Math.max(1, Number(e.target.value) || 1))} /></Field>
              )}
              {dates.length === 0 ? <p className="hint">{t('Esta carrera no tiene fechas. Añádelas en Competición → Campeonatos.')}</p> : (
                <ul className="hint">{dates.map(([k, label, at]) => <li key={k}>{label}: {new Date(at!).toLocaleString()}</li>)}</ul>
              )}
            </>
          )}
          <Notice notice={notice} />
          <p><button type="button" className="btn primary" disabled={!champ || !r || dates.length === 0} onClick={create}>{t('Crear eventos')}</button></p>
        </>
      )}
    </Card>
  );
}
