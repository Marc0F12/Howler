import { describe, expect, it } from 'vitest';
import { distUnit, distValue, getClock, getUnits, hour12, shortDistText, speedText, tempUnit, tempValue } from './prefs';

describe('preferencias de visualización (sin navegador: métrico y hora según idioma)', () => {
  it('de serie es métrico y 24 h', () => {
    expect(getUnits()).toBe('metric');
    expect(getClock()).toBe('24h');
    expect(hour12()).toBe(false);
    expect(speedText(123.4)).toBe('123 km/h');
    expect(tempValue(21.4)).toBe(21);
    expect(tempUnit()).toBe('°C');
    expect(distValue(5)).toBe(5);
    expect(distUnit()).toBe('km');
    expect(shortDistText(120)).toBe('120 m');
  });
});

import { orderDate } from './prefs';
describe('orden de las fechas', () => {
  const p = { day: '09', month: '10', year: '2026' };
  it('compone día/mes/año, mes/día/año y año-mes-día', () => {
    expect(orderDate('dmy', p, true)).toBe('09/10/2026');
    expect(orderDate('mdy', p, true)).toBe('10/09/2026');
    expect(orderDate('ymd', p, true)).toBe('2026-10-09');
    expect(orderDate('mdy', { day: '9', month: 'oct', year: '2026', weekday: 'vie' }, false)).toBe('vie oct 9 2026');
    expect(orderDate('dmy', { day: '9', month: 'oct' }, false)).toBe('9 oct');
  });
});
