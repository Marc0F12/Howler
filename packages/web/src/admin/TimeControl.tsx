import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { dayOfYear } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentCard } from '../content';
import { SunScene } from '../components/SunScene';
import { adminApi } from './adminApi';
import { Field, type NoticeRunner } from './ui';

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2])) : null;
};

/**
 * Hora del servidor: un deslizador para ajustar a ojo y una casilla para escribir la hora exacta.
 * Los dos están sincronizados; la hora no cambia en el servidor hasta pulsar «Aplicar».
 */
export function TimeControl({ enabled, run }: { enabled: boolean; run: NoticeRunner }) {
  const [minutes, setMinutes] = useState(12 * 60);
  const [typed, setTyped] = useState('12:00');
  const session = useLive(api.status, [], (e) => e.type !== 'lap').data?.session;
  const card = useContentCard('track', session?.track, session?.layout ?? '');
  const day = dayOfYear(new Date());

  // Arranca en la hora que tiene ahora el servidor, si se puede saber.
  useEffect(() => {
    if (!enabled) return;
    adminApi.currentTime().then((r) => {
      const m = r.time ? toMinutes(r.time) : null;
      if (m !== null) { setMinutes(m); setTyped(toTime(m)); }
    }, () => undefined);
  }, [enabled]);

  const fromSlider = (m: number) => { setMinutes(m); setTyped(toTime(m)); };
  const fromTyped = (v: string) => {
    setTyped(v);
    const m = toMinutes(v);
    if (m !== null) setMinutes(m);
  };

  return (
    <>
    <SunScene geo={card?.geo ?? { lat: 45, lon: 0 }} generic={!card?.geo} minutes={minutes} day={day} />
    <Field label={t('Hora del servidor')} hint={t('Se cambia al instante, sin reiniciar. Ajusta con el deslizador o escribe la hora exacta.')}>
      <span className="time-big" aria-live="polite">{toTime(minutes)}</span>
      <input
        type="range"
        className="time-slider"
        min={0}
        max={1439}
        step={5}
        value={minutes}
        onChange={(e) => fromSlider(Number(e.target.value))}
        aria-label={t('Hora del día')}
      />
      <input type="time" value={typed} onChange={(e) => fromTyped(e.target.value)} aria-label={t('Escribir la hora')} />
      <button type="button" className="btn" disabled={!enabled || toMinutes(typed) === null} onClick={() => run(() => adminApi.control.time(toTime(minutes)), t('Hora cambiada'))}>
        {t('Aplicar')}
      </button>
    </Field>
    </>
  );
}
