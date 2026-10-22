import { describe, expect, it } from 'vitest';
import { normalizeOrder, swapInOrder } from './useChartOrder';

const D = ['a', 'b', 'c', 'd'] as const;

describe('normalizeOrder', () => {
  it('respeta el orden guardado, añade al final las nuevas y descarta repetidas y desconocidas', () => {
    expect(normalizeOrder(['c', 'a'], D)).toEqual(['c', 'a', 'b', 'd']);
    expect(normalizeOrder(['b', 'b', 'zzz', 'a'], D)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('ante datos rotos usa el orden por defecto', () => {
    for (const bad of [null, undefined, 'x', 5, {}, [1, 2]]) expect(normalizeOrder(bad, D)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('swapInOrder', () => {
  it('intercambia dos y no toca la lista original', () => {
    const o = ['a', 'b', 'c', 'd'];
    expect(swapInOrder(o, 'b', 'd')).toEqual(['a', 'd', 'c', 'b']);
    expect(o).toEqual(['a', 'b', 'c', 'd']);
  });
  it('si falta alguno o son el mismo, no cambia nada', () => {
    const o = ['a', 'b'];
    expect(swapInOrder(o, 'a', 'x')).toBe(o);
    expect(swapInOrder(o, 'a', 'a')).toBe(o);
  });
});
