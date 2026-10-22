import { formatDay, timeOf } from '../format';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackupStateDto } from '@howler/shared';
import { t } from '../i18n';
import { adminGet, adminPost, adminPut, adminDelete } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const mb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = (iso: string) => `${formatDay(new Date(iso), { month: 'short', year: true })} ${timeOf(new Date(iso))}`;

/** Subir una copia como cuerpo binario (la ruta valida el contenido entero antes de aceptarla). */
const uploadBackup = (file: File) =>
  fetch('/admin/api/backup/restore/upload', { method: 'POST', headers: { 'Content-Type': 'application/x-howler-backup', 'X-Howler-Admin': '1' }, body: file })
    .then(async (r) => { const j = (await r.json().catch(() => null)) as (BackupStateDto & { error?: string }) | null; if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`); return j as BackupStateDto; });

/** Copias de seguridad de los datos, restauración y exportación de los tiempos. */
export function BackupSection() {
  const [st, setSt] = useState<BackupStateDto | null>(null);
  const { notice, run } = useNotice();
  const [busy, setBusy] = useState(false);
  const [onlyValid, setOnlyValid] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => adminGet<BackupStateDto>('/admin/api/backup').then(setSt, () => setSt(null)), []);
  useEffect(() => { void load(); }, [load]);
  const act = (action: () => Promise<BackupStateDto | unknown>, ok: string) => run(async () => {
    setBusy(true);
    try { const r = await action(); if (r && typeof r === 'object' && 'backups' in r) setSt(r as BackupStateDto); else await load(); return { ok: true }; }
    finally { setBusy(false); }
  }, ok);

  if (!st) return <p className="empty">{t('Cargando…')}</p>;
  const saveSettings = (patch: Partial<BackupStateDto['settings']>) => void act(() => adminPut<BackupStateDto>('/admin/api/backup/settings', { ...st.settings, ...patch }), t('Guardado.'));
  const { auto, everyDays, keep } = st.settings;

  return (
    <>
      {st.pending && (
        <section className="warn" role="status">
          <b>{t('Hay una copia lista para restaurar')}</b>
          <p className="hint">
            {t('Creada el {date} con Howler {v}. Se aplicará al volver a abrir Howler; lo que hay ahora se guarda aparte en la carpeta «antes-de-restaurar» de los datos.', { date: when(st.pending.createdAt), v: st.pending.howlerVersion })}
          </p>
          <div className="actions">
            <ConfirmButton label={t('Cerrar Howler para aplicarla')} confirmLabel={t('Confirmar: se cerrará Howler')} danger
              onConfirm={() => act(() => adminPost('/admin/api/backup/restart'), t('Cerrando Howler… Vuelve a abrirlo para terminar la restauración.'))} />
            <button type="button" className="btn" disabled={busy} onClick={() => void act(() => adminPost<BackupStateDto>('/admin/api/backup/restore/cancel'), t('Restauración cancelada.'))}>{t('Cancelar')}</button>
          </div>
        </section>
      )}

      <Card title={t('Copias de seguridad')} aside={<button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => adminPost<BackupStateDto>('/admin/api/backup/create'), t('Copia creada.'))}>{busy ? t('Trabajando…') : t('Crear copia ahora')}</button>}>
        <p className="hint">{t('Una copia guarda todos tus tiempos, pilotos, campeonatos y ajustes de datos en un solo archivo, más las fotos de perfil. Sirve para guardar tus datos antes de un cambio o para llevarlos a otro PC. Ojo: contiene los Steam ID de los pilotos; no la compartas con nadie.')}</p>
        <div className="form-row">
          <label className="check"><input type="checkbox" checked={auto} onChange={(e) => saveSettings({ auto: e.target.checked })} /> {t('Hacer copias automáticas')}</label>
          <label>{t('Cada')} <select value={everyDays} disabled={!auto} onChange={(e) => saveSettings({ everyDays: Number(e.target.value) })}>
            {[1, 2, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n === 1 ? t('día') : t('{n} días', { n })}</option>)}
          </select></label>
          <label>{t('Guardar las últimas')} <select value={keep} disabled={!auto} onChange={(e) => saveSettings({ keep: Number(e.target.value) })}>
            {[3, 5, 7, 10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        </div>
        <p className="hint">{t('Las copias automáticas viejas se borran solas; las que haces tú nunca. Se guardan en la carpeta «backups» de los datos de Howler.')}</p>
        {st.backups.length === 0 ? <p className="empty">{t('Aún no hay copias.')}</p> : (
          <div className="table-scroll">
            <table className="timing">
              <thead><tr><th>{t('Copia')}</th><th>{t('Fecha')}</th><th className="num">{t('Tamaño')}</th><th /></tr></thead>
              <tbody>
                {st.backups.map((b) => (
                  <tr key={b.name}>
                    <td>{b.auto ? t('Automática') : t('Manual')}</td>
                    <td>{when(b.at)}</td>
                    <td className="num">{mb(b.bytes)}</td>
                    <td className="row-actions">
                      <a className="btn small" href={`/admin/api/backup/files/${encodeURIComponent(b.name)}`} download={b.name}>{t('Descargar')}</a>
                      <ConfirmButton label={t('Restaurar')} confirmLabel={t('¿Seguro?')} disabled={busy} onConfirm={() => act(() => adminPost<BackupStateDto>(`/admin/api/backup/restore/from/${encodeURIComponent(b.name)}`), t('Copia preparada: ciérrala con el aviso de arriba para aplicarla.'))} />
                      <ConfirmButton label={t('Borrar')} confirmLabel={t('¿Seguro?')} danger disabled={busy} onConfirm={() => act(() => adminDelete<BackupStateDto>(`/admin/api/backup/files/${encodeURIComponent(b.name)}`), t('Copia borrada.'))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-row">
          <input ref={file} type="file" accept=".howler-backup" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void act(() => uploadBackup(f), t('Copia comprobada y preparada: ciérrala con el aviso de arriba para aplicarla.'));
          }} />
          <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>{t('Restaurar desde un archivo…')}</button>
          <span className="muted">{t('Se comprueba entera antes de aceptarla y no cambia nada hasta que cierres y vuelvas a abrir Howler.')}</span>
        </div>
        <Notice notice={notice} />
      </Card>

      <Card title={t('Exportar los tiempos')}>
        <p className="hint">{t('Descarga todas las vueltas en una tabla para abrirla en Excel u otra herramienta. No lleva Steam ID, solo el nombre de cada piloto.')}</p>
        <div className="form-row">
          <label className="check"><input type="checkbox" checked={onlyValid} onChange={(e) => setOnlyValid(e.target.checked)} /> {t('Solo vueltas válidas')}</label>
          <a className="btn" href={`/admin/api/export/laps?format=csv&valid=${onlyValid ? 1 : 0}`} download>{t('Descargar CSV (Excel)')}</a>
          <a className="btn" href={`/admin/api/export/laps?format=json&valid=${onlyValid ? 1 : 0}`} download>{t('Descargar JSON')}</a>
        </div>
      </Card>
    </>
  );
}
