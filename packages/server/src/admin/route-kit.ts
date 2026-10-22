import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { st } from '../core/lang';
import type { AdminDeps } from './admin-routes';
import { commands } from './plugin-commander';

/** Utilidades comunes de las rutas del panel: errores, validación del cuerpo y opciones de parada del servidor. */
export interface RouteKit {
  fail: (reply: FastifyReply, e: unknown, code?: number) => FastifyReply;
  body: <T extends z.ZodTypeAny>(schema: T, req: { body: unknown }) => z.infer<T>;
  /** Envuelve una ruta: los errores de validación y los lanzados se devuelven como `{ error }` con código 400. */
  guard: (fn: (req: { body: unknown }, reply: FastifyReply) => Promise<unknown>) => (req: { body: unknown }, reply: FastifyReply) => Promise<unknown>;
  /** Parada del servidor: avisa a los jugadores por el chat solo si hay alguien conectado. */
  stopOpts: () => { warnSeconds: number; announce: (seconds: number) => Promise<void> };
  /** Si `apply` y el servidor está en marcha, lo reinicia (sin esperar) y devuelve `true`; si no, `false`. */
  restartIfRunning: (apply: boolean) => boolean;
}

/** Respuesta de error uniforme del panel: `{ error }`. */
export const failReply = (reply: FastifyReply, e: unknown, code = 400): FastifyReply => reply.code(code).send({ error: e instanceof Error ? e.message : String(e) });

export function routeKit(d: AdminDeps): RouteKit {
  const fail: RouteKit['fail'] = failReply;
  const body: RouteKit['body'] = (schema, req) => schema.parse(req.body);
  const guard: RouteKit['guard'] = (fn) => async (req, reply) => {
    try { return await fn(req, reply); } catch (e) { return e instanceof z.ZodError ? fail(reply, new Error(e.issues.map((i) => i.message).join('; '))) : fail(reply, e); }
  };
  const stopOpts: RouteKit['stopOpts'] = () => ({
    warnSeconds: d.online().length > 0 ? d.getConfig().server.stopWarningSeconds : 0, // sin jugadores no hace falta avisar ni esperar
    announce: async (s) => { await d.commander.exec(commands.say(st('El servidor se parará en {n} segundos.', { n: s }))); },
  });
  const restartIfRunning: RouteKit['restartIfRunning'] = (apply) => {
    if (!apply || d.process.snapshot().state === 'stopped') return false;
    d.process.restart(stopOpts()).catch(() => {});
    return true;
  };
  return { fail, body, guard, stopOpts, restartIfRunning };
}
