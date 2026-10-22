// Posición aproximada del sol para enseñar en el panel cómo será la luz a una hora del servidor. Modelo sencillo (declinación
// y ángulo horario, sin ecuación del tiempo ni horario de verano): vale para «amanece / es mediodía / es de noche», no para medir.

export interface GeoPoint { lat: number; lon: number }

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Día del año (1-366) de una fecha. */
export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000);
}

const declination = (n: number) => 23.44 * Math.sin(rad((360 / 365) * (284 + n)));
/** Horas que hay que sumar al reloj del lugar para tener la hora solar (el reloj sigue el huso de 15° más cercano). */
const solarShift = (lon: number) => (lon - 15 * Math.round(lon / 15)) / 15;

export interface SunState {
  /** Altura sobre el horizonte en grados (negativa = bajo el horizonte). */
  elevation: number;
  /** Ángulo horario en grados (0 = mediodía solar, negativo por la mañana). */
  hourAngle: number;
  /** ¿Va subiendo (antes del mediodía solar)? */
  rising: boolean;
}

export function sunAt(geo: GeoPoint, day: number, minutes: number): SunState {
  const solar = minutes / 60 + solarShift(geo.lon);
  let hourAngle = 15 * (solar - 12);
  hourAngle = ((((hourAngle + 180) % 360) + 360) % 360) - 180;
  const d = rad(declination(day)), p = rad(geo.lat), h = rad(hourAngle);
  const sinEl = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h);
  return { elevation: deg(Math.asin(Math.max(-1, Math.min(1, sinEl)))), hourAngle, rising: hourAngle < 0 };
}

export interface SunTimes { sunrise: number | null; sunset: number | null; polar: 'day' | 'night' | null }

/** Minutos del reloj a los que sale y se pone el sol; en latitudes polares puede no haber (día o noche todo el rato). */
export function sunTimes(geo: GeoPoint, day: number): SunTimes {
  const d = rad(declination(day)), p = rad(geo.lat);
  const cosH0 = (Math.sin(rad(-0.833)) - Math.sin(p) * Math.sin(d)) / (Math.cos(p) * Math.cos(d));
  if (cosH0 >= 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosH0 <= -1) return { sunrise: null, sunset: null, polar: 'day' };
  const h0 = deg(Math.acos(cosH0)) / 15;
  const wrap = (h: number) => Math.round((((h * 60) % 1440) + 1440) % 1440);
  return { sunrise: wrap(12 - h0 - solarShift(geo.lon)), sunset: wrap(12 + h0 - solarShift(geo.lon)), polar: null };
}

export type SkyPhase = 'night' | 'dawn' | 'morning-golden' | 'day' | 'evening-golden' | 'dusk';

/** En qué momento del día estamos según la altura del sol y si sube o baja. */
export function skyPhase(s: SunState): SkyPhase {
  if (s.elevation < -6) return 'night';
  if (s.elevation < 0) return s.rising ? 'dawn' : 'dusk';
  if (s.elevation < 10) return s.rising ? 'morning-golden' : 'evening-golden';
  return 'day';
}

/** Coordenadas de `geotags` de un `ui_track.json` («41.57 N», «2° 15' 23" E», «-3.2»…), con la latitud primero salvo que las letras digan otra cosa. */
export function parseGeotags(v: unknown): GeoPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const one = (raw: unknown): { value: number; axis: 'lat' | 'lon' | null } | null => {
    const s = String(raw ?? '').trim();
    const nums = s.match(/\d+(?:[.,]\d+)?/g)?.map((n) => Number(n.replace(',', '.')));
    if (!nums || nums.length === 0 || nums.some((n) => !Number.isFinite(n))) return null;
    let value = nums[0]! + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600;
    const letter = /[NSEW]/i.exec(s.replace(/[^A-Za-z]/g, ''))?.[0]?.toUpperCase();
    if (/^\s*-/.test(s) || letter === 'S' || letter === 'W') value = -value;
    return { value, axis: letter === 'N' || letter === 'S' ? 'lat' : letter === 'E' || letter === 'W' ? 'lon' : null };
  };
  const a = one(v[0]), b = one(v[1]);
  if (!a || !b) return null;
  const [lat, lon] = a.axis === 'lon' || b.axis === 'lat' ? [b.value, a.value] : [a.value, b.value];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
