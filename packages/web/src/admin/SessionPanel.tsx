import { useEffect, useMemo, useState } from 'react';
import {
  GROUP_META, IS_OPEN_CHOICES, SESSION_IDS, SESSION_LABEL, SESSION_PRESETS, SETTINGS, txt,
  type SessionId, type SessionPanelDto, type SessionPlan, type SessionsPlan, type SettingGroup, type SettingSpec, type SettingValue,
} from '@howler/shared';
import { getLang, t, tm } from '../i18n';
import { adminApi, type SessionPresetsDto } from './adminApi';
import { ConfirmButton, Notice, useNotice } from './ui';
import { summarize } from './session-summary';
import { Icon } from '../components/Icon';
import { GROUP_ICON, SESSION_ICON, SETTING_ICON } from './session-icons';

const BIG_GROUPS: SettingGroup[] = ['conditions', 'assists', 'tyres', 'race'];
const MORE_GROUPS: SettingGroup[] = ['conditions', 'race', 'general', 'votes', 'ai'];

const lang = () => getLang();
const label = (s: SettingSpec) => txt(s.label, lang());
const help = (s: SettingSpec) => txt(s.help, lang());

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Un ajuste con el control que le toca según su tipo. */
function SettingRow({ spec, value, onChange, disabled }: { spec: SettingSpec; value: SettingValue; onChange: (v: SettingValue) => void; disabled?: boolean }) {
  const changed = value !== spec.def;
  const id = `set-${spec.id}`;
  let control;
  if (spec.kind === 'bool') {
    control = (
      <label className="sp-switch">
        <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{value === true ? t('Sí') : t('No')}</span>
      </label>
    );
  } else if (spec.kind === 'choice') {
    control = (
      <div className="sp-seg" role="radiogroup" aria-labelledby={`${id}-l`}>
        {spec.choices!.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={value === c.value} disabled={disabled} onClick={() => onChange(c.value)}>{txt(c.label, lang())}</button>
        ))}
      </div>
    );
  } else if (spec.kind === 'text') {
    control = <input id={id} type="text" value={String(value)} disabled={disabled} maxLength={200} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const slider = spec.min !== undefined && spec.max !== undefined && spec.max - spec.min <= 600;
    control = (
      <span className="sp-num">
        {slider && <input type="range" min={spec.min} max={spec.max} step={spec.step ?? 1} value={Number(value)} disabled={disabled} aria-labelledby={`${id}-l`} onChange={(e) => onChange(Number(e.target.value))} />}
        <input id={id} type="number" min={spec.min} max={spec.max} step={spec.step ?? 1} value={Number(value)} disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? spec.def as number : Number(e.target.value))} />
        {spec.unit && <span className="sp-unit">{tm(spec.unit)}</span>}
      </span>
    );
  }
  return (
    <div className={`sp-row${spec.kind === 'bool' ? ' inline' : ''}${changed ? ' changed' : ''}`}>
      <span className="sp-ico"><Icon name={SETTING_ICON[spec.id] ?? GROUP_ICON[spec.group]} size={26} /></span>
      <div className="sp-text">
        <label id={`${id}-l`} htmlFor={id} className="sp-name">{label(spec)}{changed && <span className="sp-dot" title={t('Distinto del valor de serie')} aria-label={t('Distinto del valor de serie')} />}</label>
        <span className="sp-help">{help(spec)}</span>
      </div>
      <div className="sp-ctl">{control}</div>
    </div>
  );
}

