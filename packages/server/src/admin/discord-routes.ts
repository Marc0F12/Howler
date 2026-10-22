import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCORD_EVENT_IDS, type DiscordEventId } from '@howler/shared';
import { discordSchema } from '../config';
import { isDiscordWebhook, renderEvent, sampleValues, sendDiscord, testMessage, webhooksOf } from '../core/discord';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Avisos a Discord (el enlace del webhook es un secreto: nunca se devuelve entero). */
export function registerDiscordRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard }: RouteKit) {
  // ---- Discord: el enlace del webhook es un secreto, así que nunca se devuelve entero ----
  const discordState = () => {
    const c = d.getConfig().discord;
    const hooks = webhooksOf(c).map((w) => ({ id: w.id, name: w.name, hint: `…${w.url.slice(-4)}` }));
    return { configured: hooks.length > 0, hint: hooks[0]?.hint ?? '', hooks, serverName: c.serverName, publicUrl: c.publicUrl, events: c.events };
  };
  const saveDiscordSection = (next: Record<string, unknown>) => { d.saveConfig({ discord: { ...d.getConfig().discord, ...next } }); };
  app.get('/admin/api/discord', async () => discordState());
  app.post('/admin/api/discord', guard(async (req, reply) => {
    // webhookUrl ausente = conservar el que hay; '' = quitarlo. `events` solo cambia los avisos que lleguen.
    const b = body(discordSchema.partial(), req);
    const url = b.webhookUrl?.trim();
    if (url && !isDiscordWebhook(url)) return fail(reply, new Error('Ese enlace no parece un webhook de Discord. Debe empezar por https://discord.com/api/webhooks/…'));
    d.saveConfig({ discord: { ...(url !== undefined ? { webhookUrl: url } : {}), ...(b.publicUrl !== undefined ? { publicUrl: b.publicUrl.trim() } : {}), ...(b.serverName !== undefined ? { serverName: b.serverName.trim() } : {}), ...(b.events ? { events: b.events } : {}) } });
    return reply.send(discordState());
  }));
  // Más canales: cada aviso se manda a todos los que haya.
  app.post('/admin/api/discord/webhooks', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string().trim().min(1).max(40), url: z.string().trim().max(300) }), req);
    if (!isDiscordWebhook(b.url)) return fail(reply, new Error('Ese enlace no parece un webhook de Discord. Debe empezar por https://discord.com/api/webhooks/…'));
    const cur = d.getConfig().discord;
    if (cur.webhooks.length >= 10) return fail(reply, new Error('Máximo 10 canales.'));
    if (webhooksOf(cur).some((w) => w.url === b.url)) return fail(reply, new Error('Ese webhook ya está añadido.'));
    saveDiscordSection({ webhooks: [...cur.webhooks, { id: randomBytes(4).toString('hex'), name: b.name, url: b.url }] });
    return reply.send(discordState());
  }));
  app.delete('/admin/api/discord/webhooks/:id', guard(async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9]{1,16}$/) }).parse((req as unknown as { params: unknown }).params);
    const cur = d.getConfig().discord;
    if (id === 'main') saveDiscordSection({ webhookUrl: '' });
    else saveDiscordSection({ webhooks: cur.webhooks.filter((w) => w.id !== id) });
    return reply.send(discordState());
  }));
  app.post('/admin/api/discord/test', guard(async (req, reply) => {
    // Sin `event` manda el mensaje de prueba de conexión; con `event`, ese aviso con datos de ejemplo y el texto que haya en pantalla (`title`/`message`).
    const b = body(z.object({
      webhookUrl: z.string().max(300).optional(), event: z.enum(DISCORD_EVENT_IDS as [string, ...string[]]).optional(),
      title: z.string().max(120).optional(), message: z.string().max(500).optional(),
    }), req);
    const cfg = d.getConfig().discord;
    const urls = b.webhookUrl?.trim() ? [b.webhookUrl.trim()] : webhooksOf(cfg).map((w) => w.url);
    if (!urls.length) return fail(reply, new Error('Primero pega el enlace del webhook.'));
    const msg = b.event
      ? renderEvent(b.event as DiscordEventId, { ...cfg, events: { [b.event]: { title: b.title, message: b.message } } }, sampleValues(b.event as DiscordEventId))
      : testMessage();
    const errs = (await Promise.all(urls.map((u) => sendDiscord(u, msg)))).filter((e): e is string => !!e);
    const err = errs[0];
    return err ? fail(reply, new Error(err)) : reply.send({ ok: true });
  }));

}
