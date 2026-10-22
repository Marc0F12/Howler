import { t, tm } from '../i18n';
import { useEffect, useState } from 'react';
import { formatPenalty, type PenaltyKind, type RacePenaltyRules } from '@howler/shared';
import { useLive } from '../api';
import { useContentNames } from '../content';
import { clock } from '../format';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const KIND: [PenaltyKind, string, string][] = [
  ['warning', t('Aviso'), t('Solo queda anotado; no cambia el resultado.')],
  ['time', t('Tiempo añadido'), t('Se suma al tiempo total de la carrera y puede cambiar su puesto.')],
  ['dsq', t('Descalificar'), t('Queda fuera de la clasificación de esa carrera: sin puesto ni puntos.')],
];
const TYPE = { 1: t('Práctica'), 2: t('Clasificación'), 3: t('Carrera') } as Record<number, string>;

/** Pestaña «Penalizaciones»: avisos, tiempo añadido y descalificaciones a mano, y las reglas automáticas por cortes y choques. */
export function PenaltiesSection() {
  const { trackName } = useContentNames();
  const { notice, run } = useNotice();
  const { data: sessions } = useLive(adminApi.penaltySessions, [], (e) => e.type === 'lap' || e.type === 'session');
  const [sessionId, setSessionId] = useState(0);
  const [form, setForm] = useState<{ driverId: number; kind: PenaltyKind; seconds: string; reason: string; announce: boolean }>({ driverId: 0, kind: 'time', seconds: '5', reason: '', announce: false });
  const session = sessions?.find((s) => s.id === sessionId) ?? null;
  const { data: list, refresh } = useLive(() => adminApi.penalties(sessionId || undefined), [sessionId], (e) => e.type === 'results');

  useEffect(() => { if (sessions?.length && !sessionId) setSessionId((sessions.find((s) => s.type === 3) ?? sessions[0]!).id); }, [sessions, sessionId]);
  useEffect(() => { setForm((f) => ({ ...f, driverId: 0 })); }, [sessionId]);

  const apply = () => run(async () => {
    await adminApi.addPenalty({
      sessionId, driverId: form.driverId, kind: form.kind, reason: form.reason.trim(),
      ...(form.kind === 'time' ? { seconds: Number(form.seconds) } : {}), announce: form.announce,
    });
    setForm({ ...form, reason: '' });
    refresh();
    return { ok: true };
  }, t('Penalización puesta'));
  const valid = sessionId > 0 && form.driverId > 0 && (form.kind !== 'time' || Number(form.seconds) >= 1);

  return (
    <>
      <Card title={t('Poner una penalización')}>
        <p className="hint">{t('Elige la sesión y el piloto. Las penalizaciones cuentan en los resultados de carrera de los campeonatos; un aviso solo se guarda. Se pueden quitar después.')}</p>
        <div className="row">
          <label className="mini">{t('Sesión')}
            <select value={sessionId} onChange={(e) => setSessionId(Number(e.target.value))} aria-label={t('Sesión')}>
              {(sessions ?? []).map((s) => <option key={s.id} value={s.id}>#{s.id} · {TYPE[s.type] ?? t('Sesión')} · {trackName(s.track, s.layout)} · {clock(s.startedAt)}</option>)}
            </select>
          </label>
          <label className="mini">{t('Piloto')}
            <select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: Number(e.target.value) })} aria-label={t('Piloto')}>
              <option value={0}>{t('Elegir…')}</option>
              {(session?.drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} ({t('{n} vueltas', { n: d.laps })})</option>)}
            </select>
          </label>
        </div>
        <fieldset className="pen-kind">
          <legend>{t('Qué se le pone')}</legend>
          {KIND.map(([k, l, d]) => (
            <label key={k}><input type="radio" name="pen-kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} /> <strong>{l}</strong> <span className="muted">{d}</span></label>
          ))}
        </fieldset>
        <div className="row">
          {form.kind === 'time' && <label className="mini">{t('Segundos')}<input type="number" min={1} max={3600} value={form.seconds} onChange={(e) => setForm({ ...form, seconds: e.target.value })} /></label>}
          <label className="mini grow">{t('Motivo')}<input type="text" className="wide" maxLength={200} placeholder={t('p. ej. empujó al rival en la curva 3')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        </div>
        <label><input type="checkbox" checked={form.announce} onChange={(e) => setForm({ ...form, announce: e.target.checked })} /> {t('Avisar por el chat del servidor')}</label>
        <div className="row"><button type="button" className="btn primary" disabled={!valid} onClick={apply}>{t('Poner penalización')}</button></div>
        <Notice notice={notice} />
      </Card>

      <Card title={session ? t('Penalizaciones de la sesión #{id}', { id: session.id }) : t('Penalizaciones')} aside={<span className="muted">{list?.length ?? '…'}</span>}>
        {list && list.length === 0 ? <p className="empty">{t('No hay penalizaciones en esta sesión.')}</p> : (
          <ul className="pick-list">
            {(list ?? []).map((p) => (
              <li key={p.id}>
                <span><strong>{p.driverName}</strong> · <span className={`badge ${p.kind === 'warning' ? '' : 'bad'}`}>{tm(formatPenalty(p))}</span> <span className="muted">{p.reason}</span></span>
                <ConfirmButton label={t('Quitar')} confirmLabel={t('¿Quitar?')} onConfirm={() => run(async () => { await adminApi.removePenalty(p.id); refresh(); return { ok: true }; }, t('Penalización quitada'))} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AutoPenalties />
    </>
  );
}

const FIELDS: [keyof RacePenaltyRules, string, string][] = [
  ['cutSeconds', t('Segundos por cada corte de pista'), 's'],
  ['carHitSeconds', t('Segundos por cada choque con otro coche'), 's'],
  ['carHitMinKmh', t('Solo choques a partir de'), 'km/h'],
  ['envHitSeconds', t('Segundos por cada choque con el entorno'), 's'],
  ['envHitMinKmh', t('Solo choques a partir de'), 'km/h'],
];

/** Reglas automáticas: segundos que se suman por cortes y choques en las carreras de los campeonatos. Todo en 0 = apagado. */
function AutoPenalties() {
  const { notice, run } = useNotice();
  const { data } = useLive(adminApi.racePenalties, []);
  const [v, setV] = useState<RacePenaltyRules | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  if (!v) return null;
  const on = v.cutSeconds > 0 || v.carHitSeconds > 0 || v.envHitSeconds > 0;
  return (
    <Card title={t('Penalizaciones automáticas de carrera')} aside={<span className={`badge ${on ? 'ok' : ''}`}>{on ? t('Activas') : t('Apagadas')}</span>}>
      <p className="hint">{t('Se suman solas al tiempo de cada piloto en las carreras de un campeonato, a partir de lo que ya guarda Howler de sus vueltas. No hace falta recalcular: al cambiar estos valores los resultados se actualizan. Con todo en 0 no se penaliza nada.')}</p>
      <div className="row">
        {FIELDS.map(([k, label, unit]) => (
          <label className="mini" key={k}>{label} ({unit})
            <input type="number" min={0} max={k.endsWith('Kmh') ? 500 : 600} step="any" value={v[k]} onChange={(e) => setV({ ...v, [k]: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        ))}
      </div>
      <div className="row"><button type="button" className="btn primary" onClick={() => run(async () => { await adminApi.saveRacePenalties(v); return { ok: true }; }, t('Reglas guardadas'))}>{t('Guardar')}</button></div>
      <Notice notice={notice} />
    </Card>
  );
}
