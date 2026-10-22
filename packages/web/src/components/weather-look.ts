import { weatherKind } from './weather-icons';

/** Cómo se ve un clima, en cantidades (0 a 1), para dibujar cada uno distinto: no hay dos tipos que salgan iguales. */
export interface WeatherLook {
  /** Cobertura de nubes. */
  cover: number;
  /** Intensidad de la lluvia. */
  rain: number;
  /** Llovizna: gotas finas y cortas en vez de gotas largas. */
  drizzle: boolean;
  snow: number;
  thunder: number;
  fog: number;
  haze: number;
  wind: number;
  particles: 'none' | 'sand' | 'dust' | 'smoke';
}

const NONE: WeatherLook = { cover: 0, rain: 0, drizzle: false, snow: 0, thunder: 0, fog: 0, haze: 0, wind: 0, particles: 'none' };

/** Los 26 tipos de CSP WeatherFX, uno a uno. */
const CSP: Record<string, Partial<WeatherLook>> = {
  clear: {},
  fewclouds: { cover: 0.2 }, scatteredclouds: { cover: 0.4 }, brokenclouds: { cover: 0.65 }, overcastclouds: { cover: 0.95 },
  mist: { cover: 0.2, fog: 0.3 }, fog: { cover: 0.4, fog: 0.75 }, haze: { cover: 0.15, haze: 0.6 },
  lightdrizzle: { cover: 0.7, rain: 0.18, drizzle: true }, drizzle: { cover: 0.8, rain: 0.32, drizzle: true }, heavydrizzle: { cover: 0.9, rain: 0.5, drizzle: true },
  lightrain: { cover: 0.8, rain: 0.35 }, rain: { cover: 0.9, rain: 0.65 }, heavyrain: { cover: 1, rain: 1 },
  lightthunderstorm: { cover: 0.9, rain: 0.4, thunder: 0.4 }, thunderstorm: { cover: 1, rain: 0.7, thunder: 0.7 }, heavythunderstorm: { cover: 1, rain: 1, thunder: 1 },
  lightsnow: { cover: 0.7, snow: 0.3 }, snow: { cover: 0.85, snow: 0.6 }, heavysnow: { cover: 1, snow: 1, fog: 0.25 },
  lightsleet: { cover: 0.8, snow: 0.2, rain: 0.2 }, sleet: { cover: 0.9, snow: 0.4, rain: 0.4 }, heavysleet: { cover: 1, snow: 0.65, rain: 0.65 },
  smoke: { cover: 0.5, haze: 0.5, particles: 'smoke' }, sand: { haze: 0.55, wind: 0.8, particles: 'sand' }, dust: { haze: 0.4, particles: 'dust' },
};

/** Climas clásicos de AC y de Sol («3_heavy_clouds», «sol_35_rain»): se deduce de las palabras. */
const CLASSIC: [RegExp, Partial<WeatherLook>][] = [
  [/heavyfog|densefog/, { cover: 0.5, fog: 0.85 }], [/lightfog|mist/, { cover: 0.2, fog: 0.3 }],
  [/heavyclouds|overcast/, { cover: 0.95 }], [/midclouds|broken/, { cover: 0.65 }], [/lightclouds|scattered|fewclouds/, { cover: 0.35 }], [/midclear/, { cover: 0.15 }],
];

export function weatherLook(id: string): WeatherLook {
  const s = id.toLowerCase().replace(/[^a-z]/g, '');
  const csp = CSP[s];
  if (csp) return { ...NONE, ...csp };
  for (const [re, look] of CLASSIC) if (re.test(s)) return { ...NONE, ...look };
  const heavy = /heavy|strong|dense/.test(s) ? 1 : /light|weak/.test(s) ? 0.35 : 0.65;
  const kind = weatherKind(id);
  switch (kind) {
    case 'clear': return { ...NONE };
    case 'partly': return { ...NONE, cover: 0.3 };
    case 'cloud': return { ...NONE, cover: 0.85 };
    case 'fog': return { ...NONE, cover: 0.4, fog: heavy };
    case 'rain': return { ...NONE, cover: 0.9, rain: heavy, drizzle: /drizzle/.test(s) };
    case 'storm': return { ...NONE, cover: 1, rain: 0.7, thunder: heavy };
    case 'snow': return { ...NONE, cover: 0.85, snow: /sleet/.test(s) ? 0.4 : heavy, rain: /sleet/.test(s) ? 0.4 : 0 };
    case 'wind': return { ...NONE, wind: 1, cover: 0.3 };
    default: return { ...NONE, cover: 0.4, haze: 0.4, particles: /smoke/.test(s) ? 'smoke' : /sand/.test(s) ? 'sand' : 'dust' };
  }
}

/** Cuánto tapa el cielo (para apagar el sol y el color del cielo). */
export const overcastOf = (l: WeatherLook): number => Math.min(1, Math.max(l.cover * 0.8, l.rain * 0.8, l.snow * 0.6, l.fog * 0.7, l.thunder, l.haze * 0.5));
