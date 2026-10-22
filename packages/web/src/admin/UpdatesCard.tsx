import { useEffect } from 'react';
import type { UpdateStateDto } from '@howler/shared';
import { ago } from '../format';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { UpdateActions } from './UpdateBanner';
import { Card, Field, Notice, useNotice } from './ui';

/** Ajustes → Actualizaciones: versión actual, buscar, instalar aunque se haya pospuesto, y cuándo y de dónde comprobar. */
export function UpdatesCard({ s, onChange }: { s: UpdateStateDto; onChange: (s: UpdateStateDto) => void }) {
  const { notice, run } = useNotice();
  // Mientras se descarga, se pregunta por el avance.
  useEffect(() => {
    if (s.install.state !== 'downloading') return;
    const timer = window.setInterval(() => void adminApi.update().then(onChange).catch(() => undefined), 1000);
    return () => window.clearInterval(timer);
  }, [s.install.state, onChange]);
  return (
    <Card title={t('Actualizaciones')} aside={s.available ? <span className={`pill ${s.dismissed ? '' : 'ok'}`}>{t('Nueva versión: {v}', { v: s.latest!.version })}</span> : undefined}>
      <p>{t('Versión instalada: {v}', { v: s.current })} · <span className="muted">{s.checkedAt ? t('comprobado {ago}', { ago: ago(s.checkedAt) }) : t('aún sin comprobar')}</span></p>
      {s.error && <p className="warn">{tm(s.error)}</p>}
      {!s.available && s.checkedAt && !s.error && <p className="muted">{t('Tienes la última versión.')}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={s.checking} onClick={() => run(async () => onChange(await adminApi.checkUpdate()), t('Comprobado.'))}>{s.checking ? t('Comprobando…') : t('Buscar actualizaciones')}</button>
      </div>
      {s.available && s.latest && (
        <>
          <h4>{t('Novedades de la {v}', { v: s.latest.version })}</h4>
          <UpdateActions s={s} onChange={onChange} allowLater={false} />
        </>
      )}
      <Notice notice={notice} />
      <Field label={t('Avisar de versiones nuevas')} hint={t('Howler mira en GitHub cada pocas horas si hay una versión nueva. No manda ningún dato tuyo.')}>
        <input type="checkbox" checked={s.settings.check} onChange={(e) => run(async () => onChange(await adminApi.updateSettings({ check: e.target.checked })), t('Guardado.'))} />
      </Field>
      <Field label={t('Canal')} hint={t('«Estable» solo avisa de versiones probadas. «Beta» también de las previas, con novedades antes pero más fallos.')}>
        <select value={s.settings.channel} onChange={(e) => run(async () => onChange(await adminApi.updateSettings({ channel: e.target.value as 'stable' | 'beta' })), t('Guardado.'))}>
          <option value="stable">{t('Estable')}</option><option value="beta">Beta</option>
        </select>
      </Field>
    </Card>
  );
}
