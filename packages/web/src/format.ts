import { getDateOrder, hour12, orderDate } from './prefs';
import { locale, t } from './i18n';

/** «ks_nissan_370z» → «Nissan 370z» (nombre legible de una carpeta de coche o circuito). */
export const pretty = (id: string) => id.replace(/^ks_/, '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** «hace 5 min», «hace 2 h», «hace 3 días». */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return t('ahora mismo');
  const m = Math.round(s / 60);
  if (m < 60) return t('hace {n} min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('hace {n} h', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('hace 1 día') : t('hace {n} días', { n: d });
}

/** Tipo de sesión de AC. */
export const sessionTypeName = (type: number) => (type === 1 ? t('Práctica') : type === 2 ? t('Clasificación') : type === 3 ? t('Carrera') : t('Sesión'));

/** Hora del día, «14:05». */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: hour12() });

/** Duración larga: «3 h 12 min», «45 min», «2 d 4 h». */
export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return ms > 0 ? '< 1 min' : '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Fecha sin hora en el orden que haya elegido la persona (o el del idioma): «10 oct 2026», «10/10/2026». `month: 'short'` = con letras, `'2-digit'` = en cifras.  */
export function formatDay(d: Date, o: { month: 'short' | '2-digit'; year?: boolean; weekday?: boolean; timeZone?: string }): string {
  const base: Intl.DateTimeFormatOptions = { day: o.month === '2-digit' ? '2-digit' : 'numeric', month: o.month, ...(o.year ? { year: 'numeric' as const } : {}), ...(o.weekday ? { weekday: 'short' as const } : {}), ...(o.timeZone ? { timeZone: o.timeZone } : {}) };
  const f = new Intl.DateTimeFormat(locale, base);
  const order = getDateOrder();
  if (order === 'auto') return f.format(d);
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') parts[p.type] = p.value;
  return orderDate(order, { day: parts.day ?? '', month: parts.month ?? '', ...(parts.year ? { year: parts.year } : {}), ...(parts.weekday ? { weekday: parts.weekday } : {}) }, o.month === '2-digit');
}

/** Hora del día según la preferencia de 12/24 h. */
export const timeOf = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: hour12() });

/** Fecha corta: «10 oct 2026». */
export const fmtDate = (iso: string | null) => (iso ? formatDay(new Date(iso), { month: 'short', year: true }) : '—');

/** Porcentaje entero de `a` sobre `b`; «—» si no hay nada que dividir. */
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** Número con separador de miles. */
export const num = (n: number) => n.toLocaleString(locale);
