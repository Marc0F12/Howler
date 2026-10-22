import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AccountsStateDto } from '@howler/shared';
import type { AdminDeps } from './admin-routes';
import { AuthService } from './auth';
import type { RouteKit } from './route-kit';

/** Cuentas del panel y acceso remoto. Gestión solo desde el propio PC (`LOCAL_ONLY` en auth.ts); login/logout/ping los puede usar quien llega de fuera. */
export function registerAccountRoutes(app: FastifyInstance, d: AdminDeps, { body, guard }: RouteKit) {
  const auth = d.auth;
  if (!auth) { app.get('/admin/api/ping', async () => ({ admin: true, login: false, role: 'admin', name: null, local: true })); return; }
  const secure = (req: { headers: Record<string, unknown> }) => req.headers['x-forwarded-proto'] === 'https';
  const state = (): AccountsStateDto => ({ accounts: auth.list(), remoteEnabled: d.getConfig().admin.remote.enabled, port: d.getConfig().admin.port });
  const idOf = (req: unknown) => String((req as { params: { id: string } }).params.id);

  app.get('/admin/api/ping', async (req) => auth.whoAmI(auth.caller(req)));

  app.post('/admin/api/login', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string().max(100), password: z.string().max(400) }), req);
    if (!auth.remoteEnabled) return reply.code(403).send({ error: 'El acceso remoto está desactivado.' });
    const { token, account } = await auth.login(b.name, b.password, (req as unknown as { socket: { remoteAddress?: string } }).socket.remoteAddress ?? '');
    reply.header('Set-Cookie', AuthService.cookie(token, secure(req as never)));
    return reply.send({ ok: true, name: account.name, role: account.role });
  }));
  app.post('/admin/api/logout', guard(async (req, reply) => {
    auth.logout(AuthService.cookieToken((req as unknown as { headers: Record<string, unknown> }).headers.cookie));
    reply.header('Set-Cookie', AuthService.clearCookie(secure(req as never)));
    return reply.send({ ok: true });
  }));

  app.get('/admin/api/accounts', async () => state());
  app.post('/admin/api/accounts', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string(), password: z.string(), role: z.string() }), req);
    await auth.create(b);
    return reply.send(state());
  }));
  app.put('/admin/api/accounts/:id', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string().optional(), password: z.string().optional(), role: z.string().optional() }), req);
    await auth.update(idOf(req), b);
    return reply.send(state());
  }));
  app.delete('/admin/api/accounts/:id', guard(async (req, reply) => {
    auth.remove(idOf(req));
    return reply.send(state());
  }));
  /** Activa o apaga que el panel escuche fuera de este PC. Se aplica al reiniciar Howler. */
  app.post('/admin/api/accounts/remote', guard(async (req, reply) => {
    const b = body(z.object({ enabled: z.boolean() }), req);
    if (b.enabled && auth.count() === 0) throw new Error('Crea primero una cuenta: sin cuentas nadie podría entrar desde fuera.');
    d.saveConfig({ admin: { remote: { enabled: b.enabled } } });
    return reply.send({ ...state(), restartRequired: true });
  }));
}
