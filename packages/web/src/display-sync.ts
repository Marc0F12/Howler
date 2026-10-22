import { sanitizeDisplay, type DisplayConfig } from '@howler/shared';

/**
 * Idioma, hora, fecha y medidas de la web los decide quien controla el panel. Antes de arrancar la web se pregunta qué se eligió y se
 * guarda en este navegador (las demás partes lo leen de ahí, de forma síncrona). Sin respuesta se sigue con lo último que se supo.
 * IMPORTANTE: este archivo no importa nada de la web que lea esos valores al cargarse (i18n, prefs).
 */
export const DISPLAY_KEYS = { lang: 'howler.lang', clock: 'howler.clock', dateOrder: 'howler.dateorder', units: 'howler.units' } as const;

/** Guarda la elección del panel en este navegador. «auto» = sin valor guardado (el idioma sigue al navegador). */
export function storeDisplay(d: DisplayConfig) {
  try {
    for (const k of ['lang', 'clock', 'dateOrder', 'units'] as const) {
      if (d[k] === 'auto' && (k === 'lang' || k === 'dateOrder')) localStorage.removeItem(DISPLAY_KEYS[k]);
      else localStorage.setItem(DISPLAY_KEYS[k], d[k]);
    }
  } catch { /* sin almacenamiento */ }
}

export async function syncDisplay(): Promise<void> {
  try {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('/api/appearance', { signal: ctl.signal });
    window.clearTimeout(timer);
    if (r.ok) storeDisplay(sanitizeDisplay(((await r.json()) as { display?: unknown } | null)?.display));
  } catch { /* se queda lo último */ }
}
