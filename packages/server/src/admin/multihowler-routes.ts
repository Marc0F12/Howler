import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MhError, type MultiHowler } from '../core/multihowler';

const id = z.object({ id: z.coerce.number().int().positive() });
const perms = z.object({ give: z.boolean(), receive: z.boolean() });

/** Panel de MultiHowler (solo 127.0.0.1): clave, solicitudes, vínculos y permisos. */
export function registerMultiHowlerAdmin(app: FastifyInstance, mh: MultiHowler) {
  const wrap = async (reply: FastifyReply, fn: () => unknown) => {
    try { return await fn(); } catch (e) {
      if (e instanceof MhError) return reply.code(e.status).send({ error: e.message });
      if (e && typeof e === 'object' && 'issues' in e) return reply.code(400).send({ error: 'Datos no válidos.' });
      throw e;
    }
  };
  const peerOr404 = (n: number) => mh.store.peer(n) ?? (() => { throw new MhError(404, 'Vínculo desconocido.'); })();

  app.get('/admin/api/multihowler', async () => mh.state());

  app.put('/admin/api/multihowler/identity', async (req, reply) => wrap(reply, () => {
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), address: z.string().trim().max(200).optional(), badge: z.string().max(100).optional(), badgeBg: z.string().max(7).optional(), badgeFg: z.string().max(7).optional() }).parse(req.body);
    if (b.address && !/^https?:\/\//i.test(b.address)) throw new MhError(400, 'La dirección debe empezar por http:// o https://');
    mh.store.setIdentity(b);
    return mh.state();
  }));

  app.post('/admin/api/multihowler/key/regenerate', async () => {
    mh.store.regenerateKey();
    return mh.state();
  });

  app.post('/admin/api/multihowler/identity/regenerate', async (req, reply) => wrap(reply, async () => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    await mh.regenerateIdentity();
    return mh.state();
  }));

  app.post('/admin/api/multihowler/link', async (req, reply) => wrap(reply, async () => {
    const b = perms.extend({ url: z.string().max(300), key: z.string().max(100) }).parse(req.body);
    await mh.startLink(b);
    await mh.syncAll();
    return mh.state();
  }));

  app.post('/admin/api/multihowler/peers/:id/approve', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    const b = perms.parse(req.body);
    const p = peerOr404(n);
    if (p.direction !== 'incoming' || p.status !== 'pending') throw new MhError(409, 'Esta solicitud ya no está pendiente.');
    mh.store.approve(n, b.give, b.receive);
    return mh.state();
  }));
  app.post('/admin/api/multihowler/peers/:id/deny', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    const p = peerOr404(n);
    if (p.direction !== 'incoming' || p.status !== 'pending') throw new MhError(409, 'Esta solicitud ya no está pendiente.');
    mh.store.deny(n);
    return mh.state();
  }));
  app.post('/admin/api/multihowler/peers/:id/revoke', async (req, reply) => wrap(reply, async () => {
    const n = id.parse(req.params).id;
    peerOr404(n);
    await mh.revoke(n);
    return mh.state();
  }));
  app.post('/admin/api/multihowler/peers/:id/sync', async (req, reply) => wrap(reply, async () => {
    const n = id.parse(req.params).id;
    const p = peerOr404(n);
    if (p.direction !== 'outgoing') throw new MhError(409, 'Este vínculo lo inicia el otro Howler: espera a que conecte.');
    await mh.syncPeer(n);
    return mh.state();
  }));
  app.put('/admin/api/multihowler/peers/:id', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    const b = z.object({ give: z.boolean(), receive: z.boolean(), shareChampionships: z.boolean(), shareTraces: z.boolean(), hidden: z.boolean() }).partial().strict().parse(req.body);
    peerOr404(n);
    mh.store.updatePeer(n, b);
    return mh.state();
  }));
  app.delete('/admin/api/multihowler/peers/:id/data', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    const p = peerOr404(n);
    if (p.status === 'approved') throw new MhError(409, 'Revoca el vínculo antes de borrar sus datos (si no, volverían en la próxima sincronización).');
    if (!p.peerUuid) throw new MhError(409, 'Con este vínculo no se recibió ningún dato.');
    const deleted = mh.store.deleteOriginData(p.peerUuid);
    mh.onLapsChanged();
    return { ...mh.state(), deleted };
  }));
  app.delete('/admin/api/multihowler/peers/:id', async (req, reply) => wrap(reply, () => {
    const n = id.parse(req.params).id;
    if (!mh.store.deletePeer(n)) throw new MhError(409, 'Un vínculo activo hay que revocarlo antes de quitarlo.');
    return mh.state();
  }));
}
