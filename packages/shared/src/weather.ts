// Tipos de clima de CSP WeatherFX que entiende AssettoServer (/setcspweather <tipo> <segundos>). Los scripts de WeatherFX que
// elige cada jugador en Content Manager (Pure, Sol, el de por defecto) los interpretan: el servidor solo manda el tipo.

export interface CspWeatherType {
  /** Nombre exacto que acepta el comando. */
  type: string;
  name: string;
  group: 'Despejado y nubes' | 'Niebla y calima' | 'Lluvia' | 'Tormenta' | 'Nieve y aguanieve' | 'Otros';
}

export const CSP_WEATHER_TYPES: CspWeatherType[] = [
  { type: 'Clear', name: 'Despejado', group: 'Despejado y nubes' },
  { type: 'FewClouds', name: 'Pocas nubes', group: 'Despejado y nubes' },
  { type: 'ScatteredClouds', name: 'Nubes dispersas', group: 'Despejado y nubes' },
  { type: 'BrokenClouds', name: 'Nuboso', group: 'Despejado y nubes' },
  { type: 'OvercastClouds', name: 'Cubierto', group: 'Despejado y nubes' },
  { type: 'Mist', name: 'Neblina', group: 'Niebla y calima' },
  { type: 'Fog', name: 'Niebla', group: 'Niebla y calima' },
  { type: 'Haze', name: 'Calima', group: 'Niebla y calima' },
  { type: 'LightDrizzle', name: 'Llovizna ligera', group: 'Lluvia' },
  { type: 'Drizzle', name: 'Llovizna', group: 'Lluvia' },
  { type: 'HeavyDrizzle', name: 'Llovizna fuerte', group: 'Lluvia' },
  { type: 'LightRain', name: 'Lluvia ligera', group: 'Lluvia' },
  { type: 'Rain', name: 'Lluvia', group: 'Lluvia' },
  { type: 'HeavyRain', name: 'Lluvia fuerte', group: 'Lluvia' },
  { type: 'LightThunderstorm', name: 'Tormenta ligera', group: 'Tormenta' },
  { type: 'Thunderstorm', name: 'Tormenta', group: 'Tormenta' },
  { type: 'HeavyThunderstorm', name: 'Tormenta fuerte', group: 'Tormenta' },
  { type: 'LightSnow', name: 'Nieve ligera', group: 'Nieve y aguanieve' },
  { type: 'Snow', name: 'Nieve', group: 'Nieve y aguanieve' },
  { type: 'HeavySnow', name: 'Nieve fuerte', group: 'Nieve y aguanieve' },
  { type: 'LightSleet', name: 'Aguanieve ligera', group: 'Nieve y aguanieve' },
  { type: 'Sleet', name: 'Aguanieve', group: 'Nieve y aguanieve' },
  { type: 'HeavySleet', name: 'Aguanieve fuerte', group: 'Nieve y aguanieve' },
  { type: 'Smoke', name: 'Humo', group: 'Otros' },
  { type: 'Sand', name: 'Arena', group: 'Otros' },
  { type: 'Dust', name: 'Polvo', group: 'Otros' },
];

const CLASSIC_NAMES: Record<string, string> = {
  heavyfog: 'Niebla densa', lightfog: 'Niebla ligera', clear: 'Despejado', midclear: 'Poco nuboso',
  lightclouds: 'Nubes ligeras', midclouds: 'Nuboso', heavyclouds: 'Muy nuboso',
};

/** Nombre legible de lo que guarda una vuelta como clima: un tipo de CSP («LightRain»), una carpeta clásica («6_mid_clouds») o el texto tal cual. */
export function describeWeather(id: string): string {
  const key = id.toLowerCase().replace(/[^a-z]/g, '');
  const csp = CSP_WEATHER_TYPES.find((c) => c.type.toLowerCase() === key);
  if (csp) return csp.name;
  const classic = CLASSIC_NAMES[id.toLowerCase().replace(/^\d+_/, '').replace(/[^a-z]/g, '')];
  if (classic) return classic;
  const text = id.replace(/^\d+_/, '').replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id;
}
