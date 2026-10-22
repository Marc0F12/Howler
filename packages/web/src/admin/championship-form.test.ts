import { describe, expect, it } from 'vitest';
import type { ChampionshipDto } from '@howler/shared';
import { SCORING_PRESETS } from '@howler/shared';
import { emptyMod, fromDto, isoToLocal, localToIso, newDraft, nextTeamKey, parsePoints, pointsPreview, problems, toInput } from './championship-form';

const base = () => {
  const d = newDraft();
  d.name = 'Copa';
  d.entries = [{ driverId: 1, name: 'Ana', teamKey: null, car: '', skin: '' }, { driverId: 2, name: 'Beto', teamKey: null, car: '', skin: '' }];
  d.rounds = [{ track: 'monza', layout: '', cars: [], weather: '', schedule: [{ kind: 'race', title: '', at: '2026-10-24T21:45', duration: '', text: '' }], mods: [] }];
  return d;
};

describe('asistente de campeonatos', () => {
  it('valida cada paso', () => {
    const d = newDraft();
    expect(problems(d, 0)).toEqual(['Ponle un nombre al campeonato.']);
    d.name = 'Copa'; d.imageUrl = 'ftp://x';
    expect(problems(d, 0)[0]).toMatch(/http/);
    d.imageUrl = `/api/championship-images/${'a'.repeat(32)}.png`;
    expect(problems(d, 0)).toEqual([]); // una imagen subida desde el panel vale
    d.imageUrl = '/api/championship-images/../../etc/passwd';
    expect(problems(d, 0)).toHaveLength(1);
    expect(problems(d, 1)).toEqual(['Añade al menos un participante.']);
    expect(problems(base(), 1)).toEqual([]);
    expect(problems(base(), 2)).toEqual([]);
    const r = base(); r.rounds[0]!.track = '';
    expect(problems(r, 2)).toEqual(['La carrera 1 necesita un circuito.']);
  });

  it('parejas exigen exactamente 2 pilotos por pareja y todos con equipo', () => {
    const d = base();
    d.format = 'pairs';
    expect(problems(d, 1)).toContain('Crea al menos una pareja.');
    d.teams = [{ key: 't1', name: 'Rojos', color: '#f00000' }];
    d.entries[0]!.teamKey = 't1';
    expect(problems(d, 1).join(' ')).toMatch(/Cada piloto debe estar en un equipo/);
    expect(problems(d, 1).join(' ')).toMatch(/exactamente 2/);
    d.entries[1]!.teamKey = 't1';
    expect(problems(d, 1)).toEqual([]);
    d.format = 'teams';
    d.entries.push({ driverId: 3, name: 'Cris', teamKey: 't1', car: '', skin: '' });
    expect(problems(d, 1)).toEqual([]); // un equipo puede tener más de dos
  });

  it('revisa enlaces de mods y la tabla de puntos', () => {
    const d = base();
    d.mods = [{ ...emptyMod('car'), name: 'MX-5', url: 'javascript:alert(1)' }];
    expect(problems(d, 2).join(' ')).toMatch(/enlaces de descarga/);
    d.mods[0]!.url = 'https://example.com/mx5';
    expect(problems(d, 2)).toEqual([]);
    d.scoring.pointsTable = [];
    expect(problems(d, 3)).toEqual(['La tabla de puntos no puede estar vacía.']);
  });

  it('toInput limpia: sin equipos si es individual, mods vacíos fuera, fechas en ISO', () => {
    const d = base();
    d.teams = [{ key: 't1', name: 'X', color: '#ff0000' }];
    d.entries[0]!.teamKey = 't1';
    d.rounds[0]!.mods = [{ ...emptyMod('track'), name: '', url: '' }, { ...emptyMod('car'), name: ' MX-5 ', url: ' https://e.com/a ', specs: { Peso: '1.100 kg' } }];
    const i = toInput(d);
    expect(i.teams).toEqual([]);
    expect(i.entries.map((e) => e.teamKey)).toEqual([null, null]);
    expect(i.rounds[0]!.schedule).toHaveLength(1);
    expect(i.rounds[0]!.schedule![0]).toMatchObject({ kind: 'race' });
    expect(Number.isNaN(Date.parse(i.rounds[0]!.schedule![0]!.at as string))).toBe(false);
    expect(i.rounds[0]!.weather).toBeNull();
    expect(i.imageFit).toBeNull();
    expect(i.rounds[0]!.mods).toEqual([{ name: 'MX-5', kind: 'car', url: 'https://e.com/a', note: null, imageUrl: null, specs: { Peso: '1.100 kg' } }]);
  });

  it('fecha local ida y vuelta, y fromDto reconstruye el borrador', () => {
    const iso = localToIso('2026-10-24T21:45')!;
    expect(isoToLocal(iso)).toBe('2026-10-24T21:45');
    expect(localToIso('')).toBeNull();
    expect(isoToLocal('basura')).toBe('');
    const dto = {
      id: 7, name: 'Copa', description: 'd', imageUrl: null, format: 'teams', status: 'active', scoring: SCORING_PRESETS.f1!.config,
      teams: [{ id: 3, name: 'Rojos', color: '#ff0000' }], entries: [{ driverId: 1, name: 'Ana', teamId: 3, color: null }],
      roundList: [{ id: 9, number: 1, track: 'monza', layout: '', cars: ['mx5'], practiceAt: null, qualiAt: null, raceAt: iso, mods: [] }],
      mods: [{ id: 1, name: 'Skins', kind: 'skins', url: 'https://e.com/s', note: null, imageUrl: null, specs: {} }],
    } as unknown as ChampionshipDto;
    const d = fromDto(dto);
    expect(d).toMatchObject({ id: 7, format: 'teams', teams: [{ key: 't3' }], entries: [{ teamKey: 't3' }], rounds: [{ id: 9, schedule: [{ kind: 'race', at: '2026-10-24T21:45' }], cars: ['mx5'] }], mods: [{ kind: 'skins' }] });
    expect(toInput(d).rounds[0]).toMatchObject({ id: 9, track: 'monza' });
  });

  it('claves de equipo únicas y utilidades de puntos', () => {
    expect(nextTeamKey([{ key: 't1', name: '', color: '' }, { key: 't3', name: '', color: '' }])).toBe('t4');
    expect(parsePoints('25, 18; 15 x 12')).toEqual([25, 18, 15, 12]);
    expect(pointsPreview([25, 18, 15], 2)).toBe('1.º 25 · 2.º 18 …');
  });
});

