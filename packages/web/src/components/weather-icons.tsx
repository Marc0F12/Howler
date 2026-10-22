/** Iconos de clima minimalistas (trazo fino, `currentColor`): uno por familia de tiempo, para el selector del panel. */
export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'rain' | 'storm' | 'snow' | 'wind' | 'other';

/** Familia de un clima a partir de su tipo de CSP («LightRain») o de la carpeta/nombre clásico («sol_35_rain», «6_mid_clouds»). */
export function weatherKind(id: string): WeatherKind {
  const s = id.toLowerCase().replace(/[^a-z]/g, '');
  if (/thunder|storm|lightning|squall/.test(s)) return 'storm';
  if (/snow|sleet|hail|ice/.test(s)) return 'snow';
  if (/rain|drizzle|shower/.test(s)) return 'rain';
  if (/fog|mist|haze/.test(s)) return 'fog';
  if (/tornado|hurricane|wind/.test(s)) return 'wind';
  if (/overcast|broken|heavyclouds|midclouds|cloudy|cubierto/.test(s)) return 'cloud';
  if (/fewclouds|scattered|lightclouds|partly/.test(s)) return 'partly';
  if (/clear|sunny|noclouds|sun/.test(s)) return 'clear';
  if (/dust|sand|smoke/.test(s)) return 'other';
  return /cloud/.test(s) ? 'cloud' : 'other';
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const CLOUD = 'M7 17.5h9.5a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 7.3 9.4 4.1 4.1 0 0 0 7 17.5z';

export function WeatherIcon({ kind, size = 22 }: { kind: WeatherKind; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...P}>
      {kind === 'clear' && (<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>)}
      {kind === 'partly' && (<><circle cx="9" cy="9" r="3" /><path d="M9 3v1.2M3 9h1.2M4.8 4.8l.9.9M13.2 4.8l-.9.9" /><path d="M9.5 19h8a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-.7A3.4 3.4 0 0 0 9.5 19z" /></>)}
      {kind === 'cloud' && <path d={CLOUD} />}
      {kind === 'fog' && (<><path d="M7 11h9.5a3 3 0 0 0 0-6 4.6 4.6 0 0 0-8.6 1.2A3 3 0 0 0 7 11z" /><path d="M4 15h16M6 19h12" /></>)}
      {kind === 'rain' && (<><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 7.3 5.9 4.1 4.1 0 0 0 7 14z" /><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5" /></>)}
      {kind === 'storm' && (<><path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 7.3 5.9 4.1 4.1 0 0 0 7 14z" /><path d="M12.5 14l-2.5 4h3l-2 4" /></>)}
      {kind === 'snow' && (<><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M10 4.5l2 1.5 2-1.5M10 19.5l2-1.5 2 1.5" /></>)}
      {kind === 'wind' && (<><path d="M3 9h10.5a2.5 2.5 0 1 0-2.4-3.2M3 13h14.5a2.5 2.5 0 1 1-2.4 3.2M3 17h6" /></>)}
      {kind === 'other' && (<><circle cx="12" cy="12" r="1" /><circle cx="6" cy="9" r="1" /><circle cx="18" cy="9" r="1" /><circle cx="9" cy="16" r="1" /><circle cx="15" cy="16" r="1" /></>)}
    </svg>
  );
}
