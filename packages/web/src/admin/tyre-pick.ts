import type { CarTyresDto } from '@howler/shared';

/** «SM;S» → ['SM','S'] (el servidor separa con «;»; vacío = todos los compuestos). */
export function parseLegal(v: string): string[] {
  return v.split(';').map((x) => x.trim()).filter(Boolean);
}
export const formatLegal = (list: string[]) => list.join(';');

export interface TyreOption { short: string; names: string[]; cars: string[] }

/** Compuestos de todos los coches de la lista, agrupados por nombre corto, con quién los tiene. */
export function tyreOptions(d: CarTyresDto): TyreOption[] {
  const by = new Map<string, TyreOption>();
  for (const car of d.cars) {
    for (const t of car.tyres) {
      const o = by.get(t.short) ?? { short: t.short, names: [], cars: [] };
      if (!o.names.includes(t.name)) o.names.push(t.name);
      o.cars.push(car.name);
      by.set(t.short, o);
    }
  }
  return [...by.values()].sort((a, b) => b.cars.length - a.cars.length || a.short.localeCompare(b.short));
}

/** Coches a los que la selección no deja ningún compuesto (con la lista vacía todos pueden usar los suyos). */
export function carsWithoutTyre(d: CarTyresDto, legal: string[]): string[] {
  if (!legal.length) return [];
  return d.cars.filter((c) => c.tyres.length > 0 && !c.tyres.some((t) => legal.includes(t.short))).map((c) => c.name);
}

/** Compuestos escritos que no existen en ningún coche de la lista (solo si hay datos de neumáticos). */
export function unknownLegal(d: CarTyresDto, legal: string[]): string[] {
  const known = new Set(d.cars.flatMap((c) => c.tyres.map((t) => t.short)));
  return known.size ? legal.filter((s) => !known.has(s)) : [];
}

/** Marca o desmarca un compuesto manteniendo el orden de las opciones. */
export function toggleLegal(legal: string[], short: string, options: TyreOption[]): string[] {
  const next = legal.includes(short) ? legal.filter((s) => s !== short) : [...legal, short];
  const order = options.map((o) => o.short);
  return next.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
}
