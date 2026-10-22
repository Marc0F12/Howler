import { makeT, translateMessage, type Lang } from '@howler/shared';

/**
 * Idioma de los textos que Howler genera por su cuenta y que ven los jugadores o el canal de Discord (chat del servidor,
 * avisos por defecto...). Lo elige el organizador en Ajustes; la web y el panel usan el idioma de cada visitante.
 */
let current: Lang = 'es';
export const setServerLang = (l: Lang) => { current = l; };
export const serverLang = (): Lang => current;
/** Traduce un texto con huecos `{x}`. */
export const st = (es: string, p?: Record<string, string | number>): string => makeT(current)(es, p);
/** Traduce un mensaje ya compuesto o una plantilla (sin rellenar los huecos). */
export const stm = (text: string): string => translateMessage(current, text);
