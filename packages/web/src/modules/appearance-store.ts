import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { applyTheme, isPanelRoute } from '../theme-apply';
import { DEFAULT_APPEARANCE, resolveLayout, sanitizeAppearance, type AppearanceConfig, type LayoutEntry, type PageId, type PlacedEntry } from '@howler/shared';

// Una sola copia de la apariencia para toda la web: se pide una vez y el panel la puede actualizar al guardar.
let current: AppearanceConfig | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setAppearance(a: AppearanceConfig) { current = a; emit(); }
/** La apariencia guardada ahora mismo (sin suscribirse), o `null` si aún no ha cargado. */
export const getAppearance = () => current;

function load() {
  if (loading || current) return;
  loading = true;
  fetch('/api/appearance')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => setAppearance(sanitizeAppearance(j)))
    .catch(() => setAppearance(DEFAULT_APPEARANCE)) // sin respuesta: la web sigue con la disposición de serie
    .finally(() => { loading = false; });
}

/** La apariencia guardada; `null` mientras se carga la primera vez. */
export function useAppearance(): AppearanceConfig | null {
  useEffect(load, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current);
}

/** Disposición de prueba (vista previa del panel): manda sobre la guardada sin tocar nada. */
export const LayoutOverride = createContext<Partial<Record<PageId, LayoutEntry[]>> | null>(null);

/** Módulos de una página, en orden, con su tamaño; `null` mientras carga. */
export function useLayout(page: PageId): PlacedEntry[] | null {
  const saved = useAppearance();
  const override = useContext(LayoutOverride);
  const stored = override ? override[page] : saved?.layouts[page];
  if (!override && !saved) return null;
  return resolveLayout(page, stored);
}

/** Aplica a toda la página el tema elegido por el administrador: el de la web, o el del panel mientras se está en él (si no tiene uno propio, el mismo). */
export function useApplyTheme() {
  const a = useAppearance();
  const [panel, setPanel] = useState(isPanelRoute);
  useEffect(() => {
    const on = () => setPanel(isPanelRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (!a) return;
    if (panel) applyTheme(a.panelTheme ?? a.theme, 'panel'); else applyTheme(a.theme, 'web');
  }, [a, panel]);
}
