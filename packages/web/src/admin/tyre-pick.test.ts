import { describe, expect, it } from 'vitest';
import { carsWithoutTyre, formatLegal, parseLegal, toggleLegal, tyreOptions, unknownLegal } from './tyre-pick';

const D = { cars: [
  { id: 'a', name: 'Coche A', tyres: [{ short: 'SM', name: 'Semislick' }, { short: 'S', name: 'Slick' }] },
  { id: 'b', name: 'Coche B', tyres: [{ short: 'SM', name: 'Semislick' }, { short: 'H', name: 'Hard' }] },
  { id: 'c', name: 'Coche C', tyres: [] },
] };

describe('selector de neumáticos', () => {
  it('lee y escribe la lista separada por «;»', () => {
    expect(parseLegal(' SM ; S;;')).toEqual(['SM', 'S']);
    expect(parseLegal('')).toEqual([]);
    expect(formatLegal(['SM', 'S'])).toBe('SM;S');
  });
  it('agrupa por nombre corto y pone primero los que más coches tienen', () => {
    const o = tyreOptions(D);
    expect(o.map((x) => x.short)).toEqual(['SM', 'H', 'S']);
    expect(o[0]!.cars).toEqual(['Coche A', 'Coche B']);
  });
  it('avisa de coches que se quedarían sin compuesto y de nombres desconocidos', () => {
    expect(carsWithoutTyre(D, [])).toEqual([]);
    expect(carsWithoutTyre(D, ['S'])).toEqual(['Coche B']);
    expect(carsWithoutTyre(D, ['SM'])).toEqual([]);
    expect(unknownLegal(D, ['SM', 'XX'])).toEqual(['XX']);
    expect(unknownLegal({ cars: [{ id: 'c', name: 'C', tyres: [] }] }, ['XX'])).toEqual([]);
  });
  it('marca y desmarca conservando el orden', () => {
    const o = tyreOptions(D);
    expect(toggleLegal(['S'], 'SM', o)).toEqual(['SM', 'S']);
    expect(toggleLegal(['SM', 'S'], 'SM', o)).toEqual(['S']);
  });
});
