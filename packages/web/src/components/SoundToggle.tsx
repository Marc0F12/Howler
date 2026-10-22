import { useSyncExternalStore } from 'react';
import { setSoundEnabled, soundEnabled, subscribeSound } from '../sound';
import { t } from '../i18n';
import { VolumeControl } from './VolumeControl';

/** Botón de silencio del aviso de récord. Activarlo también «desbloquea» el audio del navegador. */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, soundEnabled, () => false);
  const label = on ? t('Sonido activado: pulsa para silenciar') : t('Sonido silenciado: pulsa para activar el aviso de récord');
  return (
    <span className="sound-ctl">
      <button type="button" className="icon-btn sound-toggle" aria-pressed={on} aria-label={label} title={label} onClick={() => setSoundEnabled(!on)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
          {on ? <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a8 8 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
        </svg>
      </button>
      {on && <VolumeControl />}
    </span>
  );
}

