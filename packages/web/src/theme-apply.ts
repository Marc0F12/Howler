import { resolveTheme, themeVars, type Theme, type ThemeSelection } from '@howler/shared';

const KEY = 'howler.theme';

/** Aplica un tema a un elemento (la página entera o el marco de la vista previa): solo variables CSS y atributos data-*. */
export function applyThemeTo(el: HTMLElement, theme: Theme) {
  const { vars, attrs } = themeVars(theme);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/** Atributos y estilo para pintar el tema en un elemento de React (vista previa). */
export function themeProps(theme: Theme): { style: Record<string, string>; attrs: Record<string, string> } {
  const { vars, attrs } = themeVars(theme);
  return { style: vars, attrs };
}

export function applyTheme(sel: ThemeSelection | undefined) {
  const theme = resolveTheme(sel);
  applyThemeTo(document.documentElement, theme);
  try { localStorage.setItem(KEY, JSON.stringify(sel ?? null)); } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Antes de pintar: el último tema conocido, para que no parpadee con el de serie. */
export function applyCachedTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) applyThemeTo(document.documentElement, resolveTheme(JSON.parse(raw) as ThemeSelection | null));
  } catch { /* tema de serie */ }
}
