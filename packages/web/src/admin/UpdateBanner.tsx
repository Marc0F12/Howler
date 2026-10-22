import type { UpdateStateDto } from '@howler/shared';
import { Markdown } from '../components/Markdown';
import { fmtDate } from '../format';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { ConfirmButton, Notice, useNotice } from './ui';

/** Notas del parche y los botones para instalar o seguir con la versión actual. Lo usan el aviso de arriba y la tarjeta de Ajustes. */
export function UpdateActions({ s, onChange, allowLater }: { s: UpdateStateDto; onChange: (s: UpdateStateDto) => void; allowLater: boolean }) {
  const { notice, run } = useNotice();
  const latest = s.latest!;
  const busy = s.install.state === 'downloading';
  return (
    <>
      {latest.notes && <div className="update-notes"><Markdown text={latest.notes} /></div>}
      <div className="row">
        {latest.installable ? (
          <ConfirmButton label={t('Actualizar')} confirmLabel={t('Seguro: descargar, cerrar Howler e instalar')} disabled={busy}
            onConfirm={() => run(async () => onChange(await adminApi.applyUpdate()), t('Descargando la actualización…'))} />
        ) : (
          <a className="btn primary" href={latest.url} target="_blank" rel="noopener noreferrer">{t('Descargar desde GitHub')}</a>
        )}
        {allowLater && <button type="button" className="btn" onClick={() => run(async () => onChange(await adminApi.dismissUpdate(latest.version)), t('De acuerdo: seguirás con la versión actual. Podrás actualizar cuando quieras desde Ajustes.'))}>{t('Ahora no')}</button>}
        <a className="btn link" href={latest.url} target="_blank" rel="noopener noreferrer">{t('Ver en GitHub')}</a>
      </div>
      {latest.installable && <p className="muted">{t('Se descarga el instalador, se comprueba y se abre; Howler se cierra para que pueda sustituirse. Si Howler arrancó el servidor de AC, se avisa a los jugadores y se para antes.')}</p>}
      {busy && <progress value={s.install.percent} max={100} aria-label={t('Progreso de la descarga')} />}
      {s.install.state === 'ready' && <p className="notice ok" role="status">{t('Descargado y comprobado. Se abrirá el instalador.')}</p>}
      {s.install.state === 'error' && s.install.error && <p className="notice bad" role="status">{tm(s.install.error)}</p>}
      <Notice notice={notice} />
    </>
  );
}

/** Aviso grande arriba del panel cuando hay una versión nueva que aún no has pospuesto: qué trae y dos botones, Actualizar o Ahora no. */
export function UpdateBanner({ s, onChange }: { s: UpdateStateDto; onChange: (s: UpdateStateDto) => void }) {
  if (!s.available || s.dismissed || !s.latest) return null;
  return (
    <section className="card update-banner" role="region" aria-label={t('Nueva versión disponible')}>
      <header className="card-head">
        <h3>{t('Hay una nueva versión disponible, incluye:')}</h3>
        <span className="muted">{t('Versión {n} · tienes la {v} · publicada el {date}', { n: s.latest.version, v: s.current, date: fmtDate(s.latest.publishedAt || null) })}</span>
      </header>
      <div className="card-body">
        <UpdateActions s={s} onChange={onChange} allowLater />
      </div>
    </section>
  );
}
