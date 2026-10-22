import { describe, expect, it } from 'vitest';
import { describeWeather } from '@howler/shared';
import { openDatabase } from './database';
import { Repository } from './repository';

describe('clima de cada vuelta', () => {
  it('se guarda con la vuelta y sale en la sesión y en la tabla de tiempos; las antiguas quedan sin clima', () => {
    const repo = new Repository(openDatabase(':memory:'));
    const s = repo.createSession({ track: 't', layout: '', name: 'Practice', type: 1 });
    const d = repo.upsertDriver('A', 'Ana');
    const base = { sessionId: s.id, driverId: d, track: 't', layout: '', car: 'mx5', sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null };
    repo.insertLap({ ...base, lapMs: 100_000, tempAir: 20, tempTrack: 28, weather: 'LightRain' }, []);
    repo.insertLap({ ...base, lapMs: 101_000 }, []);
    expect(repo.driverSessionLaps(s.id, d).map((l) => l.weather)).toEqual(['LightRain', null]);
    expect(repo.records('t', '', []).entries[0]!.weather).toBe('LightRain');
  });
});

describe('describeWeather', () => {
  it('traduce tipos de CSP y carpetas clásicas, y deja legible lo demás', () => {
    expect(describeWeather('LightRain')).toBe('Lluvia ligera');
    expect(describeWeather('6_mid_clouds')).toBe('Nuboso');
    expect(describeWeather('3_clear')).toBe('Despejado');
    expect(describeWeather('sol_05_Broken_Clouds')).toBe('Sol 05 Broken Clouds');
  });
});
