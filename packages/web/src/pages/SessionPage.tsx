import { useMemo } from 'react';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { PageModules } from '../modules/PageModules';

/** Una sesión concreta del historial: sus módulos (cabecera, podio, clasificación, rey de la colina) según la disposición de la página «session». */
export function SessionPage({ id }: { id: number }) {
  const timing = useLive(() => api.sessionTiming(id), [id], (e) => e.type === 'lap' || e.type === 'results' || e.type === 'session');
  const data = timing.data;
  const cars = useMemo(() => [...new Set((Array.isArray(data?.rows) ? data.rows : []).map((r) => r.car).filter(Boolean))], [data]);

  if (timing.error && !data) return <p className="empty">{t('No encuentro esa sesión.')} <a href="#/sessions">{t('Ver el historial')}</a></p>;
  if (!data || !data.session) return <p className="empty">{t('Cargando…')}</p>;
  return (
    <>
      <PageModules page="session" ctx={{ kind: 'session', variant: 'history', data, session: data.session, live: false, status: null, cars }} />
      {data.rows.length === 0 && <p className="empty">{t('Nadie dio vueltas en esta sesión.')}</p>}
    </>
  );
}
