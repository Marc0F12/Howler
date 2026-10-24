import { useEffect, useRef, useState } from 'react';
import type { ChampionshipDto, SignupFormDto } from '@howler/shared';
import { useContentNames } from '../../content';
import { t, tm } from '../../i18n';

type Sent = null | 'created' | 'duplicate';

/** Botón «Inscribirse» de un campeonato con inscripción abierta, y el formulario en una ventana propia. */
export function SignupButton({ c }: { c: ChampionshipDto }) {
  const [form, setForm] = useState<SignupFormDto | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let off = false;
    if (c.status !== 'active' || c.sharedFrom) { setForm(null); return; }
    fetch(`/api/championships/${c.id}/signup`).then((r) => (r.ok ? (r.json() as Promise<SignupFormDto>) : null)).then((f) => { if (!off) setForm(f); }, () => { if (!off) setForm(null); });
    return () => { off = true; };
  }, [c.id, c.status, c.sharedFrom]);
  if (!form) return null;
  return (
    <>
      <button type="button" className="btn primary" onClick={() => ref.current?.showModal()}>{t('Inscribirse')}</button>
      <dialog ref={ref} className="signup-dialog" aria-labelledby={`su-${c.id}`} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <SignupForm c={c} form={form} onClose={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function SignupForm({ c, form, onClose }: { c: ChampionshipDto; form: SignupFormDto; onClose: () => void }) {
  const { carName } = useContentNames();
  const [v, setV] = useState({ name: '', steam: '', team: '', car: '', email: '', website: '' });
  const [answers, setAnswers] = useState<string[]>(() => form.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/championships/${c.id}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...v, answers }) });
      const j = (await r.json().catch(() => ({}))) as { result?: Sent; error?: string };
      if (!r.ok) throw new Error(j.error ?? t('No se ha podido enviar. Prueba más tarde.'));
      setSent(j.result === 'duplicate' ? 'duplicate' : 'created');
    } catch (err) { setError(tm((err as Error).message)); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="signup-body">
        <h2 id={`su-${c.id}`}>{sent === 'created' ? t('Solicitud enviada') : t('Ya tenemos tu solicitud')}</h2>
        <p>{sent === 'created' ? t('El organizador la revisará y, si la aprueba, aparecerás en la lista de pilotos del campeonato.') : t('Ya hay una solicitud con ese perfil de Steam. Espera a que el organizador la revise.')}</p>
        <div className="signup-actions"><button type="button" className="btn primary" onClick={onClose}>{t('Cerrar')}</button></div>
      </div>
    );
  }
  return (
    <form className="signup-body" onSubmit={submit}>
      <h2 id={`su-${c.id}`}>{t('Inscribirse en {name}', { name: c.name })}</h2>
      {form.info && <p className="signup-info">{form.info}</p>}
      <label className="su-field"><span>{t('Tu nombre')}</span>
        <input type="text" required minLength={2} maxLength={40} autoComplete="nickname" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <label className="su-field"><span>{t('Enlace a tu perfil de Steam')}</span>
        <input type="text" required inputMode="url" placeholder="https://steamcommunity.com/id/…" value={v.steam} onChange={(e) => setV({ ...v, steam: e.target.value })} />
        <small className="muted">{t('En Steam: tu nombre → «Ver mi perfil» → copia la dirección de la barra del navegador. El perfil tiene que ser público.')}</small>
      </label>
      {form.askTeam && (
        <label className="su-field"><span>{t('Equipo (opcional)')}</span>
          <input type="text" maxLength={40} list={`su-teams-${c.id}`} value={v.team} onChange={(e) => setV({ ...v, team: e.target.value })} />
          <datalist id={`su-teams-${c.id}`}>{c.teams.map((x) => <option key={x.id} value={x.name} />)}</datalist>
        </label>
      )}
      {form.cars.length > 0 && (
        <label className="su-field"><span>{t('Coche')}</span>
          <select value={v.car} onChange={(e) => setV({ ...v, car: e.target.value })}>
            <option value="">{t('Me da igual')}</option>
            {form.cars.map((x) => <option key={x} value={x}>{carName(x)}</option>)}
          </select>
        </label>
      )}
      {form.askEmail && (
        <label className="su-field"><span>{t('Correo (opcional)')}</span>
          <input type="email" maxLength={120} autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          <small className="muted">{t('Solo lo ve el organizador, para avisarte. Si te rechazan, se borra.')}</small>
        </label>
      )}
      {form.questions.map((q, i) => (
        <label className="su-field" key={i}><span>{q}</span>
          <input type="text" maxLength={300} value={answers[i] ?? ''} onChange={(e) => setAnswers(answers.map((x, k) => (k === i ? e.target.value : x)))} />
        </label>
      ))}
      {/* Campo trampa: las personas no lo ven; un bot que rellena todo se delata */}
      <div className="signup-trap" aria-hidden="true"><label>Website<input type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></label></div>
      {error && <p className="signup-error" role="alert">{error}</p>}
      <p className="muted">{t('Tu nombre y tu perfil se guardan para que el organizador revise la solicitud. No entras en el campeonato hasta que la apruebe.')}</p>
      <div className="signup-actions">
        <button type="button" className="btn" onClick={onClose}>{t('Cancelar')}</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? t('Enviando…') : t('Enviar solicitud')}</button>
      </div>
    </form>
  );
}
