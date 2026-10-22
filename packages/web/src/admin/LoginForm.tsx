import { useState } from 'react';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { Card } from './ui';

/** Acceso remoto al panel: usuario y contraseña de una cuenta creada por el administrador (en el panel del propio PC). */
export function LoginForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await adminApi.login(name, password); onDone(); } catch (err) { setError(tm((err as Error).message)); } finally { setBusy(false); }
  };

  return (
    <form className="login-form" onSubmit={submit}>
      <Card title={t('Entrar al panel')}>
        <p className="hint">{t('Usa la cuenta que te dio el administrador de Howler.')}</p>
        <label className="field">
          <span className="field-label">{t('Usuario')}</span>
          <span className="field-control"><input type="text" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></span>
        </label>
        <label className="field">
          <span className="field-label">{t('Contraseña')}</span>
          <span className="field-control"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></span>
        </label>
        {error && <p className="notice bad" role="alert">{error}</p>}
        <p><button type="submit" className="btn primary" disabled={busy || name === '' || password === ''}>{t('Entrar')}</button></p>
      </Card>
    </form>
  );
}
