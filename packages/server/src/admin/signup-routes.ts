import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cleanSignupSettings, type SignupStateDto } from '@howler/shared';
import { resolveSteamProfile } from '../core/steam-profile';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Inscripción pública a campeonatos: ajustes, solicitudes pendientes y su aprobación (solo el panel). */
export function registerSignupAdminRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard }: RouteKit) {
  const ids = z.object({ id: z.coerce.number().int().positive(), sid: z.coerce.number().int().positive().optional() });
  const p = (req: unknown) => ids.parse((req as { params: unknown }).params);
  const state = (id: number): SignupStateDto => ({ settings: d.repo.signups.settings(id), requests: d.repo.signups.list(id), cars: d.repo.signups.carsOf(id) });

  app.get('/admin/api/championships/:id/signups', async (req, reply) => {
    const { id } = p(req);
    return d.repo.championships.get(id) ? state(id) : fail(reply, new Error('Ese campeonato no existe.'), 404);
  });
  app.put('/admin/api/championships/:id/signup', guard(async (req, reply) => {
    const { id } = p(req);
    const b = body(z.object({ enabled: z.boolean(), askEmail: z.boolean(), askTeam: z.boolean(), askCar: z.boolean(), questions: z.array(z.string().max(300)).max(10), info: z.string().max(2000) }), req);
    if (!d.repo.signups.setSettings(id, cleanSignupSettings(b))) return fail(reply, new Error('Ese campeonato no existe.'), 404);
    return reply.send(state(id));
  }));
  app.post('/admin/api/championships/:id/signups/:sid/approve', guard(async (req, reply) => {
    const { id, sid } = p(req);
    const b = body(z.object({ teamId: z.number().int().positive().nullable().default(null), car: z.string().max(100).nullable().default(null) }), req);
    const r = d.repo.signups.get(id, sid!);
    if (!r) return fail(reply, new Error('Esa solicitud no existe.'), 404);
    if (r.status === 'approved') return fail(reply, new Error('Esa solicitud ya está aprobada.'));
    // Aquí sí se consulta a Steam (acción del organizador): saca el SteamID del enlace y comprueba que el perfil existe
    const prof = await resolveSteamProfile(r.steam);
    const driver = d.repo.findOrCreateDriver(prof.steamId, r.name);
    d.repo.signups.approve(id, sid!, { driverId: driver.id, teamId: b.teamId, car: b.car });
    d.onLapsChanged();
    return reply.send(state(id));
  }));
  app.post('/admin/api/championships/:id/signups/:sid/reject', guard(async (req, reply) => {
    const { id, sid } = p(req);
    if (!d.repo.signups.reject(id, sid!)) return fail(reply, new Error('Esa solicitud no existe.'), 404);
    return reply.send(state(id));
  }));
  app.delete('/admin/api/championships/:id/signups/:sid', guard(async (req, reply) => {
    const { id, sid } = p(req);
    if (!d.repo.signups.remove(id, sid!)) return fail(reply, new Error('Esa solicitud no existe.'), 404);
    return reply.send(state(id));
  }));
  app.get('/admin/api/championships/:id/signups.csv', async (req, reply) => {
    const { id } = p(req);
    if (!d.repo.championships.get(id)) return fail(reply, new Error('Ese campeonato no existe.'), 404);
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="inscripciones-${id}.csv"`).send(d.repo.signups.csv(id));
  });
}
