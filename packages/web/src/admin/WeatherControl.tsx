import { t, tm } from '../i18n';
import { useEffect, useState } from 'react';
import { CSP_WEATHER_TYPES, type WeatherStateDto } from '@howler/shared';
import { WeatherIcon, weatherKind } from '../components/weather-icons';
import { setSceneWeather } from '../components/scene-weather';
import { adminApi } from './adminApi';
import type { NoticeRunner } from './ui';

/**
 * Cambio de clima en directo. Con el clima clásico se elige entre los climas de la lista del preset (del sistema
 * que se haya configurado en «Entre sesiones»); con el clima de CSP se elige el tipo y el tiempo de transición.
 */
export function WeatherControl({ enabled, serverState, run }: { enabled: boolean; serverState: string; run: NoticeRunner }) {
  const [wx, setWx] = useState<WeatherStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState(0);
  const [csp, setCsp] = useState('Clear');
  const [transition, setTransition] = useState(30);

  useEffect(() => {
    adminApi.weather().then((w) => { setWx(w); setError(null); setId((cur) => (cur < w.list.length ? cur : 0)); }, (e: Error) => setError(tm(e.message)));
  }, [serverState]);

  // La vista previa del clima vive en el visor de la hora (SunScene): aqui solo se publica lo que se esta eligiendo.
  const curClassic = wx && !wx.fx && wx.list.length > 0 ? (wx.list.find((w) => w.id === id) ?? wx.list[0]!) : null;
  const sceneId = wx?.fx ? csp : curClassic ? `${curClassic.graphics} ${curClassic.name}` : null;
  const sceneLabel = wx?.fx ? tm(CSP_WEATHER_TYPES.find((w) => w.type === csp)?.name ?? csp) : curClassic?.name ?? '';
  useEffect(() => {
    setSceneWeather(sceneId ? { id: sceneId, label: sceneLabel } : null);
    return () => setSceneWeather(null);
  }, [sceneId, sceneLabel]);

  if (error) return <p className="warn">{t('No se pudo leer el clima del preset:')} {error}</p>;
  if (!wx) return <p className="muted">{t('Cargando climas…')}</p>;

  if (wx.fx) {
    return (
      <div className="field">
        <span className="field-label">{t('Clima (CSP)')}</span>
        <span className="field-control wx-groups">
          {[...new Set(CSP_WEATHER_TYPES.map((w) => w.group))].map((g) => (
            <div key={g} className="wx-group">
              <span className="muted">{tm(g)}</span>
              <div className="wx-chips">
                {CSP_WEATHER_TYPES.filter((w) => w.group === g).map((w) => (
                  <button key={w.type} type="button" className="wx-chip" aria-pressed={csp === w.type} onClick={() => setCsp(w.type)}>
                    <WeatherIcon kind={weatherKind(w.type)} size={18} />{tm(w.name)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <span className="row">
            <input type="number" min={0} max={3600} value={transition} onChange={(e) => setTransition(Number(e.target.value))} aria-label={t('Segundos de transición')} />
            <span className="muted">s</span>
            <button type="button" className="btn" disabled={!enabled} onClick={() => run(() => adminApi.control.weather(csp, transition), t('Clima cambiado'))}>{t('Aplicar')}</button>
          </span>
        </span>
        <span className="field-hint">{t('El cambio se hace poco a poco durante el tiempo de transición.')}</span>
      </div>
    );
  }

  const systemLabel = (sys: string) => tm(wx.systems.find((s) => s.id === sys)?.label ?? sys);
  return (
    <>
      <div className="field">
        <span className="field-label">{t('Clima')}</span>
        <span className="field-control wx-groups">
          <div className="wx-chips">
            {wx.list.map((w) => (
              <button key={w.id} type="button" className="wx-chip" aria-pressed={id === w.id} title={systemLabel(w.system)} onClick={() => setId(w.id)}>
                <WeatherIcon kind={weatherKind(`${w.graphics} ${w.name}`)} size={18} />{w.name}
              </button>
            ))}
          </div>
          <span className="row"><button type="button" className="btn" disabled={!enabled || wx.list.length === 0} onClick={() => run(() => adminApi.control.weatherId(id), t('Clima cambiado'))}>{t('Aplicar')}</button></span>
        </span>
        <span className="field-hint">{t('Los climas de la lista del servidor. Para añadir otros o cambiar de sistema (Por defecto, Sol…), ve a «Sesión y clima».')}</span>
      </div>
      {wx.list.length === 1 && <p className="hint">{t('Ahora mismo la lista solo tiene un clima, así que no hay nada que cambiar. Añade más en «Sesión y clima» → Climas disponibles.')}</p>}
    </>
  );
}
