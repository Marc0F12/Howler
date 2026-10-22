import { describe, expect, it } from 'vitest';
import { makeT, registerEnglish, translateMessage } from './i18n';

describe('i18n', () => {
  registerEnglish({ 'Guardar': 'Save', 'Hola {nombre}': 'Hello {nombre}', 'Anulada: {n} cortes (se permiten {m})': 'Voided: {n} cuts ({m} allowed)' });
  it('traduce con huecos y cae al español si falta', () => {
    const en = makeT('en'), es = makeT('es');
    expect(en('Guardar')).toBe('Save');
    expect(en('Hola {nombre}', { nombre: 'Ana' })).toBe('Hello Ana');
    expect(en('Sin traducir')).toBe('Sin traducir');
    expect(es('Guardar')).toBe('Guardar');
  });
  it('traduce mensajes ya hechos por plantilla', () => {
    expect(translateMessage('en', 'Anulada: 3 cortes (se permiten 1)')).toBe('Voided: 3 cuts (1 allowed)');
    expect(translateMessage('en', 'Guardar')).toBe('Save');
    expect(translateMessage('en', 'Otra cosa')).toBe('Otra cosa');
    expect(translateMessage('es', 'Guardar')).toBe('Guardar');
  });
});
