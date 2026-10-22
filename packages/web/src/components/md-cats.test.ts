import { describe, expect, it } from 'vitest';
import { changeCategory } from './md-cats';

describe('categorías de las notas de versión', () => {
  it('reconoce los títulos en español e inglés', () => {
    expect(changeCategory('Novedades')).toBe('new');
    expect(changeCategory('New')).toBe('new');
    expect(changeCategory('Mejoras')).toBe('improved');
    expect(changeCategory('Arreglos')).toBe('fixed');
    expect(changeCategory('Fixed')).toBe('fixed');
    expect(changeCategory('Diseño')).toBe('design');
    expect(changeCategory('**Design**:')).toBe('design');
  });
  it('un título cualquiera no es categoría', () => {
    expect(changeCategory('Resumen')).toBeNull();
    expect(changeCategory('')).toBeNull();
  });
});
