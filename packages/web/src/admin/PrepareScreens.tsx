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

/** Cabecera de una pantalla de «Preparar»: título, icono y para qué sirve. */
function Screen({ id, icon, title, hint, children }: { id: string; icon: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} className="sx-block" aria-labelledby={`${id}-h`}>
      <header className="sx-head">
        <h2 id={`${id}-h`}><Icon name={icon} size={24} />{title}</h2>
        <p className="sx-hint">{hint}</p>
      </header>
      {children}
    </section>
  );
}

const isRunning = (state: AdminStateDto) => state.server.state !== 'stopped';

/** Preparar → Circuito y coches: dónde se corre y con qué coches. */
export function CarsScreen({ state }: { state: AdminStateDto }) {
  return (
    <Screen id="sx-cars" icon="cars" title={t('Circuito y coches')} hint={t('Dónde se corre y con qué coches. Se aplica al reiniciar el servidor.')}>
      <EntryListCard running={isRunning(state)} />
    </Screen>
  );
}

/** Preparar → Sesión: cuánto dura cada sesión, condiciones, ayudas, neumáticos y reglas de carrera. */
export function SessionScreen({ state }: { state: AdminStateDto }) {
  return (
    <Screen id="sx-session" icon="sessions" title={t('Sesión')} hint={t('Cuánto dura cada sesión, las condiciones, las ayudas y las reglas de carrera.')}>
      <SessionPanel running={isRunning(state)} preset={state.settings.server.preset} />
    </Screen>
  );
}

/** Preparar → Clima: cómo se elige el clima y qué climas tiene el servidor. */
export function WeatherScreen({ state }: { state: AdminStateDto }) {
  const [epoch, setEpoch] = useState(0);
  const running = isRunning(state);
  return (
    <Screen id="sx-weather" icon="cloudy" title={t('Clima')} hint={t('Cómo se elige el clima y qué climas tiene el servidor. El clima de este momento se cambia en «En directo».')}>
      <WeatherModeCard key={epoch} running={running} onChanged={() => setEpoch((n) => n + 1)} />
      <WeatherListEditor key={epoch} running={running} />
    </Screen>
  );
}

/** Preparar → Comprobaciones: contraseña, ajustes automáticos según circuito y coches, y archivos de los coches. */
export function ChecksScreen({ state }: { state: AdminStateDto }) {
  const running = isRunning(state);
  return (
    <Screen id="sx-server" icon="server" title={t('Comprobaciones')} hint={t('Contraseña del servidor, ajustes automáticos según el circuito y los coches, y archivos de los coches (data.acd).')}>
      <PasswordCard running={running} />
      <SmartSettingsCard running={running} onChanged={() => undefined} />
      <CarChecksumsCard running={running} />
    </Screen>
  );
}
