import { api, useLive } from '../api';
import { CupDetail } from '../components/cup/CupDetail';
import { t } from '../i18n';

/** Un campeonato: participantes, carrusel de carreras y el detalle de la carrera elegida. */
export function ChampionshipPage({ id }: { id: number }) {
  const { data: c, error } = useLive(() => api.championship(id), [id], (e) => e.type === 'lap' || e.type === 'results');
  if (error && !c) return <p className="empty">{t('No encuentro este campeonato.')} <a href="#/championships">{t('Ver todos')}</a></p>;
  if (!c) return <p className="empty">{t('Cargando…')}</p>;
  return <CupDetail key={c.id} c={c} />;
}
