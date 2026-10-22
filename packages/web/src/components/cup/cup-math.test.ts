import { describe, expect, it } from 'vitest';
import { downloadUrls, groupRoster, imageFit, initialRound, shortestDelta, timeline, wrapIndex } from './cup-math';

const team = (id: number, name: string) => ({ id, name, color: '#fff' });
const entry = (driverId: number, teamId: number | null) => ({ driverId, name: `P${driverId}`, teamId, color: null, car: null, skin: null });

describe('participantes por equipo', () => {
  it('agrupa en el orden de los equipos, deja fuera los equipos vacíos y pone los sin equipo al final', () => {
    const g = groupRoster({ teams: [team(1, 'Rojo'), team(2, 'Azul'), team(3, 'Vacío')], entries: [entry(1, 2), entry(2, 1), entry(3, null), entry(4, 1)] });
    expect(g.map((x) => [x.team?.name ?? null, x.entries.map((e) => e.driverId)])).toEqual([['Rojo', [2, 4]], ['Azul', [1]], [null, [3]]]);
  });
  it('sin equipos es un solo grupo sin cabecera, y sin inscritos no hay grupos', () => {
    expect(groupRoster({ teams: [], entries: [entry(1, null), entry(2, null)] })).toEqual([{ team: null, entries: [entry(1, null), entry(2, null)] }]);
    expect(groupRoster({ teams: [], entries: [] })).toEqual([]);
  });
});

describe('línea de tiempo de la prueba', () => {
  it('con las tres fechas sale práctica, clasificación y carrera; las que faltan no salen', () => {
    expect(timeline({ practiceAt: null, qualiAt: '2026-10-10T20:30:00Z', raceAt: '2026-10-10T21:00:00Z' }).map((i) => i.kind)).toEqual(['quali', 'race']);
  });
  it('un calendario propio manda sobre las fechas', () => {
    const schedule = [{ kind: 'post' as const, at: null, text: 'Reclamaciones' }];
    expect(timeline({ practiceAt: '2026-10-10T20:00:00Z', qualiAt: null, raceAt: null, schedule })).toBe(schedule);
  });
});

describe('imagen del campeonato', () => {
  it('manda el ajuste elegido o deducido por el servidor; sin dato se llena el marco', () => {
    expect(imageFit({ imageUrl: '/api/championship-images/abc.png', imageFit: 'contain' })).toBe('contain');
    expect(imageFit({ imageUrl: '/a.png', imageFit: 'cover' })).toBe('cover');
    expect(imageFit({ imageUrl: 'https://x.com/a.png' })).toBe('cover');
    expect(imageFit({ imageUrl: null })).toBe('cover');
  });
});

describe('carrusel y descargas', () => {
  const rounds = (played: boolean[]) => played.map((p, i) => ({ number: i + 1, played: p })) as never;
  it('abre en la próxima carrera; si no hay, en la última disputada; si no, en la primera', () => {
    expect(initialRound({ roundList: rounds([true, true, false]), next: { number: 3, track: '', layout: '', raceAt: null } })).toBe(2);
    expect(initialRound({ roundList: rounds([true, true, true]), next: null })).toBe(2);
    expect(initialRound({ roundList: rounds([false, false]), next: null })).toBe(0);
  });
  it('la rueda es circular: siempre hay carreras a los dos lados y se gira por el camino corto', () => {
    expect([wrapIndex(-1, 4), wrapIndex(4, 4), wrapIndex(9, 4), wrapIndex(0, 4)]).toEqual([3, 0, 1, 0]);
    expect(shortestDelta(0, 3, 4)).toBe(-1);
    expect(shortestDelta(3, 0, 4)).toBe(1);
    expect(shortestDelta(0, 2, 4)).toBe(2);
    expect(shortestDelta(1, 1, 4)).toBe(0);
    expect(shortestDelta(0, 1, 1)).toBe(0);
  });
  it('solo se abren enlaces http(s) y sin repetir', () => {
    expect(downloadUrls([{ url: 'https://a.com/x' }, { url: 'javascript:alert(1)' }, { url: 'https://a.com/x' }, { url: 'http://b.com' }, { url: '' }])).toEqual(['https://a.com/x', 'http://b.com']);
  });
});

import { countryCode, powerToWeight, specNumber } from './cup-math';
describe('iniciales de país', () => {
  it('traduce los nombres habituales y cae a las dos primeras letras', () => {
    expect(countryCode('Spain')).toBe('ES');
    expect(countryCode('Japan')).toBe('JP');
    expect(countryCode('United Kingdom')).toBe('GB');
    expect(countryCode('gb')).toBe('GB');
    expect(countryCode('Narnia')).toBe('NA');
    expect(countryCode(null)).toBe('');
  });
});

describe('ficha de coche: potencia y peso', () => {
  it('lee los números de la ficha con los formatos de AC', () => {
    expect(specNumber('210 cv')).toBe(210);
    expect(specNumber('1.200 kg')).toBe(1200);
    expect(specNumber('1,200 kg')).toBe(1200);
    expect(specNumber('1250.5 kg')).toBe(1250.5);
    expect(specNumber('—')).toBeNull();
    expect(specNumber(undefined)).toBeNull();
  });
  it('calcula caballos por tonelada y calla si falta un dato', () => {
    expect(powerToWeight({ Potencia: '210 cv', Peso: '1.200 kg' })).toBe(175);
    expect(powerToWeight({ Power: '400 bhp', Weight: '1000 kg' })).toBe(400);
    expect(powerToWeight({ Potencia: '210 cv' })).toBeNull();
    expect(powerToWeight({ Potencia: '210 cv', Peso: '12 kg' })).toBeNull();
  });
});

import { driveAxle, specKind } from './spec-icons';
describe('iconos de las cifras del coche', () => {
  it('reconoce la cifra por su etiqueta en español o inglés', () => {
    expect(['Potencia', 'Power', 'Peso', 'Weight', 'Tracción', 'Drivetrain', 'Marchas', 'Gears', 'Potencia/peso', 'Par', 'País'].map(specKind))
      .toEqual(['power', 'power', 'weight', 'weight', 'drive', 'drive', 'gears', 'gears', 'ratio', 'torque', 'other']);
  });
  it('dice qué ejes mueven las ruedas', () => {
    expect(['Trasera', 'RWD', 'Delantera', 'FWD', 'Total', 'AWD', '4x4'].map(driveAxle)).toEqual(['rear', 'rear', 'front', 'front', 'all', 'all', 'all']);
  });
});
