import type { FastifyInstance } from 'fastify';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Eventos programados (ver `scheduler.ts`). */
export function registerScheduleRoutes(app: FastifyInstance, d: AdminDeps, { guard }: RouteKit) {
  const sch = d.scheduler;
  if (!sch) return;
  const idOf = (req: unknown) => String((req as { params: { id: string } }).params.id);
  app.get('/admin/api/schedule', async () => sch.state());
  app.post('/admin/api/schedule', guard(async (req, reply) => reply.send(sch.save(null, req.body))));
  app.put('/admin/api/schedule/:id', guard(async (req, reply) => reply.send(sch.save(idOf(req), req.body))));
  app.delete('/admin/api/schedule/:id', guard(async (req, reply) => reply.send(sch.remove(idOf(req)))));
  app.post('/admin/api/schedule/:id/run', guard(async (req, reply) => reply.send(await sch.runNow(idOf(req)))));
}
