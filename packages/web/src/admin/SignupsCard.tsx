import { useEffect, useState } from 'react';
import { SIGNUP_MAX_QUESTIONS, type ChampionshipDto, type SignupRequestDto, type SignupSettings, type SignupStateDto } from '@howler/shared';
import { t } from '../i18n';
import { formatDay, timeOf } from '../format';
import { useContentNames } from '../content';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const when = (iso: string) => `${formatDay(new Date(iso), { month: 'short', year: true })} ${timeOf(new Date(iso))}`;

/** Una solicitud pendiente: datos, equipo y coche a asignar, y aprobar o rechazar. */
function PendingRow({ r, c, cars, onApprove, onReject }: { r: SignupRequestDto; c: ChampionshipDto; cars: string[]; onApprove: (teamId: number | null, car: string | null) => void; onReject: () => void }) {
  const { carName } = useContentNames();
  const match = c.teams.find((x) => x.name.trim().toLowerCase() === r.team.trim().toLowerCase());
  const [teamId, setTeamId] = useState<number | null>(match?.id ?? null);
  const [car, setCar] = useState<string>(r.car);
  return (
    <li className="signup-req">
      <div className="signup-who">
        <strong>{r.name}</strong>
        <a href={r.steam} target="_blank" rel="noreferrer noopener">{t('Perfil de Steam')}</a>
        {r.email && <span className="muted">{r.email}</span>}
        <span className="muted">{when(r.createdAt)}</span>
      </div>
      {(r.team || r.car) && <p className="muted">{r.team && t('Pide el equipo: {team}', { team: r.team })}{r.team && r.car ? ' · ' : ''}{r.car && t('Pide el coche: {car}', { car: carName(r.car) })}</p>}
      {r.answers.length > 0 && <dl className="signup-answers">{r.answers.map((a) => <div key={a.question}><dt>{a.question}</dt><dd>{a.answer || '—'}</dd></div>)}</dl>}
      <div className="row">
        {c.teams.length > 0 && (
          <label className="sp-inline"><span className="sp-unit">{t('Equipo')}</span>
            <select value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('Sin equipo')}</option>
              {c.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        {cars.length > 0 && (
          <label className="sp-inline"><span className="sp-unit">{t('Coche')}</span>
            <select value={car} onChange={(e) => setCar(e.target.value)}>
              <option value="">{t('Sin asignar')}</option>
              {cars.map((x) => <option key={x} value={x}>{carName(x)}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn primary small" onClick={() => onApprove(teamId, car || null)}>{t('Aprobar')}</button>
        <button type="button" className="btn small" onClick={onReject}>{t('Rechazar')}</button>
      </div>
    </li>
  );
}

/** Inscripción pública de un campeonato: ajustes del formulario y solicitudes por revisar. */
export function SignupsCard({ c, onChanged }: { c: ChampionshipDto; onChanged: () => void }) {
  const [state, setState] = useState<SignupStateDto | null>(null);
  const [draft, setDraft] = useState<SignupSettings | null>(null);
  const { notice, run } = useNotice();
  useEffect(() => { adminApi.signups(c.id).then((s) => { setState(s); setDraft(s.settings); }, () => setState(null)); }, [c.id]);
  if (!state || !draft) return null;
  const apply = (s: SignupStateDto) => { setState(s); onChanged(); return { ok: true }; };
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings);
  const set = (patch: Partial<SignupSettings>) => setDraft({ ...draft, ...patch });
  const pending = state.requests.filter((r) => r.status === 'pending');
  const done = state.requests.filter((r) => r.status !== 'pending');

  return (
    <Card title={t('Inscripción pública')} aside={pending.length > 0 ? <span className="badge pending">{t('{n} por revisar', { n: pending.length })}</span> : undefined}>
      <p className="hint">{t('Si la activas, la página del campeonato enseña un botón «Inscribirse». Cada solicitud llega aquí y no entra en el campeonato hasta que la apruebes. Solo funciona con el campeonato en estado «Activo».')}</p>
      <label className="sp-switch"><input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span>{draft.enabled ? t('Inscripción abierta') : t('Inscripción cerrada')}</span></label>
      {draft.enabled && c.status !== 'active' && <p className="warn-text">{t('El campeonato no está activo: el formulario no se enseñará hasta que lo actives.')}</p>}
      <div className="row">
        <label className="sp-switch"><input type="checkbox" checked={draft.askTeam} onChange={(e) => set({ askTeam: e.target.checked })} /><span>{t('Preguntar el equipo')}</span></label>
        <label className="sp-switch"><input type="checkbox" checked={draft.askCar} onChange={(e) => set({ askCar: e.target.checked })} disabled={state.cars.length === 0} /><span>{t('Dejar elegir coche')}</span></label>
        <label className="sp-switch"><input type="checkbox" checked={draft.askEmail} onChange={(e) => set({ askEmail: e.target.checked })} /><span>{t('Pedir un correo (opcional)')}</span></label>
      </div>
      {draft.askCar && state.cars.length === 0 && <p className="muted">{t('Para elegir coche, las carreras del campeonato tienen que tener coches permitidos.')}</p>}
      <label className="field"><span>{t('Texto sobre el formulario')}</span>
        <textarea rows={3} maxLength={800} value={draft.info} placeholder={t('Normas, qué pasa después de apuntarse…')} onChange={(e) => set({ info: e.target.value })} />
      </label>
      <div className="field"><span>{t('Preguntas extra (máximo {n})', { n: SIGNUP_MAX_QUESTIONS })}</span>
        {draft.questions.map((q, i) => (
          <div className="row" key={i}>
            <input type="text" value={q} maxLength={120} aria-label={t('Pregunta {n}', { n: i + 1 })} onChange={(e) => set({ questions: draft.questions.map((x, k) => (k === i ? e.target.value : x)) })} />
            <button type="button" className="btn small" onClick={() => set({ questions: draft.questions.filter((_, k) => k !== i) })}>{t('Quitar')}</button>
          </div>
        ))}
        {draft.questions.length < SIGNUP_MAX_QUESTIONS && <button type="button" className="btn small" onClick={() => set({ questions: [...draft.questions, ''] })}>{t('+ Añadir pregunta')}</button>}
      </div>
      <div className="row">
        <button type="button" className="btn primary small" disabled={!dirty} onClick={() => run(async () => apply(await adminApi.saveSignupSettings(c.id, draft)), t('Ajustes de inscripción guardados'))}>{t('Guardar')}</button>
        {dirty && <button type="button" className="btn small" onClick={() => setDraft(state.settings)}>{t('Descartar')}</button>}
        {state.requests.length > 0 && <a className="btn small" href={`/admin/api/championships/${c.id}/signups.csv`} download>{t('Descargar CSV')}</a>}
      </div>
      <Notice notice={notice} />

      <h4>{t('Solicitudes por revisar')}</h4>
      {pending.length === 0 ? <p className="empty">{t('No hay solicitudes pendientes.')}</p> : (
        <ul className="signup-list">
          {pending.map((r) => (
            <PendingRow key={r.id} r={r} c={c} cars={state.cars}
              onApprove={(teamId, car) => run(async () => apply(await adminApi.approveSignup(c.id, r.id, teamId, car)), t('{name} ya está inscrito', { name: r.name }))}
              onReject={() => run(async () => apply(await adminApi.rejectSignup(c.id, r.id)), t('Solicitud rechazada'))} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details>
          <summary>{t('Ya revisadas ({n})', { n: done.length })}</summary>
          <ul className="pick-list">
            {done.map((r) => (
              <li key={r.id}>
                <span><strong>{r.name}</strong> <span className={`badge ${r.status === 'approved' ? 'ok' : ''}`}>{r.status === 'approved' ? t('Aprobada') : t('Rechazada')}</span> <span className="muted">{when(r.createdAt)}</span></span>
                <ConfirmButton label={t('Borrar')} confirmLabel={t('¿Borrar?')} danger onConfirm={async () => { apply(await adminApi.removeSignup(c.id, r.id)); }} />
              </li>
            ))}
          </ul>
          <p className="muted">{t('Las rechazadas se borran solas a los 30 días.')}</p>
        </details>
      )}
    </Card>
  );
}
