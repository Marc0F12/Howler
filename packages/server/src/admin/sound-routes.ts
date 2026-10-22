import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_SOUND, MAX_SOUND_BYTES, type SoundsDto } from '@howler/shared';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Sonidos del aviso de récord: lista, elegir, subir uno propio (WAV/MP3/OGG corto) y borrarlo. */
export function registerSoundRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard }: RouteKit) {
  app.addContentTypeParser(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg'], { parseAs: 'buffer', bodyLimit: MAX_SOUND_BYTES + 1024 }, (_req, payload, done) => done(null, payload));
  app.get('/admin/api/sounds', async (): Promise<SoundsDto> => d.sounds?.list() ?? { record: DEFAULT_SOUND, custom: [], maxSeconds: 5, volumeStyle: 'banana' });
  app.put('/admin/api/sounds/select', guard(async (req, reply) => {
    if (!d.sounds) return fail(reply, new Error('Los sonidos no están disponibles.'), 501);
    d.sounds.select(body(z.object({ record: z.string().min(1).max(40) }), req).record);
    return reply.send(d.sounds.list());
  }));
  app.put('/admin/api/sounds/volume-style', guard(async (req, reply) => {
    if (!d.sounds) return fail(reply, new Error('Los sonidos no están disponibles.'), 501);
    d.sounds.setVolumeStyle(body(z.object({ style: z.string().min(1).max(20) }), req).style);
    return reply.send(d.sounds.list());
  }));
  // El navegador manda el archivo tal cual; el nombre y la duración que midió van en la URL.
  app.post('/admin/api/sounds', async (req, reply) => {
    if (!d.sounds) return fail(reply, new Error('Los sonidos no están disponibles.'), 501);
    if (!Buffer.isBuffer(req.body)) return fail(reply, new Error('Manda el sonido como archivo WAV, MP3 u OGG.'));
    const q = z.object({ name: z.string().max(80).default(''), seconds: z.coerce.number().min(0).max(600).default(0) }).safeParse(req.query);
    if (!q.success) return fail(reply, new Error('Datos del sonido no válidos.'));
    try { d.sounds.add(req.body, q.data.name, q.data.seconds); return reply.send(d.sounds.list()); } catch (e) { return fail(reply, e); }
  });
  app.delete('/admin/api/sounds/:id', guard(async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{12}$/) }).parse((req as unknown as { params: unknown }).params);
    if (!d.sounds?.remove(id)) return fail(reply, new Error('Ese sonido no existe.'), 404);
    return reply.send(d.sounds.list());
  }));
}
