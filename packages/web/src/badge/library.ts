import { useEffect, useMemo, useState } from 'react';
import type { IconLookup } from '@howler/shared';

/** Un emblema de la biblioteca de Howler. `d` = trazo (varios subtrazos, relleno par-impar) en un lienzo de 512×512; `t` = etiquetas de búsqueda. */
export interface LibIcon { id: string; n: string; en: string; c: string; t: string; d: string }
/** Etiquetas de las categorías de la biblioteca (el id es el que trae el JSON). */
export const ICON_CATEGORIES: Record<string, string> = {
  carreras: 'Carreras', premios: 'Premios y rango', coronas: 'Coronas y cascos', alas: 'Alas y vuelo', escudos: 'Escudos', simbolos: 'Símbolos',
  animales: 'Animales', muerte: 'Calaveras y muerte', energia: 'Energía y elementos', abstracto: 'Abstractos',
};

let loading: Promise<LibIcon[]> | null = null;
/** Carga la biblioteca bajo demanda: son ~900 KB y solo la necesita el editor (va en su propio fragmento). */
export function loadIcons(): Promise<LibIcon[]> {
  loading ??= import('./icons.json').then((m) => m.default as LibIcon[]).catch((e) => { loading = null; throw e; });
  return loading;
}

export function makeLookup(icons: readonly LibIcon[] | null): IconLookup | undefined {
  if (!icons) return undefined;
  const by = new Map(icons.map((i) => [i.id, i]));
  return (id) => by.get(id);
}

/** La biblioteca, cuando `enabled`; `null` mientras carga (o si falla). */
export function useIcons(enabled = true): { icons: LibIcon[] | null; lookup: IconLookup | undefined; failed: boolean } {
  const [state, setState] = useState<{ icons: LibIcon[] | null; failed: boolean }>({ icons: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadIcons().then((icons) => { if (live) setState({ icons, failed: false }); }, () => { if (live) setState({ icons: null, failed: true }); });
    return () => { live = false; };
  }, [enabled]);
  const lookup = useMemo(() => makeLookup(state.icons), [state.icons]);
  return { icons: state.icons, lookup, failed: state.failed };
}
