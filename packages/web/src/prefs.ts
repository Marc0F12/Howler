/** Preferencias de visualización (medidas, hora y fecha). Las decide el panel; `display-sync.ts` las deja guardadas en este navegador antes de arrancar y aquí solo se leen. */
export type Units = 'metric' | 'imperial';
export type Clock = 'auto' | '24h' | '12h';

function read<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const v = localStorage.getItem(key); if (v && (ok as readonly string[]).includes(v)) return v as T; } catch { /* sin almacenamiento */ }
  return fallback;
}

const units: Units = read('howler.units', ['metric', 'imperial'] as const, 'metric');
const clockPref: Clock = read('howler.clock', ['auto', '24h', '12h'] as const, '24h');

export const getUnits = (): Units => units;
export const getClock = (): Clock => clockPref;
/** Opción `hour12` para `toLocale*String`: undefined = lo que use el idioma. */
export const hour12 = (): boolean | undefined => (clockPref === 'auto' ? undefined : clockPref === '12h');


const MI = 0.621371, FT = 3.28084;
/** Velocidad en la unidad elegida, sin redondear. */
export const speedValue = (kmh: number): number => (units === 'imperial' ? kmh * MI : kmh);
export const speedUnit = (): string => (units === 'imperial' ? 'mph' : 'km/h');
/** «123 km/h» o «76 mph». */
export const speedText = (kmh: number): string => `${Math.round(speedValue(kmh))} ${speedUnit()}`;
/** Temperatura en °C o °F, entera. */
export const tempValue = (c: number): number => Math.round(units === 'imperial' ? c * 9 / 5 + 32 : c);
export const tempUnit = (): string => (units === 'imperial' ? '°F' : '°C');

/** La presión llega del juego en psi: en métrico se enseña en bar. */
export const pressureValue = (psi: number): number => (units === 'imperial' ? psi : psi * 0.0689476);
export const pressureUnit = (): string => (units === 'imperial' ? 'psi' : 'bar');
/** Distancia larga: km o millas, con la cantidad de decimales pedida. */
export const distValue = (km: number): number => (units === 'imperial' ? km * MI : km);
export const distUnit = (): string => (units === 'imperial' ? 'mi' : 'km');
/** Distancia corta: metros o pies. */
export const shortDistText = (m: number): string => (units === 'imperial' ? `${Math.round(m * FT)} ft` : `${Math.round(m)} m`);

/** Orden de las fechas: `auto` = el del idioma. */
export type DateOrder = 'auto' | 'dmy' | 'mdy' | 'ymd';
const dateOrder: DateOrder = read('howler.dateorder', ['auto', 'dmy', 'mdy', 'ymd'] as const, 'auto');
export const getDateOrder = (): DateOrder => dateOrder;

export interface DayParts { day: string; month: string; year?: string; weekday?: string }
/** Junta las partes de una fecha en el orden elegido. `numeric` = mes en cifras (separador «/» o «-»); si no, mes con letras. */
export function orderDate(order: Exclude<DateOrder, 'auto'>, p: DayParts, numeric: boolean): string {
  const seq = order === 'dmy' ? [p.day, p.month, p.year] : order === 'mdy' ? [p.month, p.day, p.year] : [p.year, p.month, p.day];
  const body = seq.filter((x): x is string => !!x).join(numeric ? (order === 'ymd' ? '-' : '/') : ' ');
  return p.weekday ? `${p.weekday} ${body}` : body;
}
