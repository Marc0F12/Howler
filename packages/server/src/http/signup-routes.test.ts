import { afterEach, describe, expect, it } from 'vitest';
import { SCORING_PRESETS } from '@howler/shared';
import { Bus } from '../core/bus';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { buildApp } from './app';
import { SIGNUP_PER_HOUR } from './signup-routes';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

async function start() {
  const repo = new Repository(openDatabase(':memory:'));
  const id = repo.championships.save(null, { name: 'Copa', format: 'individual', status: 'active', scoring: SCORING_PRESETS.f1!.config, teams: [], entries: [], rounds: [{ track: 'monza', cars: ['a', 'b'] }] });
  repo.signups.setSettings(id, { enabled: true, askEmail: true, askTeam: false, askCar: true, questions: ['¿Discord?'], info: 'Normas' });
  const app = await buildApp({ repo, bus: new Bus(), tracker: { positions: () => [], status: () => ({ acConnected: false, exactSectors: false, session: null, online: [] }) } as never });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const post = (body: unknown, cid = id) => fetch(`${base}/api/championships/${cid}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { repo, id, base, post };
}
const ok = (o: Record<string, unknown> = {}) => ({ name: 'Ana', steam: 'https://steamcommunity.com/profiles/76561190000000001', car: 'a', email: 'a@b.es', answers: ['ana#1'], ...o });

describe('inscripción pública: web', () => {
  it('enseña el formulario y no deja ver nada si no hay inscripción abierta', async () => {
    const { base, id, repo } = await start();
    const f = await (await fetch(`${base}/api/championships/${id}/signup`)).json();
    expect(f).toEqual({ info: 'Normas', askEmail: true, askTeam: false, cars: ['a', 'b'], questions: ['¿Discord?'] });
    repo.signups.setSettings(id, { ...repo.signups.settings(id), enabled: false });
    expect((await fetch(`${base}/api/championships/${id}/signup`)).status).toBe(404);
  });

  it('guarda la solicitud, avisa de duplicados y no saca datos de nadie', async () => {
    const { post, repo, id } = await start();
    const r = await post(ok());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, result: 'created' });
    expect(await (await post(ok())).json()).toEqual({ ok: true, result: 'duplicate' });
    expect(repo.signups.list(id)).toHaveLength(1);
    expect(repo.signups.list(id)[0]).toMatchObject({ name: 'Ana', car: 'a', email: 'a@b.es', status: 'pending' });
  });

  it('rechaza lo que no vale y se traga el campo trampa sin guardar', async () => {
    const { post, repo, id } = await start();
    expect((await post(ok({ steam: 'https://evil.com/x' }))).status).toBe(400);
    expect((await post(ok({ car: 'zzz' }))).status).toBe(400);
    expect((await post(ok({ name: '' }))).status).toBe(400);
    const bot = await post(ok({ website: 'http://spam.example' }));
    expect(bot.status).toBe(200);
    expect(repo.signups.list(id)).toHaveLength(0);
    expect((await post(ok(), 999)).status).toBe(404);
  });

  it('limita las solicitudes por hora desde una misma dirección', async () => {
    const { post } = await start();
    let last = 200;
    for (let i = 0; i < SIGNUP_PER_HOUR + 2; i++) last = (await post(ok({ steam: `76561190000000${String(100 + i)}` }))).status;
    expect(last).toBe(429);
  });
});
