import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { OnlineDriver } from '@howler/shared';
import type { Repository } from '../db/repository';

const id = z.object({ id: z.coerce.number().int().positive() });

/** Gestor de pilotos (solo panel): listar, renombrar, ocultar y unir duplicados. */
export function registerDriverRoutes(app: FastifyInstance, d: { repo: Repository; online: () => OnlineDriver[]; onChanged: () => void }) {
  const wrap = async (reply: FastifyReply, fn: () => unknown) => {
    try { const r = await fn(); d.onChanged(); return r; } catch (e) {
      if (e && typeof e === 'object' && 'issues' in e) return reply.code(400).send({ error: 'Datos no válidos.' });
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  const list = () => d.repo.driverAdmin.list();
  app.get('/admin/api/drivers', async () => list());
  app.put('/admin/api/drivers/:id', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    const b = z.object({ name: z.string().trim().min(1).max(100), hidden: z.boolean() }).partial().strict().parse(req.body);
    if (b.name !== undefined) d.repo.driverAdmin.rename(n, b.name);
    if (b.hidden !== undefined) d.repo.driverAdmin.setHidden(n, b.hidden);
    return list();
  }));
  app.post('/admin/api/drivers/:id/merge', async (req, reply) => wrap(reply, () => {
    const from = id.parse(req.params).id;
    const { intoId } = z.object({ intoId: z.number().int().positive() }).parse(req.body);
    if (d.online().some((o) => o.driverId === from || o.driverId === intoId)) throw new Error('Uno de los dos pilotos está conectado ahora mismo. Espera a que salga.');
    d.repo.driverAdmin.merge(from, intoId);
    return list();
  }));
}
