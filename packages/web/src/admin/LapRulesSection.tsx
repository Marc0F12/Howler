import { t, tm } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { formatLapTime, type CollisionRule, type LapRules, type LapRulesConfig, type LapRulesStateDto, type RevalidationDto, type RuleProfile, type TrackListItemDto } from '@howler/shared';
import { api } from '../api';
import { useContentNames } from '../content';
import { adminApi } from './adminApi';
import { PendingLapsCard } from './PendingLapsCard';
import { RecentLapsCard } from './RecentLapsCard';
import { Card, ConfirmButton, Field, Notice, useNotice } from './ui';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Resumen en una frase de lo que hace un perfil. */
function describeRules(r: LapRules): string {
  const hit = (name: string, c: CollisionRule) => (c.mode === 'ignore' ? t('{name}: no anulan', { name }) : c.minSpeedKmh > 0 ? t('{name}: anulan desde {n} km/h', { name, n: c.minSpeedKmh }) : t('{name}: cualquiera anula', { name }));
  return [
    r.maxCuts === 0 ? t('Cualquier corte anula') : t('Se toleran {n} cortes', { n: r.maxCuts }),
    hit(t('choques con coches'), r.carCollisions),
    hit(t('con el entorno'), r.envCollisions),
    r.minLapMs > 0 ? t('tiempo mínimo {time}', { time: formatLapTime(r.minLapMs) }) : null,
    r.notifyDriver ? t('avisa al piloto') : null,
  ].filter(Boolean).join(' · ');
}

function CollisionEditor({ label, value, onChange }: { label: string; value: CollisionRule; onChange: (v: CollisionRule) => void }) {
  return (
    <Field label={label} hint={t('«A partir de» es la velocidad del golpe en km/h (0 = cualquier golpe). Entre dos coches se usa la velocidad RELATIVA entre ellos, no la de cada uno: dos coches que van juntos a 120 km/h y se rozan no chocan a 120.')}>
      <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as CollisionRule['mode'] })}>
        <option value="ignore">{t('No anulan la vuelta')}</option>
        <option value="invalidate">{t('Anulan la vuelta')}</option>
      </select>
      {value.mode === 'invalidate' && (
        <label className="inline">{t('a partir de')} <input type="number" min={0} max={500} value={value.minSpeedKmh} onChange={(e) => onChange({ ...value, minSpeedKmh: Number(e.target.value) })} /> km/h</label>
      )}
    </Field>
  );
}

/** Editor de las reglas de un perfil propio. */
function ProfileEditor({ profile, onChange }: { profile: RuleProfile; onChange: (p: RuleProfile) => void }) {
  const r = profile.rules;
  const set = (patch: Partial<LapRules>) => onChange({ ...profile, rules: { ...r, ...patch } });
  return (
    <div className="profile-editor">
      <Field label={t('Nombre')}><input type="text" maxLength={60} value={profile.name} onChange={(e) => onChange({ ...profile, name: e.target.value })} /></Field>
      <Field label={t('Cortes permitidos')} hint={t('0 = cualquier corte de pista anula la vuelta.')}>
        <input type="number" min={0} max={50} value={r.maxCuts} onChange={(e) => set({ maxCuts: Number(e.target.value) })} />
      </Field>
      <CollisionEditor label={t('Choques con otros coches')} value={r.carCollisions} onChange={(carCollisions) => set({ carCollisions })} />
      <CollisionEditor label={t('Choques con el entorno')} value={r.envCollisions} onChange={(envCollisions) => set({ envCollisions })} />
      <Field label={t('Tiempo mínimo (segundos)')} hint={t('Las vueltas más rápidas que esto se anulan (atajos, fallos). 0 = sin límite.')}>
        <input type="number" min={0} max={3600} step={0.001} value={r.minLapMs / 1000} onChange={(e) => set({ minLapMs: Math.round(Number(e.target.value) * 1000) })} />
      </Field>
      <Field label={t('Avisar al piloto')} hint={t('Manda un mensaje por el chat del servidor al piloto cuando se le anula una vuelta.')}>
        <label className="inline"><input type="checkbox" checked={r.notifyDriver} onChange={(e) => set({ notifyDriver: e.target.checked })} /> {t('Avisar por el chat')}</label>
      </Field>
    </div>
  );
}

