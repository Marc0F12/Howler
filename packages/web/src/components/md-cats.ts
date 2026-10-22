/** Categorías de las notas de versión: un título «Novedades», «Arreglos»... se reconoce y se pinta como etiqueta. */
export type ChangeCategory = 'new' | 'improved' | 'fixed' | 'design';

const CATS: [ChangeCategory, RegExp][] = [
  ['new', /^(novedades?|nuevo|nuevas funciones|new|what.?s new)$/i],
  ['improved', /^(mejoras?|mejorado|improved|improvements?)$/i],
  ['fixed', /^(arreglos?|correcciones|corregido|fixed|fixes|bug ?fixes)$/i],
  ['design', /^(dise[ñn]o|apariencia|design|appearance)$/i],
];

export function changeCategory(title: string): ChangeCategory | null {
  const t = title.replace(/[*_`:]/g, '').trim();
  return CATS.find(([, re]) => re.test(t))?.[0] ?? null;
}
