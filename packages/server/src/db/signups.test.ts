import { describe, expect, it } from 'vitest';
import { SCORING_PRESETS, type ChampionshipInput } from '@howler/shared';
import { openDatabase } from './database';
import { Repository } from './repository';

function setup(status: 'active' | 'draft' = 'active') {
  const db = openDatabase(':memory:');
  const repo = new Repository(db);
  const input: ChampionshipInput = {
    name: 'Copa', format: 'teams', status, scoring: SCORING_PRESETS.f1!.config,
    teams: [{ key: 'r', name: 'Rojos', color: '#f00' }], entries: [],
    rounds: [{ track: 'monza', cars: ['ks_mazda_mx5_nd', 'ks_toyota_gt86'] }, { track: 'imola', cars: ['ks_mazda_mx5_nd'] }],
  };
  const id = repo.championships.save(null, input);
  repo.signups.setSettings(id, { enabled: true, askEmail: true, askTeam: true, askCar: true, questions: ['¿Discord?'], info: 'Bienvenido' });
  return { db, repo, id };
}
const req = (o: Partial<{ name: string; steam: string; team: string; car: string; email: string; answers: string[] }> = {}) =>
  ({ name: 'Ana', steam: 'https://steamcommunity.com/profiles/76561190000000001', team: '', car: '', email: '', answers: ['ana#1'], ...o });

describe('inscripción pública: almacén', () => {
  it('el formulario solo existe con la inscripción abierta, el campeonato activo y los coches de las carreras', () => {
    const { repo, id } = setup();
    expect(repo.signups.formFor(id)).toEqual({ info: 'Bienvenido', askEmail: true, askTeam: true, cars: ['ks_mazda_mx5_nd', 'ks_toyota_gt86'], questions: ['¿Discord?'] });
    repo.signups.setSettings(id, { ...repo.signups.settings(id), enabled: false });
    expect(repo.signups.formFor(id)).toBeNull();
    const d = setup('draft');
    expect(d.repo.signups.formFor(d.id)).toBeNull();
    expect(repo.signups.formFor(999)).toBeNull();
  });

  it('guarda una solicitud, rechaza duplicados del mismo perfil y cuenta las pendientes', () => {
    const { repo, id } = setup();
    expect(repo.signups.submit(id, req(), ['¿Discord?'])).toBe('created');
    expect(repo.signups.submit(id, req({ name: 'Otra' }), ['¿Discord?'])).toBe('duplicate');
    expect(repo.signups.submit(id, req({ steam: 'https://steamcommunity.com/id/otro' }), ['¿Discord?'])).toBe('created');
    const l = repo.signups.list(id);
    expect(l).toHaveLength(2);
    expect(l.find((r) => r.name === 'Ana')!.answers).toEqual([{ question: '¿Discord?', answer: 'ana#1' }]);
    expect(repo.signups.pendingCount(id)).toBe(2);
  });

  it('aprobar inscribe al piloto con equipo y coche; rechazar borra el correo y las respuestas', () => {
    const { repo, id } = setup();
    repo.signups.submit(id, req({ email: 'a@b.es' }), ['¿Discord?']);
    repo.signups.submit(id, req({ steam: 'https://steamcommunity.com/id/otro', email: 'o@b.es' }), ['¿Discord?']);
    const [a, b] = repo.signups.list(id).sort((x, y) => x.id - y.id);
    const driver = repo.findOrCreateDriver('76561190000000001', 'Ana');
    const teamId = repo.championships.get(id)!.teams[0]!.id;
    repo.signups.approve(id, a!.id, { driverId: driver.id, teamId, car: 'ks_toyota_gt86' });
    const c = repo.championships.get(id)!;
    expect(c.entries).toEqual([expect.objectContaining({ driverId: driver.id, teamId, car: 'ks_toyota_gt86' })]);
    expect(repo.signups.get(id, a!.id)).toMatchObject({ status: 'approved', driverId: driver.id });
    expect(() => repo.signups.approve(id, b!.id, { driverId: driver.id, teamId: 9999, car: null })).toThrow(/equipo/);
    expect(repo.signups.reject(id, b!.id)).toBe(true);
    expect(repo.signups.get(id, b!.id)).toMatchObject({ status: 'rejected', email: '', answers: [] });
    // una rechazada se puede volver a pedir; las rechazadas antiguas desaparecen solas
    expect(repo.signups.submit(id, req({ steam: 'https://steamcommunity.com/id/otro' }), [])).toBe('created');
    repo.signups.prune(Date.now() + 31 * 86400000);
    expect(repo.signups.get(id, b!.id)).toBeNull();
  });

  it('exporta CSV con BOM y «;», con las fórmulas neutralizadas', () => {
    const { repo, id } = setup();
    repo.signups.submit(id, req({ name: '=SUMA(1)', email: 'a@b.es' }), ['¿Discord?']);
    const csv = repo.signups.csv(id);
    expect(csv.startsWith('﻿Nombre;Steam;')).toBe(true);
    expect(csv).toContain('¿Discord?');
    expect(csv).not.toMatch(/(^|;)=SUMA/m);
  });

  it('un campeonato copiado de otro Howler no admite cambios de inscripción', () => {
    const { db, repo, id } = setup();
    db.prepare("UPDATE championships SET origin = 'x' WHERE id = ?").run(id);
    expect(() => repo.signups.setSettings(id, repo.signups.settings(id))).toThrow(/solo lectura/);
    expect(repo.signups.formFor(id)).toBeNull();
  });
});
