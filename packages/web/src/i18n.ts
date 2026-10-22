import { isLang, makeT, translateMessage, type Lang } from '@howler/shared';

/** Idioma elegido (guardado en este navegador) o, si no hay, el del navegador: español si es español, inglés para el resto. */
function detect(): Lang {
  if (typeof window === 'undefined') return 'es'; // pruebas y servidor: español
  try {
    const saved = localStorage.getItem('howler.lang');
    if (isLang(saved)) return saved;
  } catch { /* sin almacenamiento */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

const current: Lang = detect();
export const getLang = (): Lang => current;
if (typeof document !== 'undefined') document.documentElement.lang = current;
/** Traduce un texto de la interfaz (la clave es el español). */
export const t = makeT(current);
/** Traduce un texto que llegó ya hecho (del servidor o de `shared`): por texto exacto o plantilla; si no hay, queda como vino. */
export const tm = (text: string): string => translateMessage(current, text);
/** Locale para fechas y números. */
export const locale = current === 'es' ? 'es-ES' : 'en-GB';

