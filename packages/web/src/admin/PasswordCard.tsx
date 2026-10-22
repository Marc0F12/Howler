import { useEffect, useState } from 'react';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { Card, Field, Notice, useNotice } from './ui';

/** Contraseña de ocho caracteres fáciles de dictar (sin 0/O ni 1/l/I). */
function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Contraseña para entrar al servidor (`PASSWORD` del preset). Vacía = servidor abierto. El servidor la lee al arrancar,
 * así que hay que reiniciarlo para que se aplique.
 */
export function PasswordCard({ running }: { running: boolean }) {
  const { notice, run } = useNotice();
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.serverPassword().then((r) => { setSaved(r.password); setValue(r.password); setError(null); }, (e: Error) => setError(tm(e.message)));
  }, []);

  if (error) return <Card title={t('Contraseña del servidor')}><p className="warn">{error}</p></Card>;
  if (saved === null) return null;

  const dirty = value !== saved;
  const save = (applyAndRestart: boolean, next = value) =>
    run(async () => {
      const r = await adminApi.saveServerPassword(next, applyAndRestart);
      setSaved(r.password);
      setValue(r.password);
      return { ok: true, reply: r.restarting ? t('Reiniciando el servidor para aplicarlo…') : running ? t('Se aplicará la próxima vez que reinicies el servidor.') : t('Se aplicará al arrancar el servidor.') };
    }, t('Guardado'));

  return (
    <Card title={t('Contraseña del servidor')}>
      <p className="hint">{saved === '' ? t('Ahora el servidor está abierto: entra cualquiera que tenga la dirección.') : t('Ahora el servidor pide contraseña para entrar.')} {t('El servidor la lee al arrancar: «Guardar y reiniciar» lo hace por ti, avisando a los jugadores.')}</p>
      <Field label={t('Contraseña')} hint={t('Déjala vacía para quitarla. No puede empezar ni acabar con espacios.')}>
        <span className="row-inline">
          <input type={show ? 'text' : 'password'} value={value} maxLength={64} autoComplete="off" spellCheck={false} onChange={(e) => setValue(e.target.value)} />
          <button type="button" className="btn small" onClick={() => setShow(!show)} aria-pressed={show}>{show ? t('Ocultar') : t('Mostrar')}</button>
          <button type="button" className="btn small" onClick={() => { setValue(randomPassword()); setShow(true); }}>{t('Generar')}</button>
        </span>
      </Field>
      <div className="actions">
        <button type="button" className="btn" disabled={!dirty} onClick={() => save(false)}>{t('Guardar')}</button>
        <button type="button" className="btn primary" disabled={!dirty || !running} onClick={() => save(true)} title={running ? undefined : t('El servidor está parado: se aplicará al arrancarlo')}>{t('Guardar y reiniciar el servidor')}</button>
        {saved !== '' && <button type="button" className="btn" onClick={() => { if (window.confirm(t('¿Quitar la contraseña? Cualquiera con la dirección podrá entrar.'))) void save(false, ''); }}>{t('Quitar contraseña')}</button>}
      </div>
      <Notice notice={notice} />
    </Card>
  );
}
