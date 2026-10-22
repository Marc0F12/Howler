import { useMemo } from 'react';
import type { StatusDto } from '@howler/shared';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { PageModules } from '../modules/PageModules';

/**
 * Inicio: la última sesión (la que está en curso o, si no hay, la más reciente). Qué módulos salen, en qué orden y de qué
 * tamaño lo decide la disposición de la página «home» (de serie: mapa y podio arriba, clasificación y rey de la colina debajo).
 */
export function HomePage({ status }: { status: StatusDto | null }) {
  const timing = useLive(api.timing, [], (e) => e.type !== 'server');
  const data = timing.data;
  const session = data?.session ?? null;
  const live = !!session && !!status?.acConnected && status.session?.id === session.id;
  const cars = useMemo(() => [...new Set((Array.isArray(data?.rows) ? data.rows : []).map((r) => r.car).filter(Boolean))], [data]);

  if (timing.error && !data) return <p className="empty">{t('No se pudo cargar la sesión.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  if (!session) return <p className="empty">{t('Todavía no ha habido ninguna sesión. Cuando alguien corra en el servidor, aparecerá aquí.')}</p>;
  return <PageModules page="home" ctx={{ kind: 'session', variant: 'home', data, session, live, status, cars }} />;
}
