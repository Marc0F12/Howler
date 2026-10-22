import { useEffect, useRef, useState } from 'react';

/**
 * Para cada elemento de una clasificación, si subió o bajó respecto a la clasificación anterior.
 * La flecha se mantiene hasta el siguiente cambio de ese elemento. `scope` identifica QUÉ clasificación es (circuito, sesión...):
 * al cambiar se empieza de cero, para no comparar puestos de listas distintas.
 */
export function usePositionChanges(items: { id: number | string; position: number }[] | undefined, scope = '') {
  const last = useRef(new Map<number | string, number>());
  const [changes, setChanges] = useState(new Map<number | string, 'up' | 'down'>());

  useEffect(() => {
    last.current.clear();
    setChanges(new Map());
  }, [scope]);

  useEffect(() => {
    if (!items) return;
    const found = new Map<number | string, 'up' | 'down'>();
    for (const e of items) {
      const before = last.current.get(e.id);
      if (before != null && before !== e.position) found.set(e.id, e.position < before ? 'up' : 'down');
      last.current.set(e.id, e.position);
    }
    if (found.size > 0) setChanges((prev) => new Map([...prev, ...found]));
  }, [items]);

  return changes;
}
