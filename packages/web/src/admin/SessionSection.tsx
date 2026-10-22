import { useState, type ReactNode } from 'react';
import type { AdminStateDto } from '@howler/shared';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { WeatherListEditor } from './WeatherListEditor';
import { EntryListCard } from './EntryListCard';
import { CarChecksumsCard } from './CarChecksumsCard';
import { WeatherModeCard } from './WeatherModeCard';
import { SmartSettingsCard } from './SmartSettingsCard';
import { PasswordCard } from './PasswordCard';
import { SessionPanel } from './SessionPanel';

/** Un bloque de la página con título, icono y un ancla para saltar a él desde la barra de arriba. */
function Block({ id, icon, title, hint, children }: { id: string; icon: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} className="sx-block" aria-labelledby={`${id}-h`}>
      <header className="sx-head">
        <h2 id={`${id}-h`}><Icon name={icon} size={26} />{title}</h2>
        <p className="sx-hint">{hint}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * «Sesión y clima», en el orden en que se usa: primero el circuito y los coches (lo que más se toca), luego cómo es la sesión,
 * el clima y, al final, el acceso al servidor y sus comprobaciones. La barra de arriba salta a cada bloque.
 */
export function SessionSection({ state }: { state: AdminStateDto }) {
  const [wxEpoch, setWxEpoch] = useState(0);
  const running = state.server.state !== 'stopped';
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  const blocks: { id: string; icon: string; label: string }[] = [
    { id: 'sx-cars', icon: 'cars', label: t('Circuito y coches') },
    { id: 'sx-session', icon: 'sessions', label: t('Sesión') },
    { id: 'sx-weather', icon: 'cloudy', label: t('Clima') },
    { id: 'sx-server', icon: 'server', label: t('Acceso y comprobaciones') },
  ];
  return (
    <div className="sx">
      <nav className="sx-nav" aria-label={t('Ir a')}>
        {blocks.map((b) => <a key={b.id} href={`#${b.id}`} onClick={go(b.id)}><Icon name={b.icon} size={18} />{b.label}</a>)}
      </nav>

      <Block id="sx-cars" icon="cars" title={t('Circuito y coches')} hint={t('Dónde se corre y con qué coches. Se aplica al reiniciar el servidor.')}>
        <EntryListCard running={running} />
      </Block>

      <Block id="sx-session" icon="sessions" title={t('Sesión')} hint={t('Cuánto dura cada sesión, las condiciones, las ayudas y las reglas de carrera.')}>
        <SessionPanel running={running} preset={state.settings.server.preset} />
      </Block>

      <Block id="sx-weather" icon="cloudy" title={t('Clima')} hint={t('Cómo se elige el clima y qué climas tiene el servidor. El clima en directo está en «En directo».')}>
        <WeatherModeCard key={wxEpoch} running={running} onChanged={() => setWxEpoch((n) => n + 1)} />
        <WeatherListEditor key={wxEpoch} running={running} />
      </Block>

      <Block id="sx-server" icon="server" title={t('Acceso y comprobaciones')} hint={t('Contraseña, ajustes automáticos según el circuito y los coches, y archivos de los coches.')}>
        <PasswordCard running={running} />
        <SmartSettingsCard running={running} onChanged={() => setWxEpoch((n) => n + 1)} />
        <CarChecksumsCard running={running} />
      </Block>
    </div>
  );
}
