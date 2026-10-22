import { useEffect, useState } from 'react';
import { ACCOUNT_ROLES, MIN_PASSWORD, type AccountDto, type AccountRole, type AccountsStateDto } from '@howler/shared';
import { t } from '../i18n';
import { formatDay } from '../format';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Field, Notice, useNotice } from './ui';

const roleLabel = (r: AccountRole) => ({ admin: t('Administrador'), moderator: t('Moderador'), viewer: t('Solo ver') })[r];
const roleHint = (r: AccountRole) => ({
  admin: t('Todo el panel, salvo los ajustes del programa, las copias, las actualizaciones y las cuentas (eso solo desde este PC).'),
  moderator: t('Control en directo (chat, expulsar, clima…), penalizaciones y revisar vueltas. No toca ajustes ni archivos.'),
  viewer: t('Solo mira: estado del servidor, vueltas y penalizaciones.'),
})[r];

/** Contraseña aleatoria de 16 caracteres (sin letras que se confunden entre sí). */
function generatePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

/** Ajustes → Cuentas: quién puede entrar al panel desde otros equipos. Solo se gestiona desde el propio PC de Howler. */
export function AccountsSection() {
  const [state, setState] = useState<AccountsStateDto | null>(null);
  const [form, setForm] = useState({ name: '', password: '', role: 'moderator' as AccountRole });
  const [editing, setEditing] = useState<{ id: string; password: string } | null>(null);
  const { notice, run } = useNotice();

  useEffect(() => { adminApi.accounts().then(setState, () => undefined); }, []);
  const apply = (action: () => Promise<AccountsStateDto>, done: string) => run(async () => { setState(await action()); return { ok: true }; }, done);

  const create = async () => {
    if (await apply(() => adminApi.addAccount(form), t('Cuenta creada'))) setForm({ name: '', password: '', role: form.role });
  };
  const savePassword = async () => {
    if (editing && (await apply(() => adminApi.updateAccount(editing.id, { password: editing.password }), t('Contraseña cambiada; se cerró la sesión de esa cuenta')))) setEditing(null);
  };
  const toggleRemote = (enabled: boolean) =>
    run(async () => { setState(await adminApi.setRemoteAccess(enabled)); return { ok: true }; },
      enabled ? t('Acceso remoto activado. Cierra y vuelve a abrir Howler para que empiece a funcionar.') : t('Acceso remoto apagado. Cierra y vuelve a abrir Howler para que deje de escuchar fuera.'));

  const firewallCmd = `New-NetFirewallRule -DisplayName 'Howler panel ${state?.port ?? 8421}' -Direction Inbound -Protocol TCP -LocalPort ${state?.port ?? 8421} -Action Allow`;
  return (
    <>
      <Card title={t('Acceso desde otros equipos')}>
        <p className="hint">
          {t('Por defecto el panel solo se abre en este PC, sin contraseña. Si activas el acceso remoto, desde cualquier otro equipo hará falta una de las cuentas de abajo; en este PC sigue sin contraseña.')}
        </p>
        <p>
          <strong>{state?.remoteEnabled ? t('Activado') : t('Apagado')}</strong>{' '}
          <button type="button" className="btn" disabled={!state || (!state.remoteEnabled && state.accounts.length === 0)} onClick={() => toggleRemote(!state?.remoteEnabled)}>
            {state?.remoteEnabled ? t('Apagar el acceso remoto') : t('Activar el acceso remoto')}
          </button>
        </p>
        {state && !state.remoteEnabled && state.accounts.length === 0 && <p className="hint">{t('Crea primero una cuenta: sin cuentas nadie podría entrar desde fuera.')}</p>}
        <p className="hint">
          {t('Se entra en http://<dirección de este PC>:{port}. Hay que abrir ese puerto en el cortafuegos y, desde internet, en el router. Ojo: por http la contraseña viaja sin cifrar; fuera de tu red local usa un túnel o un proxy con https (Cloudflare Tunnel, Tailscale…).', { port: state?.port ?? 8421 })}
        </p>
        <p className="hint">{t('En Windows, para abrir el puerto en el cortafuegos, copia este comando y ejecútalo en PowerShell como administrador:')}</p>
        <p className="row-actions">
          <code>{firewallCmd}</code>
          <button type="button" className="btn small" onClick={() => { void navigator.clipboard?.writeText(firewallCmd); }}>{t('Copiar')}</button>
        </p>
        <Notice notice={notice} />
      </Card>

      <Card title={t('Cuentas')} aside={state && <span className="muted">{state.accounts.length}</span>}>
        {!state ? <p className="empty">{t('Cargando…')}</p> : state.accounts.length === 0 ? (
          <p className="empty">{t('Todavía no hay cuentas.')}</p>
        ) : (
          <div className="table-scroll">
            <table className="timing">
              <thead><tr><th>{t('Usuario')}</th><th>{t('Rol')}</th><th>{t('Último acceso')}</th><th /></tr></thead>
              <tbody>
                {state.accounts.map((a: AccountDto) => (
                  <tr key={a.id}>
                    <td className="driver">{a.name}</td>
                    <td>
                      <select value={a.role} aria-label={t('Rol')} onChange={(e) => apply(() => adminApi.updateAccount(a.id, { role: e.target.value as AccountRole }), t('Rol cambiado; se cerró la sesión de esa cuenta'))}>
                        {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className="muted">{a.lastLogin ? formatDay(new Date(a.lastLogin), { month: 'short', year: true }) : t('Nunca')}</td>
                    <td className="row-actions">
                      {editing?.id === a.id ? (
                        <>
                          <input type="text" value={editing.password} placeholder={t('Contraseña nueva')} aria-label={t('Contraseña nueva')} onChange={(e) => setEditing({ id: a.id, password: e.target.value })} />
                          <button type="button" className="btn small" onClick={() => setEditing({ id: a.id, password: generatePassword() })}>{t('Generar')}</button>
                          <button type="button" className="btn small primary" disabled={editing.password.length < MIN_PASSWORD} onClick={savePassword}>{t('Guardar')}</button>
                          <button type="button" className="btn small" onClick={() => setEditing(null)}>{t('Cancelar')}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn small" onClick={() => setEditing({ id: a.id, password: '' })}>{t('Cambiar contraseña')}</button>
                          <ConfirmButton danger label={t('Borrar')} confirmLabel={t('¿Borrar?')} onConfirm={() => apply(() => adminApi.deleteAccount(a.id), t('Cuenta borrada'))} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('Nueva cuenta')}>
        <Field label={t('Usuario')} hint={t('De 3 a 32 caracteres: letras, números, punto, guion o guion bajo.')}>
          <input type="text" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('Contraseña')} hint={t('Mínimo {n} caracteres. Apúntala o pásala a la persona: después no se puede ver, solo cambiar.', { n: MIN_PASSWORD })}>
          <input type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="button" className="btn small" onClick={() => setForm({ ...form, password: generatePassword() })}>{t('Generar')}</button>
        </Field>
        <Field label={t('Rol')} hint={roleHint(form.role)}>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AccountRole })}>
            {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </Field>
        <p><button type="button" className="btn primary" disabled={form.name.trim() === '' || form.password.length < MIN_PASSWORD} onClick={create}>{t('Crear cuenta')}</button></p>
      </Card>
    </>
  );
}
