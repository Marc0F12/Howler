import { tempValue, tempUnit } from '../prefs';
import { useState } from 'react';
import { describeWeather } from '@howler/shared';
import { t, tm } from '../i18n';
import { WeatherIcon, weatherKind } from './weather-icons';

/**
 * El clima de una vuelta en UN solo icono. Al pasar el ratón, enfocar o pulsar sale todo lo demás: clima, temperatura del aire y de
 * la pista y agarre. Solo lo que Howler sabe (lo que dijo el servidor). La intensidad de lluvia, la humedad y el agua en pista
 * no las manda el servidor de AC, así que no se muestran.
 */
export function LapWeather({ weather, tempAir, tempTrack, grip }: { weather: string | null; tempAir: number | null; tempTrack: number | null; grip?: number | null }) {
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null);
  const has = tempAir != null || tempTrack != null;
  const gripText = grip != null ? `${(grip * 100).toFixed(1)}%` : null;
  if (!has && !weather && gripText == null) return <>—</>;
  const show = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setPop({ x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6 }); };
  const name = weather ? tm(describeWeather(weather)) : null;
  return (
    <span className="wx">
      <button type="button" className="wx-btn" aria-label={[name, has ? t('Aire {a} {u}, pista {p} {u}', { a: tempAir != null ? tempValue(tempAir) : '—', p: tempTrack != null ? tempValue(tempTrack) : '—', u: tempUnit() }) : null, gripText ? `${t('Agarre')} ${gripText}` : null].filter(Boolean).join(' · ')}
        onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setPop(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setPop(null)}
        onClick={(e) => (pop ? setPop(null) : show(e.currentTarget))}>
        <WeatherIcon kind={weather ? weatherKind(weather) : 'other'} size={20} />
      </button>
      {pop && (
        <span className="wx-pop" role="tooltip" style={{ left: pop.x, top: pop.y }}>
          {name && <strong>{name}</strong>}
          {tempAir != null && <span>{t('Aire')}: <b className="num">{tempValue(tempAir)} {tempUnit()}</b></span>}
          {tempTrack != null && <span>{t('Pista')}: <b className="num">{tempValue(tempTrack)} {tempUnit()}</b></span>}
          {gripText && <span>{t('Agarre')}: <b className="num">{gripText}</b></span>}
          {!weather && <span className="muted">{t('Clima no registrado en esta vuelta.')}</span>}
          <span className="muted wx-note">{t('Lluvia, humedad y agua en pista no las manda el servidor.')}</span>
        </span>
      )}
    </span>
  );
}
