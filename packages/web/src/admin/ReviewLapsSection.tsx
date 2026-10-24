import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { PendingLapsCard } from './PendingLapsCard';
import { RecentLapsCard } from './RecentLapsCard';

/** Revisar vueltas: la bandeja de moderación (salidas de boxes pendientes y últimas vueltas). Las reglas que deciden qué vale están en Competición. */
export function ReviewLapsSection() {
  return (
    <div className="sx">
      <section className="sx-block" aria-labelledby="rv-h">
        <header className="sx-head">
          <h2 id="rv-h"><Icon name="lap-pending" size={24} />{t('Revisar vueltas')}</h2>
          <p className="sx-hint">{t('Aprueba o anula las vueltas dudosas y mira las últimas. Qué vueltas valen se decide en Competición → Reglas de vuelta.')}</p>
        </header>
        <PendingLapsCard />
        <RecentLapsCard />
      </section>
    </div>
  );
}