import { missingPitboxes } from './championship-form';
describe('missingPitboxes', () => {
  it('avisa solo cuando faltan plazas y se conocen', () => {
    expect(missingPitboxes(20, 16)).toBe(4);
    expect(missingPitboxes(10, 16)).toBe(0);
    expect(missingPitboxes(10, null)).toBe(0);
  });

  it('calendario, clima, skin y ajuste de imagen viajan en los dos sentidos', () => {
    const d = base();
    d.imageUrl = '/api/championship-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    d.imageFit = 'contain';
    d.entries[0]!.car = 'bmw_m3_e30';
    d.entries[0]!.skin = 'rojo';
    d.entries[1]!.skin = 'huerfana'; // sin coche no hay skin
    d.rounds[0]!.weather = 'LightRain';
    d.rounds[0]!.schedule = [
      { kind: 'quali', title: '', at: '', duration: ' 20 minutos ', text: ' Busca la pole ' },
      { kind: 'race', title: '', at: '2026-10-24T21:00', duration: '', text: '' },
      { kind: 'post', title: '', at: '', duration: '5 - 15 minutos', text: 'Reclamaciones' },
      { kind: 'practice', title: '', at: '', duration: '', text: '' }, // vacía: no se guarda
      { kind: 'custom', title: 'Rueda de prensa', at: '', duration: '', text: '' },
    ];
    const i = toInput(d);
    expect(i.imageFit).toBe('contain');
    expect(i.entries.map((e) => [e.car, e.skin])).toEqual([['bmw_m3_e30', 'rojo'], [null, null]]);
    expect(i.rounds[0]).toMatchObject({ weather: 'LightRain' });
    expect(i.rounds[0]!.schedule!.map((x) => [x.kind, x.duration ?? null, x.text ?? null, x.title ?? null])).toEqual([['quali', '20 minutos', 'Busca la pole', null], ['race', null, null, null], ['post', '5 - 15 minutos', 'Reclamaciones', null], ['custom', null, null, 'Rueda de prensa']]);
    d.imageUrl = '';
    expect(toInput(d).imageFit).toBeNull(); // sin imagen no hay ajuste
  });
});
