import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUILTIN_PROFILES, type LapRulesStateDto } from '@howler/shared';
import { recordAnnounceSchema, lapRulesConfigSchema, racePenaltiesSchema } from '../config';
import { resolveRules } from '../core/lap-rules';
import { applyLapAction, revalidate } from '../core/revalidate';
import { st } from '../core/lang';
import { commands } from './plugin-commander';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Reglas de vuelta válida, decisiones sobre vueltas y penalizaciones de carrera. */
export function registerRulesRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard }: RouteKit) {
  // ---------- Reglas de vuelta válida ----------
  const rulesState = (): LapRulesStateDto => ({ config: d.getConfig().lapRules, builtins: BUILTIN_PROFILES });
  /** Reglas a probar: las del cuerpo si las hay, y si no, las guardadas. */
  const rulesFrom = (req: { body: unknown }) => {
    const b = body(z.object({ config: lapRulesConfigSchema.optional() }), req);
    return b.config ?? d.getConfig().lapRules;
  };

  app.get('/admin/api/lap-rules', async () => rulesState());
  app.post('/admin/api/lap-rules', guard(async (req, reply) => {
    const cfg = body(lapRulesConfigSchema, req);
    const known = (id: string) => Object.hasOwn(cfg.profiles, id) || Object.hasOwn(BUILTIN_PROFILES, id);
    if (!known(cfg.default)) throw new Error(`El perfil por defecto «${cfg.default}» no existe.`);
    for (const [track, id] of Object.entries(cfg.tracks)) if (!known(id)) throw new Error(`El perfil «${id}» asignado a ${track} no existe.`);
    d.saveLapRules(cfg);
    return reply.send({ ok: true, ...rulesState() });
  }));
  // Probar: cuántas vueltas del historial cambiarían con esas reglas, sin tocar nada.
  app.post('/admin/api/lap-rules/preview', guard(async (req, reply) => {
    const cfg = rulesFrom(req);
    return reply.send(revalidate(d.repo, (t, l) => resolveRules(cfg, t, l).rules, { dryRun: true }));
  }));
  // Aplicar: vuelve a juzgar todo el historial con las reglas guardadas.
  app.post('/admin/api/lap-rules/apply', guard(async (_req, reply) => {
    const cfg = d.getConfig().lapRules;
    const r = revalidate(d.repo, (t, l) => resolveRules(cfg, t, l).rules, { dryRun: false });
    d.onLapsChanged();
    return reply.send(r);
  }));

  // Decisiones manuales sobre una vuelta concreta.
  app.get('/admin/api/laps', async (req) => {
    const { limit, pending } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(40), pending: z.enum(['0', '1']).optional() }).parse((req as { query: unknown }).query);
    return d.repo.lapAdmin.recent(limit, pending === '1');
  });
  app.post('/admin/api/laps/:id/:action', guard(async (req, reply) => {
    const p = z.object({ id: z.coerce.number().int().positive(), action: z.enum(['void', 'valid', 'reset']) }).parse((req as unknown as { params: unknown }).params);
    const { note } = body(z.object({ note: z.string().trim().max(200).optional() }), req);
    const cfg = d.getConfig().lapRules;
    const r = applyLapAction(d.repo, (t, l) => resolveRules(cfg, t, l).rules, p.id, p.action, note || null);
    if (!r) return fail(reply, new Error('Esa vuelta no existe.'), 404);
    d.onLapsChanged();
    return reply.send({ ok: true, ...r });
  }));

  // Penalizaciones de carrera: avisos guardados, tiempo añadido y descalificaciones, más las automáticas por cortes y choques.
  app.get('/admin/api/penalties/sessions', async () => d.repo.penalties.recentSessions(30));
  app.get('/admin/api/penalties', async (req) => {
    const q = z.object({ sessionId: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse((req as { query: unknown }).query);
    return q.sessionId ? d.repo.penalties.forSession(q.sessionId) : d.repo.penalties.recent(q.limit);
  });
  app.post('/admin/api/penalties', guard(async (req, reply) => {
    const b = body(z.object({
      sessionId: z.number().int().positive(), driverId: z.number().int().positive(), kind: z.enum(['warning', 'time', 'dsq']),
      seconds: z.number().min(1).max(3600).optional(), reason: z.string().trim().max(200).default(''), announce: z.boolean().optional(),
    }), req);
    const id = d.repo.penalties.add(b);
    if (b.announce) {
      const name = d.repo.penalties.forSession(b.sessionId).find((p) => p.id === id)?.driverName ?? 'piloto';
      const what = b.kind === 'dsq' ? st('descalificado') : b.kind === 'time' ? `+${b.seconds} s` : st('aviso');
      // El aviso por chat no hace esperar a quien pone la penalización (sin plugin conectado tardaría en dar el error)
      void d.commander.exec(commands.say(`Howler: ${name}, ${what}${b.reason ? `. ${b.reason}` : ''}`)).catch(() => undefined);
    }
    d.onLapsChanged();
    return reply.send({ id });
  }));
  app.delete('/admin/api/penalties/:id', guard(async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse((req as unknown as { params: unknown }).params);
    if (!d.repo.penalties.remove(id)) return fail(reply, new Error('Esa penalización no existe.'), 404);
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));
  app.get('/admin/api/race-penalties', async () => racePenaltiesSchema.parse(d.getConfig().racePenalties));
  app.post('/admin/api/race-penalties', guard(async (req, reply) => {
    const rules = body(racePenaltiesSchema, req);
    d.saveConfig({ racePenalties: rules });
    d.onLapsChanged();
    return reply.send(rules);
  }));

  app.get('/admin/api/record-announce', async () => recordAnnounceSchema.parse(d.getConfig().recordAnnounce));
  app.post('/admin/api/record-announce', guard(async (req, reply) => {
    const v = body(recordAnnounceSchema, req);
    d.saveConfig({ recordAnnounce: v });
    return reply.send(v);
  }));

}
