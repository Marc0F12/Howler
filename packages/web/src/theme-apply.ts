import { resolveTheme, themeVars, type Theme, type ThemeSelection } from '@howler/shared';

/** Dónde se aplica un tema: la web pública o el panel (el panel puede tener el suyo). Cada uno guarda el último conocido para no parpadear al abrir. */
export type ThemeScope = 'web' | 'panel';
const KEYS: Record<ThemeScope, string> = { web: 'howler.theme', panel: 'howler.theme.panel' };
const OPTIONAL_VARS = ['--ticker-bg', '--ticker-fg'];

/** ¿La dirección actual es la del panel? */
export const isPanelRoute = () => typeof location !== 'undefined' && location.hash.startsWith('#/panel');

/** Aplica un tema a un elemento (la página entera o el marco de la vista previa): solo variables CSS y atributos data-*. */
export function applyThemeTo(el: HTMLElement, theme: Theme) {
  const { vars, attrs } = themeVars(theme);
  for (const k of OPTIONAL_VARS) el.style.removeProperty(k); // los colores opcionales del tema anterior no se quedan
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/** Atributos y estilo para pintar el tema en un elemento de React (vista previa). */
export function themeProps(theme: Theme): { style: Record<string, string>; attrs: Record<string, string> } {
  const { vars, attrs } = themeVars(theme);
  return { style: vars, attrs };
}

/** Aplica el tema a toda la página y lo recuerda para el siguiente arranque (de este ámbito). */
export function applyTheme(sel: ThemeSelection | undefined, scope: ThemeScope = 'web') {
  applyThemeTo(document.documentElement, resolveTheme(sel));
  try { localStorage.setItem(KEYS[scope], JSON.stringify(sel ?? null)); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Aplica el tema a la página sin recordarlo (vista previa en vivo mientras se edita). */
export function previewThemeOnPage(sel: ThemeSelection | undefined) {
  applyThemeTo(document.documentElement, resolveTheme(sel));
}

/** Antes de pintar: el último tema conocido de lo que se va a ver (el panel o la web), para que no parpadee con el de serie. */
export function applyCachedTheme() {
  try {
    const raw = localStorage.getItem(KEYS[isPanelRoute() ? 'panel' : 'web']);
    if (raw) applyThemeTo(document.documentElement, resolveTheme(JSON.parse(raw) as ThemeSelection | null));
  } catch { /* tema de serie */ }
}