/** Resultado de probar o aplicar unas reglas sobre el historial. */
function RevalidationResult({ r }: { r: RevalidationDto }) {
  const { carName, trackName } = useContentNames();
  const changed = r.toInvalid + r.toValid;
  return (
    <div className="revalidation" role="status">
      <p>
        <strong>{r.applied ? t('Hecho:') : t('Con estas reglas')} </strong>
        {changed === 0
          ? (r.applied ? t('ninguna de las {n} vueltas ha cambiado.', { n: r.total }) : t('ninguna de las {n} vueltas cambiaría.', { n: r.total }))
          : <>{r.applied ? t('han cambiado') : t('cambiarían')} <strong>{changed}</strong> {t('de {n} vueltas:', { n: r.total })} <strong>{r.toInvalid}</strong> {t('pasan a anuladas y')} <strong>{r.toValid}</strong> {t('a válidas.')}</>}
        {r.skippedManual > 0 && <span className="muted"> {t('{n} decididas a mano no se tocan.', { n: r.skippedManual })}</span>}
      </p>
      {r.samples.length > 0 && (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Piloto')}</th><th>{t('Circuito')}</th><th>{t('Coche')}</th><th className="num">{t('Tiempo')}</th><th>{t('Pasaría a')}</th></tr></thead>
            <tbody>
              {r.samples.map((s) => (
                <tr key={s.lapId}>
                  <td className="driver">{s.driverName}</td>
                  <td>{trackName(s.track, s.layout)}</td>
                  <td className="muted">{carName(s.car)}</td>
                  <td className="num">{formatLapTime(s.lapMs)}</td>
                  <td>{s.nowValid ? <span className="badge ok">{t('Válida')}</span> : <span className="badge bad">{s.reason ? tm(s.reason) : t('Anulada')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changed > r.samples.length && <p className="note">{t('Se enseñan las primeras {n}.', { n: r.samples.length })}</p>}
    </div>
  );
}

/**
 * Reglas de vuelta válida: perfiles (qué anula una vuelta), cuál se usa en cada circuito, y la forma de comprobar el
 * efecto sobre todo el historial antes de aplicarlo. También permite anular o restaurar vueltas sueltas a mano.
 */
export function LapRulesSection() {
  const { trackName } = useContentNames();
  const { notice, run } = useNotice();
  const [state, setState] = useState<LapRulesStateDto | null>(null);
  const [draft, setDraft] = useState<LapRulesConfig | null>(null);
  const [tracks, setTracks] = useState<TrackListItemDto[]>([]);
  const [preview, setPreview] = useState<RevalidationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addTrack, setAddTrack] = useState('');

  useEffect(() => {
    adminApi.lapRules().then((s) => { setState(s); setDraft(s.config); }, (e: Error) => setError(tm(e.message)));
    api.tracks().then(setTracks, () => undefined);
  }, []);

  const all = useMemo(() => ({ ...(state?.builtins ?? {}), ...(draft?.profiles ?? {}) }), [state, draft]);
  if (error) return <p className="warn">{t('No se pudieron cargar las reglas:')} {error}</p>;
  if (!state || !draft) return <p className="empty">{t('Cargando…')}</p>;

  const dirty = !same(draft, state.config);
  const custom = Object.entries(draft.profiles);
  const inUse = (id: string) => draft.default === id || Object.values(draft.tracks).includes(id);
  const trackKey = (t: { track: string; layout: string }) => `${t.track}|${t.layout}`;
  const available = tracks.filter((t) => !(trackKey(t) in draft.tracks));
  const profileOptions = Object.entries(all).map(([id, p]) => <option key={id} value={id}>{p.name}</option>);
  const labelOf = (key: string) => { const [track, layout = ''] = key.split('|'); return trackName(track!, layout); };

  const setProfile = (id: string, p: RuleProfile) => { setDraft({ ...draft, profiles: { ...draft.profiles, [id]: p } }); setPreview(null); };
  const createProfile = () => {
    const base = all[draft.default] ?? Object.values(state.builtins)[0]!;
    const id = `perfil-${Date.now().toString(36)}`;
    setDraft({ ...draft, profiles: { ...draft.profiles, [id]: { name: t('Perfil nuevo'), rules: structuredClone(base.rules) } } });
    setPreview(null);
  };
  const removeProfile = (id: string) => { const { [id]: _gone, ...rest } = draft.profiles; setDraft({ ...draft, profiles: rest }); setPreview(null); };
  const assign = (key: string, id: string) => { setDraft({ ...draft, tracks: { ...draft.tracks, [key]: id } }); setPreview(null); };
  const unassign = (key: string) => { const { [key]: _gone, ...rest } = draft.tracks; setDraft({ ...draft, tracks: rest }); setPreview(null); };

  const save = () => run(async () => { const s = await adminApi.saveLapRules(draft); setState(s); setDraft(s.config); return { ok: true }; }, t('Reglas guardadas: valen para las próximas vueltas'));
  const test = () => run(async () => { setPreview(await adminApi.previewLapRules(draft)); return { ok: true }; }, t('Prueba hecha sobre el historial; no se ha cambiado nada'));
  const saveAndApply = () => run(async () => {
    const s = await adminApi.saveLapRules(draft);
    setState(s); setDraft(s.config);
    setPreview(await adminApi.applyLapRules());
    return { ok: true };
  }, t('Reglas guardadas y historial recalculado'));

  return (
    <>
      <PendingLapsCard />
      <Card title={t('Perfil por defecto')}>
        <p className="hint">{t('Un perfil es un conjunto de reglas que decide cuándo se anula una vuelta. Este es el que se usa en los circuitos que no tengan uno propio. Con «Solo cortes», Howler se comporta como hasta ahora.')}</p>
        <Field label={t('Perfil')} hint={describeRules((all[draft.default] ?? Object.values(state.builtins)[0]!).rules)}>
          <select value={draft.default} onChange={(e) => { setDraft({ ...draft, default: e.target.value }); setPreview(null); }}>{profileOptions}</select>
        </Field>
      </Card>

      <Card title={t('Perfiles')} aside={<button type="button" className="btn small" onClick={createProfile}>{t('+ Crear perfil')}</button>}>
        <ul className="profile-list">
          {Object.entries(state.builtins).map(([id, p]) => (
            <li key={id}><strong>{tm(p.name)}</strong> <span className="badge">{t('Predefinido')}</span><p className="hint">{tm(p.description ?? '')} <span className="muted">({describeRules(p.rules)})</span></p></li>
          ))}
          {custom.map(([id, p]) => (
            <li key={id}>
              <ProfileEditor profile={p} onChange={(next) => setProfile(id, next)} />
              <div className="actions">
                <ConfirmButton danger label={t('Borrar este perfil')} confirmLabel={t('Pulsa otra vez para borrar')} disabled={inUse(id)} onConfirm={() => removeProfile(id)} />
                {inUse(id) && <span className="hint">{t('Está en uso: cámbialo en el perfil por defecto o en los circuitos antes de borrarlo.')}</span>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('Por circuito')}>
        <p className="hint">{t('Un circuito puede usar un perfil distinto al de por defecto (por ejemplo, uno más estricto en un circuito con muchos atajos).')}</p>
        {Object.entries(draft.tracks).length === 0 && <p className="muted">{t('Ningún circuito tiene perfil propio: todos usan el perfil por defecto.')}</p>}
        <ul className="track-rules">
          {Object.entries(draft.tracks).map(([key, id]) => (
            <li key={key}>
              <span className="driver">{labelOf(key)}</span>
              <select value={id} aria-label={t('Perfil de {name}', { name: labelOf(key) })} onChange={(e) => assign(key, e.target.value)}>{profileOptions}</select>
              <button type="button" className="btn small" onClick={() => unassign(key)}>{t('Quitar')}</button>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <div className="actions">
            <select value={addTrack} aria-label={t('Circuito al que dar un perfil propio')} onChange={(e) => setAddTrack(e.target.value)}>
              <option value="">{t('Elige un circuito…')}</option>
              {available.map((t) => <option key={trackKey(t)} value={trackKey(t)}>{trackName(t.track, t.layout)}</option>)}
            </select>
            <button type="button" className="btn small" disabled={!addTrack} onClick={() => { assign(addTrack, draft.default); setAddTrack(''); }}>{t('Dar perfil propio')}</button>
          </div>
        )}
      </Card>

      <Card title={t('Probar y aplicar')}>
        <p className="hint">
          {t('Probar enseña cuántas vueltas del historial cambiarían con las reglas que has puesto, sin tocar nada. Guardar las deja para las vueltas nuevas; guardar y recalcular además vuelve a juzgar todas las vueltas guardadas. Las vueltas que anulaste o restauraste a mano no se tocan.')}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={test}>{t('Probar con el historial')}</button>
          <button type="button" className="btn" disabled={!dirty} onClick={save}>{t('Guardar')}</button>
          <ConfirmButton label={t('Guardar y recalcular el historial')} confirmLabel={t('Pulsa otra vez para recalcular')} onConfirm={saveAndApply} />
          {dirty && <span className="hint">{t('Hay cambios sin guardar.')}</span>}
        </div>
        <Notice notice={notice} />
        {preview && <RevalidationResult r={preview} />}
      </Card>

      <RecentLapsCard />
    </>
  );
}