/** Una fila de sesión: activa, duración, acceso y (en la carrera) vueltas o tiempo y espera. */
function SessionRow({ id, plan, onChange }: { id: SessionId; plan: SessionPlan; onChange: (p: SessionPlan) => void }) {
  const set = (patch: Partial<SessionPlan>) => onChange({ ...plan, ...patch });
  const off = !plan.enabled;
  return (
    <div className={`sp-session${off ? ' off' : ''}`}>
      <label className="sp-switch sp-session-name">
        <input type="checkbox" checked={plan.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <Icon name={SESSION_ICON[id]} size={26} /><strong>{txt(SESSION_LABEL[id], lang())}</strong>
      </label>
      <div className="sp-session-body">
        {id === 'race' && (
          <div className="sp-seg" role="radiogroup" aria-label={t('Duración de la carrera')}>
            <button type="button" role="radio" aria-checked={plan.mode === 'laps'} disabled={off} onClick={() => set({ mode: 'laps', laps: plan.laps || 10 })}>{t('Por vueltas')}</button>
            <button type="button" role="radio" aria-checked={plan.mode === 'time'} disabled={off} onClick={() => set({ mode: 'time', minutes: plan.minutes || 30 })}>{t('Por tiempo')}</button>
          </div>
        )}
        {plan.mode === 'laps' && id === 'race'
          ? <label className="sp-inline"><input type="number" min={1} max={999} value={plan.laps} disabled={off} onChange={(e) => set({ laps: Number(e.target.value) })} aria-label={t('Vueltas')} /><span className="sp-unit">{t('vueltas')}</span></label>
          : <label className="sp-inline"><input type="number" min={1} max={1440} value={plan.minutes} disabled={off} onChange={(e) => set({ minutes: Number(e.target.value) })} aria-label={t('Minutos')} /><span className="sp-unit">{t('min')}</span></label>}
        <label className="sp-inline">
          <span className="sp-unit">{t('Acceso')}</span>
          <select value={plan.isOpen} disabled={off} onChange={(e) => set({ isOpen: Number(e.target.value) })}>
            {IS_OPEN_CHOICES.map((c) => <option key={c.value} value={c.value}>{txt(c.label, lang())}</option>)}
          </select>
        </label>
        {id === 'race' && (
          <label className="sp-inline">
            <span className="sp-unit">{t('Espera en parrilla')}</span>
            <input type="number" min={0} max={600} value={plan.waitSeconds} disabled={off} onChange={(e) => set({ waitSeconds: Number(e.target.value) })} aria-label={t('Segundos de espera en la parrilla')} />
            <span className="sp-unit">s</span>
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Panel de sesión completo: franja resumen, tarjetas grandes con lo importante, el resto plegado y un buscador.
 * El servidor lee estos valores al arrancar: «Guardar y reiniciar» los aplica avisando a los jugadores.
 */
export function SessionPanel({ running, preset }: { running: boolean; preset: string }) {
  const { notice, run } = useNotice();
  const [saved, setSaved] = useState<SessionPanelDto | null>(null);
  const [values, setValues] = useState<Record<string, SettingValue>>({});
  const [sessions, setSessions] = useState<SessionsPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [own, setOwn] = useState<SessionPresetsDto['presets']>([]);
  const [pick, setPick] = useState('');
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => { adminApi.sessionPresets().then((r) => setOwn(r.presets), () => setOwn([])); }, []);

  const load =(p: SessionPanelDto) => { setSaved(p); setValues(p.values); setSessions(p.sessions); setError(null); };
  useEffect(() => { adminApi.sessionPanel().then(load, (e: Error) => setError(tm(e.message))); }, [preset]);

  const dirty = useMemo(() => saved !== null && (!eq(saved.values, values) || !eq(saved.sessions, sessions)), [saved, values, sessions]);
  const summary = useMemo(() => (sessions ? summarize(values, sessions) : []), [values, sessions]);

  if (error) return <p className="warn">{t('No se pudieron leer los ajustes del preset «{preset}»:', { preset })} {error}</p>;
  if (!saved || !sessions) return <p className="empty">{t('Cargando…')}</p>;

  const bySpec = (g: SettingGroup, tier: SettingSpec['tier']) => SETTINGS.filter((s) => s.group === g && s.tier === tier);
  const row = (s: SettingSpec) => {
    // Los ajustes del agarre dinámico solo valen con el agarre dinámico encendido.
    const gripOff = s.section === 'DYNAMIC_TRACK' && s.key !== '#section' && values.dynamicTrack !== true;
    return <SettingRow key={s.id} spec={s} value={values[s.id] ?? s.def} disabled={gripOff} onChange={(v) => setValues((c) => ({ ...c, [s.id]: v }))} />;
  };

  const save = (applyAndRestart: boolean) => run(async () => {
    const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => saved.values[k] !== v));
    const r = await adminApi.saveSessionPanel({ values: changed, sessions: eq(saved.sessions, sessions) ? undefined : sessions, applyAndRestart });
    load(r.panel);
    return { ok: true, reply: r.restarting ? t('Reiniciando el servidor para aplicarlo…') : running ? t('Se aplicará la próxima vez que reinicies el servidor.') : t('Se aplicará al arrancar el servidor.') };
  }, t('Guardado'));

  const q = query.trim().toLowerCase();
  const found = q ? SETTINGS.filter((s) => `${s.label.es} ${s.label.en} ${s.help.es} ${s.help.en} ${s.key}`.toLowerCase().includes(q)) : null;

  return (
    <section className="sp" aria-label={t('Ajustes de la sesión')}>
      <header className="sp-head">
        <h3><Icon name="settings" size={26} />{t('Ajustes de la sesión · preset {preset}', { preset: preset || '(cfg/)' })}</h3>
        <input type="search" className="sp-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Buscar un ajuste (combustible, mantas, ABS…)')} aria-label={t('Buscar un ajuste')} />
      </header>
      <div className="sp-presets">
        <label className="sp-inline">
          <Icon name="save" size={18} /><span className="sp-unit">{t('Preset')}</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('Elige uno…')}</option>
            <optgroup label={t('De serie')}>{SESSION_PRESETS.map((p) => <option key={p.id} value={p.id}>{txt(p.name, lang())}</option>)}</optgroup>
            {own.length > 0 && <optgroup label={t('Mis presets')}>{own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          </select>
        </label>
        <button type="button" className="btn small" disabled={pick === ''} onClick={() => {
          const builtin = SESSION_PRESETS.find((p) => p.id === pick);
          const mine = own.find((p) => p.id === pick);
          if (builtin) setValues((c) => ({ ...c, ...builtin.values }));
          else if (mine) { setValues((c) => ({ ...c, ...mine.values })); setSessions(mine.sessions); }
        }}>{t('Cargar')}</button>
        {own.some((p) => p.id === pick) && <ConfirmButton label={t('Borrar')} danger onConfirm={() => run(async () => { setOwn((await adminApi.deleteSessionPreset(pick)).presets); setPick(''); return { ok: true }; }, t('Preset borrado'))} />}
        {naming === null
          ? <button type="button" className="btn small" onClick={() => setNaming('')}>{t('Guardar como preset…')}</button>
          : (
            <span className="sp-inline">
              <input type="text" value={naming} maxLength={40} autoFocus placeholder={t('Nombre del preset')} aria-label={t('Nombre del preset')} onChange={(e) => setNaming(e.target.value)} />
              <button type="button" className="btn small primary" disabled={naming.trim() === ''} onClick={() => run(async () => { setOwn((await adminApi.saveSessionPreset({ name: naming, values, sessions })).presets); setNaming(null); return { ok: true }; }, t('Preset guardado'))}>{t('Guardar')}</button>
              <button type="button" className="btn small" onClick={() => setNaming(null)}>{t('Cancelar')}</button>
            </span>
          )}
        {SESSION_PRESETS.find((p) => p.id === pick) && <span className="sp-help">{txt(SESSION_PRESETS.find((p) => p.id === pick)!.hint, lang())}</span>}
      </div>
      <p className="sp-summary" aria-label={t('Resumen de la sesión')}>{summary.map((s, i) => <span key={i}>{s}</span>)}</p>
      {saved.extraMissing && <p className="hint">{t('No hay extra_cfg.yml en este preset: los ajustes de AssettoServer se guardarán con su valor de serie y no se pueden cambiar hasta que exista.')}</p>}

      {found ? (
        <div className="sp-block">
          <h4>{found.length === 1 ? t('1 resultado') : t('{n} resultados', { n: found.length })}</h4>
          {found.map(row)}
          {found.length === 0 && <p className="empty">{t('Ningún ajuste coincide.')}</p>}
        </div>
      ) : (
        <>
          <div className="sp-block sp-sessions">
            <h4><Icon name="sessions" size={26} />{t('Sesiones')}</h4>
            <p className="sp-help">{t('Qué sesiones hay y cuánto dura cada una. Se repiten en bucle si el modo bucle está activo.')}</p>
            {SESSION_IDS.map((id) => <SessionRow key={id} id={id} plan={sessions[id]} onChange={(p) => setSessions((c) => ({ ...c!, [id]: p }))} />)}
          </div>
          <div className="sp-grid">
            {BIG_GROUPS.map((g) => (
              <div key={g} className="sp-block">
                <h4><Icon name={GROUP_ICON[g]} size={26} />{txt(GROUP_META[g].title, lang())}</h4>
                <p className="sp-help">{txt(GROUP_META[g].hint, lang())}</p>
                {bySpec(g, 'big').map(row)}
              </div>
            ))}
          </div>
          <div className="sp-more">
            {MORE_GROUPS.filter((g) => bySpec(g, 'mid').length > 0).map((g) => (
              <details key={g}>
                <summary><Icon name={GROUP_ICON[g]} size={18} />{txt(GROUP_META[g].title, lang())} <span className="sp-count">{bySpec(g, 'mid').length}</span></summary>
                <div className="sp-details-body">{bySpec(g, 'mid').map(row)}</div>
              </details>
            ))}
            <details>
              <summary><Icon name="settings" size={18} />{t('Avanzado')} <span className="sp-count">{SETTINGS.filter((s) => s.tier === 'adv').length}</span></summary>
              <div className="sp-details-body">
                <p className="hint">{t('Ajustes técnicos. Si no sabes para qué sirve uno, déjalo como está: un valor equivocado puede dejar el servidor sin jugadores.')}</p>
                {SETTINGS.filter((s) => s.tier === 'adv').map(row)}
              </div>
            </details>
          </div>
        </>
      )}

      <div className="sp-bar">
        <span className="sp-state" role="status">{dirty ? t('Hay cambios sin guardar') : t('Todo guardado')}</span>
        <button type="button" className="btn" disabled={!dirty} onClick={() => { setValues(saved.values); setSessions(saved.sessions); }}>{t('Descartar')}</button>
        <button type="button" className="btn" disabled={!dirty} onClick={() => save(false)}>{t('Guardar')}</button>
        <button type="button" className="btn primary" disabled={!dirty || !running} onClick={() => save(true)} title={running ? undefined : t('El servidor está parado: se aplicará al arrancarlo')}>{t('Guardar y reiniciar el servidor')}</button>
      </div>
      <Notice notice={notice} />
    </section>
  );
}
