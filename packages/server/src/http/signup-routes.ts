import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cleanSignupInput } from '@howler/shared';
import type { Repository } from '../db/repository';
import { clientIp } from './rate-limit';

/** Cuántas solicitudes puede mandar una misma dirección por hora (sobre el límite general de la web). */
export const SIGNUP_PER_HOUR = 5;

/**
 * Inscripción pública a campeonatos: es lo único que ESCRIBE en la web pública. Cuerpo pequeño, campo trampa, límite por
 * dirección y por campeonato, todo validado, y NUNCA se consulta a Steam desde aquí (eso lo hace el organizador al aprobar).
 */
export function registerSignupRoutes(app: FastifyInstance, repo: Repository, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>();
  const hit = (ip: string) => {
    const t = now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    const h = hits.get(ip);
    if (!h || h.reset < t) { hits.set(ip, { n: 1, reset: t + 3600_000 }); return true; }
    h.n++;
    return h.n <= SIGNUP_PER_HOUR;
  };
  const idParam = z.object({ id: z.coerce.number().int().positive() });

  app.get('/api/championships/:id/signup', async (req, reply) => {
    const form = repo.signups.formFor(idParam.parse(req.params).id);
    return form ?? reply.code(404).send({ error: 'No hay inscripción abierta.' });
  });

  app.post('/api/championships/:id/signup', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const id = idParam.parse(req.params).id;
    const form = repo.signups.formFor(id);
    if (!form) return reply.code(404).send({ error: 'No hay inscripción abierta.' });
    const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    // Un bot rellena el campo escondido: se le contesta que todo fue bien y no se guarda nada.
    if (typeof raw.website === 'string' && raw.website.trim() !== '') return { ok: true, result: 'created' };
    if (!hit(clientIp(req.socket.remoteAddress, req.headers))) return reply.code(429).header('Retry-After', '3600').send({ error: 'Demasiados intentos. Prueba más tarde.' });
    const v = cleanSignupInput({ ...raw, team: form.askTeam ? raw.team : '', email: form.askEmail ? raw.email : '' }, form);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const result = repo.signups.submit(id, v.value, form.questions);
    if (result === 'full') return reply.code(409).send({ error: 'Ahora mismo no se admiten más solicitudes. Avisa al organizador.' });
    return { ok: true, result };
  });
}
