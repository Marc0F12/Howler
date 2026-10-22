import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { failReply } from './route-kit';
import type { UpdateService } from '../core/updates';

/** Actualizaciones (solo panel): ver si hay versión nueva, «ahora no», cambiar de canal e instalar. */
export function registerUpdateRoutes(
  app: FastifyInstance,
  d: { updates: UpdateService; saveUpdateSettings: (p: { check?: boolean; channel?: 'stable' | 'beta' }) => void },
) {
  const fail = failReply;

  app.get('/admin/api/update', async () => d.updates.state());
  app.post('/admin/api/update/check', async () => d.updates.check(true));
  app.post('/admin/api/update/dismiss', async (req, reply) => {
    const b = z.object({ version: z.string().regex(/^[\w.+-]{1,40}$/) }).safeParse(req.body);
    if (!b.success) return fail(reply, new Error('Versión no válida.'));
    d.updates.dismiss(b.data.version);
    return d.updates.state();
  });
  app.put('/admin/api/update/settings', async (req, reply) => {
    const b = z.object({ check: z.boolean().optional(), channel: z.enum(['stable', 'beta']).optional() }).strict().safeParse(req.body);
    if (!b.success) return fail(reply, new Error('Datos no válidos.'));
    d.saveUpdateSettings(b.data);
    return b.data.channel ? d.updates.check(true) : d.updates.state();
  });
  app.post('/admin/api/update/apply', async (_req, reply) => {
    // La descarga puede tardar: se deja corriendo y el panel pregunta por el avance con GET /admin/api/update.
    const run = d.updates.apply().catch(() => undefined);
    await Promise.race([run, new Promise((r) => setTimeout(r, 60))]);
    const s = d.updates.state();
    return s.install.state === 'error' ? fail(reply, new Error(s.install.error ?? 'No se pudo actualizar.')) : s;
  });
}
