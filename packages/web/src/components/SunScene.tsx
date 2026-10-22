import { skyPhase, sunAt, sunTimes, type GeoPoint, type SkyPhase } from '@howler/shared';
import { t } from '../i18n';
import { useSceneWeather } from './scene-weather';
import { WeatherLayer } from './WeatherScene';
import { overcastOf, weatherLook } from './weather-look';

const W = 320, H = 112, HORIZON = 86;
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string, k: number) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i]! - v) * k)).join(',')})`;
const rgbOf = (c: string) => (c.startsWith('#') ? hex(c) : (c.match(/\d+/g) ?? []).map(Number));
const mixTo = (a: string, b: string, k: number) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * k)).join(',')})`; };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Colores del cielo según la altura del sol: noche → crepúsculo → día. */
function sky(el: number): { top: string; bottom: string; stars: number } {
  if (el <= -8) return { top: '#060916', bottom: '#131a33', stars: 1 };
  if (el < 0) { const k = (el + 8) / 8; return { top: mix('#060916', '#2d2a5e', k), bottom: mix('#131a33', '#e8855a', k), stars: 1 - k }; }
  if (el < 12) { const k = el / 12; return { top: mix('#2d2a5e', '#3b8fd9', k), bottom: mix('#e8855a', '#a7d6f5', k), stars: 0 }; }
  return { top: '#3b8fd9', bottom: '#a7d6f5', stars: 0 };
}

const LABEL: Record<SkyPhase, () => string> = {
  night: () => t('Noche'),
  dawn: () => t('Amanecer'),
  'morning-golden': () => t('Hora dorada (mañana)'),
  day: () => t('Día'),
  'evening-golden': () => t('Hora dorada (tarde)'),
  dusk: () => t('Anochecer'),
};
const clock = (m: number | null) => (m === null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const STARS: [number, number][] = [[24, 18], [58, 34], [96, 14], [140, 30], [188, 12], [226, 28], [262, 16], [296, 36], [44, 52], [210, 50]];

/**
 * Cómo será la luz a una hora del servidor: una colina con el arco del sol (o de la luna), el cielo que cambia y el mono
 * de Howler (duerme de noche, canta al amanecer). Es una estimación con las coordenadas del circuito; no usa la hora real del servidor.
 */
export function SunScene({ geo, minutes, day, generic = false }: { geo: GeoPoint; minutes: number; day: number; generic?: boolean }) {
  const s = sunAt(geo, day, minutes);
  const phase = skyPhase(s);
  const times = sunTimes(geo, day);
  const wx = useSceneWeather();
  const look = wx ? weatherLook(wx.id) : null;
  const cover = look ? overcastOf(look) : 0;
  const daylight = clamp01((s.elevation + 4) / 16); // de noche el cielo sigue oscuro aunque llueva
  const base = sky(s.elevation);
  // El cielo se apaga hacia grises (mas oscuros con tormenta o lluvia fuerte) segun lo tapado que este.
  const storm = look ? Math.max(look.thunder, look.rain * 0.6) : 0;
  const greyTop = mixTo('#6a7685', '#262d38', storm), greyBottom = mixTo('#a9b3be', '#4d596a', storm);
  const col = look ? { ...base, top: mixTo(base.top, greyTop, cover * daylight), bottom: mixTo(base.bottom, greyBottom, cover * daylight) } : base;
  const sunDim = 1 - cover * 0.9 * daylight;
  // El astro visible: el sol si está sobre el horizonte; si no, la luna (la posición opuesta).
  const sunUp = s.elevation > -1;
  const body = sunUp ? s : { elevation: -s.elevation, hourAngle: ((s.hourAngle + 360) % 360) - 180, rising: !s.rising };
  const x = 160 + 140 * Math.sin((body.hourAngle * Math.PI) / 180);
  const y = HORIZON - 64 * Math.sin((Math.max(0, body.elevation) * Math.PI) / 180) - 4;
  const glow = clamp01(1 - Math.abs(s.elevation) / 14);
  const hill = mix('#0c0f14', col.bottom, 0.18);
  const label = LABEL[phase]();

  return (
    <figure className="sun-scene" aria-label={t('Posición del sol: {fase}', { fase: label })}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
        <defs>
          <linearGradient id="sun-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col.top} /><stop offset="1" stopColor={col.bottom} /></linearGradient>
          <radialGradient id="sun-glow"><stop offset="0" stopColor="#ffd9a0" stopOpacity="0.9" /><stop offset="1" stopColor="#ffd9a0" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#sun-sky)" rx="6" />
        {col.stars > 0 && STARS.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r={i % 3 === 0 ? 1.3 : 0.9} fill="#fff" opacity={col.stars * 0.8} />)}
        <path d={`M20,${HORIZON} Q160,-24 300,${HORIZON}`} fill="none" stroke="#fff" strokeOpacity="0.22" strokeDasharray="3 4" />
        {glow > 0.05 && <circle cx={x} cy={y} r={34} fill="url(#sun-glow)" opacity={glow * sunDim} />}
        {sunUp
          ? <circle cx={x} cy={y} r={7} fill="#ffe08a" opacity={sunDim} />
          : <path d={`M${x + 4},${y - 6} a7,7 0 1 0 0,12 a5.5,5.5 0 1 1 0,-12z`} fill="#e6ecff" />}
        {look && <WeatherLayer look={look} />}
        <path d={`M0,${H} L0,${HORIZON + 2} C34,${HORIZON - 16} 66,${HORIZON - 26} 106,${HORIZON - 18} C148,${HORIZON - 10} 172,${HORIZON - 34} 214,${HORIZON - 30} C254,${HORIZON - 26} 284,${HORIZON - 12} ${W},${HORIZON - 18} L${W},${H} Z`} fill={hill} />
      </svg>
      <figcaption>
        <b>{label}</b>
        {wx && <span className="sun-wx">{wx.label}</span>}
        <span className="muted">{times.polar === 'night' ? t('Sin amanecer (noche polar)') : times.polar === 'day' ? t('El sol no se pone (día polar)') : t('Amanece {a} · anochece {b}', { a: clock(times.sunrise), b: clock(times.sunset) })}</span>
        <span className="muted sun-approx">{generic ? t('estimación · sin coordenadas del circuito') : t('estimación')}</span>
      </figcaption>
    </figure>
  );
}
