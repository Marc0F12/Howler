import { api, useLive } from '../api';
import { CupList } from '../components/cup/CupList';
import { t } from '../i18n';

/** Lista de campeonatos (activos y pasados). */
export function ChampionshipsPage() {
  const { data, error } = useLive(api.championships, [], (e) => e.type === 'lap' || e.type === 'results');
  if (error && !data) return <p className="empty">{t('No se pudieron cargar los campeonatos.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  return <CupList list={data} />;
}
