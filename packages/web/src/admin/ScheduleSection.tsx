import { useEffect, useState } from 'react';
import type { ScheduledEventDto, ScheduledEventInput, ScheduleStateDto } from '@howler/shared';
import { MAX_SCHEDULE_NAME } from '@howler/shared';
import { locale, t } from '../i18n';
import { clock, formatDay } from '../format';
import { adminApi, type SessionPresetsDto } from './adminApi';
import { Card, ConfirmButton, Field, Notice, useNotice } from './ui';
import { ChampionshipCard, WeekendCard } from './ScheduleGenerators';
import { EventSetupFields, useInstalled } from './ScheduleSetup';

/** Lunes primero (como en España); 0 = domingo. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const dayName = (d: number) => new Date(2024, 0, 7 + d).toLocaleDateString(locale, { weekday: 'short' });
const ANNOUNCE_CHOICES = [60, 30, 15, 10, 5, 1];

const pad = (n: number) => String(n).padStart(2, '0');
/** Mañana a las 21:00, hora local: un punto de partida razonable para un evento nuevo. */
function tomorrowEvening(): string {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T21:00`;
}

const blank = (): ScheduledEventInput => ({
  name: '', enabled: true, presetId: null, when: { kind: 'weekly', days: [4], time: '21:00' }, stopAfterMinutes: null, announceMinutes: [10], track: null, entries: [], discord: true,
});

/** «dentro de 2 h 15 min», con la hora del PC de Howler como referencia. */
function inText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  const parts = [d > 0 ? t('{n} d', { n: d }) : '', h > 0 ? t('{n} h', { n: h }) : '', m > 0 || min === 0 ? t('{n} min', { n: m }) : ''].filter(Boolean);
  return t('dentro de {x}', { x: parts.slice(0, 2).join(' ') });
}

function whenText(w: ScheduledEventInput['when']): string {
  if (w.kind === 'once') {
    const [date, time] = w.at.split('T') as [string, string];
    const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
    return `${formatDay(new Date(y, mo - 1, d), { month: 'short', year: true, weekday: true })} · ${time}`;
  }
  const days = w.days.length === 7 ? t('Todos los días') : WEEK.filter((d) => w.days.includes(d)).map(dayName).join(', ');
  return `${days} · ${w.time}`;
}

/** Servidor → Programación: a una hora, aplicar un preset de sesión y arrancar (o reiniciar) el servidor. */
export function ScheduleSection() {
  const [state, setState] = useState<ScheduleStateDto | null>(null);
  const [presets, setPresets] = useState<SessionPresetsDto['presets']>([]);
  const [edit, setEdit] = useState<{ id: string | null; v: ScheduledEventInput } | null>(null);
  const { notice, run } = useNotice();

  const load = () => adminApi.schedule().then(setState, () => undefined);
  useEffect(() => {
    void load();
    adminApi.sessionPresets().then((r) => setPresets(r.presets), () => undefined);
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const apply = (action: () => Promise<ScheduleStateDto>, done: string) => run(async () => { setState(await action()); return { ok: true }; }, done);
  const nowMs = state ? new Date(state.now).getTime() : Date.now();

  const save = async () => {
    if (!edit) return;
    const ok = await apply(() => (edit.id ? adminApi.updateSchedule(edit.id, edit.v) : adminApi.addSchedule(edit.v)), t('Evento guardado'));
    if (ok) setEdit(null);
  };

  return (
    <>
      <Card title={t('Eventos programados')} aside={state && <span className="muted">{t('Hora del PC: {x}', { x: clock(state.now) })}</span>}>
        <p className="hint">
          {t('A la hora marcada, Howler aplica el preset de sesión que elijas y arranca el servidor (o lo reinicia si ya está en marcha). Sirve para una carrera suelta o para una cita semanal. Howler tiene que estar abierto a esa hora.')}
        </p>
        <Notice notice={notice} />
        {!state ? <p className="empty">{t('Cargando…')}</p> : state.events.length === 0 ? (
          <p className="empty">{t('Todavía no hay ningún evento. Crea el primero para que el servidor se prepare solo.')}</p>
        ) : (
          <div className="table-scroll">
            <table className="timing sched">
              <thead><tr><th>{t('Evento')}</th><th>{t('Cuándo')}</th><th>{t('Preset')}</th><th>{t('Estado')}</th><th /></tr></thead>
              <tbody>
                {state.events.map((e) => <EventRow key={e.id} e={e} nowMs={nowMs} onEdit={() => setEdit({ id: e.id, v: { name: e.name, enabled: e.enabled, presetId: e.presetId, when: e.when, stopAfterMinutes: e.stopAfterMinutes, announceMinutes: e.announceMinutes, track: e.track, entries: e.entries, discord: e.discord } })}
                  onToggle={() => apply(() => adminApi.updateSchedule(e.id, { ...e, enabled: !e.enabled }), e.enabled ? t('Evento desactivado') : t('Evento activado'))}
                  onRun={() => apply(() => adminApi.runSchedule(e.id), t('Servidor arrancando con este evento'))}
                  onDelete={() => apply(() => adminApi.deleteSchedule(e.id), t('Evento borrado'))} />)}
              </tbody>
            </table>
          </div>
        )}
        {!edit && <p><button type="button" className="btn primary" onClick={() => setEdit({ id: null, v: { ...blank(), when: { kind: 'weekly', days: [4], time: '21:00' } } })}>{t('Nuevo evento')}</button></p>}
      </Card>
      {!edit && <WeekendCard presets={presets} onDone={load} />}
      {!edit && <ChampionshipCard presets={presets} onDone={load} />}
      {edit && <EventForm v={edit.v} editing={edit.id !== null} presets={presets} onChange={(v) => setEdit({ ...edit, v })} onSave={save} onCancel={() => setEdit(null)} />}
    </>
  );
}

function EventRow({ e, nowMs, onEdit, onToggle, onRun, onDelete }: {
  e: ScheduledEventDto; nowMs: number; onEdit: () => void; onToggle: () => void; onRun: () => void; onDelete: () => void;
}) {
  const label: Record<ScheduledEventDto['status'], string> = {
    disabled: t('Desactivado'), waiting: e.nextAt ? inText(new Date(e.nextAt).getTime() - nowMs) : '', running: e.stopAt ? t('En marcha · para {x}', { x: clock(e.stopAt) }) : t('En marcha'),
    done: t('Hecho'), missed: t('Perdido (Howler estaba apagado)'),
  };
  return (
    <tr className={e.enabled ? '' : 'muted'}>
      <td className="driver">{e.name}</td>
      <td>{whenText(e.when)}</td>
      <td className="muted">{e.presetId ? (e.presetName ?? t('(preset borrado)')) : t('Sin cambiar ajustes')}{e.track ? ` · ${e.track.track}` : ''}{e.entries.length > 0 ? ` · ${t('{n} coches', { n: e.entries.length })}` : ''}</td>
      <td className={`sched-${e.status}`}>{label[e.status]}</td>
      <td className="row-actions">
        <button type="button" className="btn small" onClick={onEdit}>{t('Editar')}</button>
        <button type="button" className="btn small" onClick={onToggle}>{e.enabled ? t('Desactivar') : t('Activar')}</button>
        <ConfirmButton label={t('Ejecutar ahora')} confirmLabel={t('¿Arrancar ya?')} onConfirm={onRun} />
        <ConfirmButton danger label={t('Borrar')} confirmLabel={t('¿Borrar?')} onConfirm={onDelete} />
      </td>
    </tr>
  );
}

function EventForm({ v, editing, presets, onChange, onSave, onCancel }: {
  v: ScheduledEventInput; editing: boolean; presets: SessionPresetsDto['presets']; onChange: (v: ScheduledEventInput) => void; onSave: () => void; onCancel: () => void;
}) {
  const installed = useInstalled();
  const set = (p: Partial<ScheduledEventInput>) => onChange({ ...v, ...p });
  const w = v.when;
  const toggleDay = (d: number) => {
    if (w.kind !== 'weekly') return;
    set({ when: { ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d] } });
  };
  const toggleAnnounce = (m: number) => set({ announceMinutes: v.announceMinutes.includes(m) ? v.announceMinutes.filter((x) => x !== m) : [...v.announceMinutes, m] });
  return (
    <Card title={editing ? t('Editar evento') : t('Nuevo evento')}>
      <Field label={t('Nombre')}><input type="text" value={v.name} maxLength={MAX_SCHEDULE_NAME} placeholder={t('Liga del jueves')} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label={t('Preset de sesión')} hint={presets.length === 0 ? t('Aún no tienes presets: guarda uno en Preparar → Sesión → Presets para poder elegirlo aquí.') : t('Se aplica justo antes de arrancar. «Sin cambiar ajustes» arranca con lo que haya guardado.')}>
        <select value={v.presetId ?? ''} onChange={(e) => set({ presetId: e.target.value || null })}>
          <option value="">{t('Sin cambiar ajustes')}</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label={t('Repetir')}>
        <span className="segmented" role="radiogroup" aria-label={t('Repetir')}>
          <button type="button" role="radio" aria-checked={w.kind === 'once'} className={w.kind === 'once' ? 'on' : ''} onClick={() => set({ when: { kind: 'once', at: tomorrowEvening() } })}>{t('Una sola vez')}</button>
          <button type="button" role="radio" aria-checked={w.kind === 'weekly'} className={w.kind === 'weekly' ? 'on' : ''} onClick={() => set({ when: { kind: 'weekly', days: [4], time: '21:00' } })}>{t('Cada semana')}</button>
        </span>
      </Field>
      {w.kind === 'once' ? (
        <Field label={t('Fecha y hora')} hint={t('Hora del PC donde corre Howler.')}>
          <input type="datetime-local" value={w.at} onChange={(e) => set({ when: { kind: 'once', at: e.target.value } })} />
        </Field>
      ) : (
        <>
          <Field label={t('Días')}>
            <span className="segmented" role="group" aria-label={t('Días')}>
              {WEEK.map((d) => <button key={d} type="button" aria-pressed={w.days.includes(d)} className={w.days.includes(d) ? 'on' : ''} onClick={() => toggleDay(d)}>{dayName(d)}</button>)}
            </span>
          </Field>
          <Field label={t('Hora')} hint={t('Hora del PC donde corre Howler.')}>
            <input type="time" value={w.time} onChange={(e) => set({ when: { ...w, time: e.target.value } })} />
          </Field>
        </>
      )}
      <EventSetupFields v={v} onChange={set} installed={installed} />
      <Field label={t('Avisar por el chat')} hint={t('Solo si el servidor está en marcha y hay jugadores conectados.')}>
        <span className="segmented" role="group" aria-label={t('Avisar por el chat')}>
          {ANNOUNCE_CHOICES.map((m) => <button key={m} type="button" aria-pressed={v.announceMinutes.includes(m)} className={v.announceMinutes.includes(m) ? 'on' : ''} onClick={() => toggleAnnounce(m)}>{t('{n} min antes', { n: m })}</button>)}
        </span>
      </Field>
      <Field label={t('Parar el servidor')} hint={t('Pasado este tiempo desde el arranque, el servidor se para solo. Sin marcar, se queda en marcha.')}>
        <label className="inline">
          <input type="checkbox" checked={v.stopAfterMinutes !== null} onChange={(e) => set({ stopAfterMinutes: e.target.checked ? 120 : null })} /> {t('Parar solo')}
        </label>
        {v.stopAfterMinutes !== null && (
          <label className="inline"> <input type="number" min={5} max={1440} step={5} value={v.stopAfterMinutes} onChange={(e) => set({ stopAfterMinutes: Number(e.target.value) })} /> {t('minutos después')}</label>
        )}
      </Field>
      <Field label={t('Discord')} hint={t('Manda un aviso al acercarse y al empezar, si Discord está configurado y esos avisos están activados en Ajustes → Conexiones.')}>
        <label className="inline"><input type="checkbox" checked={v.discord} onChange={(e) => set({ discord: e.target.checked })} /> {t('Avisar también por Discord')}</label>
      </Field>
      <p className="row-actions">
        <button type="button" className="btn primary" onClick={onSave}>{t('Guardar evento')}</button>
        <button type="button" className="btn" onClick={onCancel}>{t('Cancelar')}</button>
      </p>
      <p className="hint">{t('Si el servidor está en marcha a esa hora se reiniciará (con aviso a los jugadores) para aplicar el preset.')}</p>
    </Card>
  );
}
