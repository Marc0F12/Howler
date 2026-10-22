import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MhError, type MultiHowler } from '../core/multihowler';
import { requestBodySchema, statusBodySchema, syncRequestSchema } from '../core/mh-wire';

const bearer = (req: FastifyRequest) => /^Bearer ([0-9a-f]{64})$/.exec(String(req.headers.authorization ?? ''))?.[1];

/**
 * Rutas que usan OTROS Howlers (van en la web pública). La solicitud usa la clave; el resto, el token privado del vínculo.
 * Nada de aquí devuelve identidades, tokens ajenos ni Steam IDs, salvo el intercambio autenticado de vueltas.
 */
export function registerMultiHowlerPublic(app: FastifyInstance, mh: MultiHowler) {
  const wrap = (reply: FastifyReply, fn: () => unknown) => {
    try { return fn(); } catch (e) {
      if (e instanceof MhError) return reply.code(e.status).send({ error: e.message });
      if (e && typeof e === 'object' && 'issues' in e) return reply.code(400).send({ error: 'Petición no válida.' });
      throw e;
    }
  };

  app.post('/api/mh/request', { bodyLimit: 16 * 1024 }, async (req, reply) => wrap(reply, () => mh.requestLink(req.ip, requestBodySchema.parse(req.body))));
  app.post('/api/mh/request/status', { bodyLimit: 16 * 1024 }, async (req, reply) => wrap(reply, () => mh.linkStatus(req.ip, statusBodySchema.parse(req.body))));
  // El token se comprueba ANTES de leer el cuerpo: así nadie sin vínculo puede hacer que se descarguen y analicen 32 MB.
  const authFirst = async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    try { mh.authenticate(bearer(req)); } catch (e) {
      if (!(e instanceof MhError)) throw e;
      reply.code(e.status).send({ error: e.message });
      return reply as never;
    }
    return payload as never;
  };
  app.post('/api/mh/sync', { bodyLimit: 32 * 1024 * 1024, preParsing: authFirst }, async (req, reply) => wrap(reply, () => { mh.authenticate(bearer(req)); return mh.handleSync(bearer(req), syncRequestSchema.parse(req.body)); }));
  app.post('/api/mh/unlink', { bodyLimit: 16 * 1024, preParsing: authFirst }, async (req, reply) => wrap(reply, () => { mh.handleUnlink(bearer(req)); return { ok: true }; }));
}
