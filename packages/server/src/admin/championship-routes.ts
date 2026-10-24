import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type InstalledContentDto } from '@howler/shared';
import { championshipInputSchema } from './championship-schema';
import { hasAlpha, imageFileOf, MAX_IMAGE_BYTES } from '../core/championship-images';
import { fetchModInfo } from '../core/mod-info';
import { resolveSteamProfile } from '../core/steam-profile';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Campeonatos, imágenes de portada, perfiles de Steam y fichas de mods. */
export function registerChampionshipRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard }: RouteKit) {
  // Imagen de portada: el navegador manda el archivo tal cual (cuerpo binario). Se valida por sus bytes y se guarda con otro nombre.
  app.addContentTypeParser(['image/png', 'image/jpeg', 'image/webp', 'image/gif'], { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES + 1024 }, (_req, payload, done) => done(null, payload));
  const pruneImages = () => {
    try { d.images?.prune(new Set(d.repo.championships.imageRefs().map((r) => imageFileOf(r)).filter((f): f is string => f != null))); } catch { /* limpiar no es crítico */ }
  };
  app.post('/admin/api/championship-image', async (req, reply) => {
    if (!d.images) return fail(reply, new Error('Las imágenes no están disponibles.'), 501);
    if (!Buffer.isBuffer(req.body)) return fail(reply, new Error('Manda la imagen como archivo PNG, JPG, WebP o GIF.'));
    try { return reply.send({ imageUrl: d.images.save(req.body), hasAlpha: hasAlpha(req.body) }); } catch (e) { return fail(reply, e); }
  });

  // Campeonatos: crear/editar con el asistente, asignar sesiones, ajustes a mano. Los borradores solo se ven aquí.
  const champId = z.object({ id: z.coerce.number().int().positive() });
  const params = (req: unknown) => champId.parse((req as { params: unknown }).params).id;
  const notifyStatus = (id: number, status: string) => { if (status === 'active') d.onChampionship?.('started', id); else if (status === 'finished') d.onChampionship?.('finished', id); };
  app.get('/admin/api/content/installed', async (): Promise<InstalledContentDto> => d.installedContent?.() ?? { cars: [], tracks: [] });
  app.get('/admin/api/championships', async () => d.repo.championships.list(true).map((c) => ({ ...c, pendingSignups: d.repo.signups.pendingCount(c.id) })));
  app.get('/admin/api/championships/:id', async (req, reply) => d.repo.championships.get(params(req)) ?? fail(reply, new Error('Ese campeonato no existe.'), 404));
  app.post('/admin/api/championships', guard(async (req, reply) => {
    const input = body(championshipInputSchema, req);
    const id = d.repo.championships.save(null, input);
    if (input.status === 'active') d.onChampionship?.('started', id);
    pruneImages();
    d.onLapsChanged();
    return reply.send({ id });
  }));
  app.put('/admin/api/championships/:id', guard(async (req, reply) => {
    const id = params(req);
    const input = body(championshipInputSchema, req);
    const before = d.repo.championships.get(id)?.status;
    d.repo.championships.save(id, input);
    if (before && before !== input.status) notifyStatus(id, input.status as string);
    pruneImages();
    d.onLapsChanged();
    return reply.send({ id });
  }));
  app.delete('/admin/api/championships/:id', guard(async (req, reply) => {
    if (!d.repo.championships.remove(params(req))) return fail(reply, new Error('Ese campeonato no existe.'), 404);
    pruneImages();
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));
  app.post('/admin/api/championships/:id/status', guard(async (req, reply) => {
    const b = body(z.object({ status: z.enum(['draft', 'active', 'finished']) }), req);
    const cid = params(req);
    const before = d.repo.championships.get(cid)?.status;
    if (!d.repo.championships.setStatus(cid, b.status)) return fail(reply, new Error('Ese campeonato no existe.'), 404);
    if (before !== b.status) notifyStatus(cid, b.status);
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));
  app.get('/admin/api/championships/:id/candidates', async (req) => d.repo.championships.candidates(params(req)));
  app.post('/admin/api/championships/:id/assign', guard(async (req, reply) => {
    const b = body(z.object({ roundId: z.number().int().positive(), kind: z.enum(['race', 'quali']), sessionId: z.number().int().positive().nullable() }), req);
    if (!d.repo.championships.assign(params(req), b.roundId, b.kind, b.sessionId)) return fail(reply, new Error('Esa carrera no es de este campeonato.'), 404);
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));
  app.post('/admin/api/championships/:id/adjustments', guard(async (req, reply) => {
    const b = body(z.object({ roundId: z.number().int().positive(), driverId: z.number().int().positive(), points: z.number().min(-1000).max(1000), reason: z.string().trim().max(200).default('') }), req);
    const id = d.repo.championships.addAdjustment(params(req), b);
    d.onLapsChanged();
    return reply.send({ id });
  }));
  app.delete('/admin/api/championships/:id/adjustments/:adjId', guard(async (req, reply) => {
    const p = z.object({ id: z.coerce.number().int().positive(), adjId: z.coerce.number().int().positive() }).parse((req as unknown as { params: unknown }).params);
    if (!d.repo.championships.removeAdjustment(p.id, p.adjId)) return fail(reply, new Error('Ese ajuste no existe.'), 404);
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));
  // Inscribir a alguien que aún no ha pasado por el servidor: se pega su perfil de Steam. Devuelve solo id interno y nombre.
  app.post('/admin/api/steam-resolve', guard(async (req, reply) => {
    const b = body(z.object({ link: z.string().min(1).max(300) }), req);
    const p = await resolveSteamProfile(b.link);
    return reply.send(d.repo.findOrCreateDriver(p.steamId, p.name));
  }));
  // Rellenar la ficha de un mod leyendo su página web (título, imagen, especificaciones si las trae). Mejor esfuerzo.
  app.post('/admin/api/mod-info', guard(async (req, reply) => {
    const b = body(z.object({ url: z.string().trim().min(1).max(500) }), req);
    return reply.send(await fetchModInfo(b.url));
  }));
}
