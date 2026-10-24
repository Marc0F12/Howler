import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readSessionSettings, writeSessionSettings } from './server-config';
import { readSessionPanel, writeSessionPanel } from './session-cfg';
import { importUserSetup, listServerSetups, listUserSetups } from './setups';
import { deleteSessionPreset, readSessionPresets, saveSessionPreset } from './session-presets';
import { readServerPassword, writeServerPassword } from './server-password';
import { readEntryList, saveEntryList, saveServerTrack, type EntrySlot } from './entry-list';
import { allowMissingChecksums, applyCarChecksums, readCarChecksums } from './car-checksums';
import { applyIgnoreFlag, preflightDiagnosis } from './server-diagnosis';
import { SMART_KEYS } from '@howler/shared';
import { applySmart, describeSmart } from './smart-settings';
import { readServerSheet, saveServerSheet } from './server-sheet';
import { deleteSheetPreset, readSheetPresets, saveSheetPreset, setDefaultSheetPreset } from './sheet-presets';
import { readWeatherState, saveWeatherFx, saveWeatherList } from './weather';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

/** Climas, lista de coches, data.acd y ajustes de sesión: todo lo que se edita en los archivos del preset del servidor. */
export function registerPresetRoutes(app: FastifyInstance, d: AdminDeps, { fail, body, guard, restartIfRunning }: RouteKit) {
  // ---- Climas: sistemas instalados y lista de climas del preset ----
  app.get('/admin/api/weather', async (_req, reply) => {
    const c = d.getConfig();
    try { return readWeatherState(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  // Lista de coches del servidor (entry_list.ini del preset)
  const slotSchema = z.object({
    model: z.string().min(1).max(100), skin: z.string().max(100), driverName: z.string().max(60), team: z.string().max(60), guid: z.string().max(400),
    ballast: z.number().int(), restrictor: z.number().int(), fixedSetup: z.string().max(100), spectator: z.boolean(),
    extras: z.array(z.tuple([z.string().max(60), z.string().max(200)])).max(20),
    /** Piloto de Howler al que se reserva la plaza: el servidor pone su Steam ID (que nunca sale por la API). */
    driverId: z.number().int().nullable().optional(),
  });
  app.get('/admin/api/entry-list', async (_req, reply) => {
    const c = d.getConfig();
    try { return describeEntryList(readEntryList(c.serverDir, c.server.preset)); } catch (e) { return fail(reply, e, 404); }
  });
  /** Añade a cada plaza el piloto de Howler que la tiene reservada y las plazas de boxes del circuito (si AC lo dice). */
  const describeEntryList = (st: ReturnType<typeof readEntryList>) => {
    const boxes = d.content?.().trackCard(st.track, st.layout)?.specs['Boxes'];
    const pitboxes = boxes && /^\d+/.test(boxes) ? Number(/^\d+/.exec(boxes)![0]) : null;
    const slots = st.slots.map((s) => {
      const first = s.guid.split(';')[0] ?? '';
      const dr = /^\d{17}$/.test(first) ? d.repo.driverBySteam(first) : null;
      return { ...s, driverId: dr?.id ?? null };
    });
    return { ...st, slots, pitboxes };
  };
  /** Circuito del servidor (preset). Se aplica al reiniciar. */
  app.put('/admin/api/server-track', guard(async (req, reply) => {
    const b = body(z.object({ track: z.string().min(1).max(100), layout: z.string().max(100), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    saveServerTrack(c.serverDir, c.server.preset, b.track, b.layout);
    const restarting = restartIfRunning(b.applyAndRestart);
    return reply.send({ ...describeEntryList(readEntryList(c.serverDir, c.server.preset)), restarting });
  }));
  app.put('/admin/api/entry-list', guard(async (req, reply) => {
    const b = body(z.object({ slots: z.array(slotSchema).min(1).max(100), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const slots = b.slots.map(({ driverId, ...s }, i): EntrySlot => {
      if (driverId == null) return s as EntrySlot;
      const steam = d.repo.driverSteamId(driverId);
      if (!steam || !/^\d{17}$/.test(steam)) throw new Error(`Plaza ${i + 1}: ese piloto aún no tiene un Steam ID real (todavía no se ha conectado), no se le puede reservar la plaza.`);
      return { ...s, guid: steam } as EntrySlot;
    });
    const saved = saveEntryList(c.serverDir, c.server.preset, slots);
    const restarting = restartIfRunning(b.applyAndRestart);
    return reply.send({ ...describeEntryList(saved), restarting });
  }));
  // Compuestos de neumático de los coches de la lista del servidor (para el selector de «Compuestos permitidos»)
  app.get('/admin/api/tyres', async (_req, reply) => {
    const c = d.getConfig();
    try {
      const reader = d.content?.();
      const models = [...new Set(readEntryList(c.serverDir, c.server.preset).slots.filter((s) => !s.spectator).map((s) => s.model))];
      return { cars: models.map((id) => ({ id, name: reader?.carInfo(id)?.name ?? id, tyres: reader?.carTyres(id) ?? [] })) };
    } catch (e) { return fail(reply, e, 404); }
  });
  app.get('/admin/api/content/cars/:id/skins', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    return d.content?.().carSkins(id) ?? [];
  });
  app.get('/admin/api/content/cars/:id/skins/:skin/preview', async (req, reply) => {
    const { id, skin } = z.object({ id: z.string().min(1).max(100), skin: z.string().min(1).max(100) }).parse(req.params);
    const p = d.content?.().skinPreview(id, skin);
    if (!p) return reply.code(404).send({ error: 'Sin imagen' });
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=300').send(createReadStream(p));
  });
  // data.acd de los coches: dejar de exigirlo a los jugadores (ver car-checksums.ts)
  app.get('/admin/api/car-checksums', async (_req, reply) => {
    const c = d.getConfig();
    try { return readCarChecksums(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/car-checksums', guard(async (req, reply) => {
    const b = body(z.object({ models: z.array(z.string().max(80)).min(1).max(100), skip: z.boolean(), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const r = applyCarChecksums(c.serverDir, c.server.preset, b.models, b.skip);
    const restarting = restartIfRunning(b.applyAndRestart && r.changed.length > 0);
    return reply.send({ ok: true, ...r, restarting });
  }));
  app.post('/admin/api/car-checksums/allow', guard(async (req, reply) => {
    const b = body(z.object({ on: z.boolean(), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const changed = allowMissingChecksums(c.serverDir, c.server.preset, b.on);
    const restarting = restartIfRunning(b.applyAndRestart && changed);
    return reply.send({ ok: true, changed, restarting });
  }));
  // Problemas que harían caer el servidor al arrancar (se ven antes) y su arreglo de un clic (ver server-diagnosis.ts)
  app.get('/admin/api/server/diagnosis', async (_req, reply) => {
    const c = d.getConfig();
    try { return preflightDiagnosis(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/server/fix', guard(async (req, reply) => {
    const b = body(z.object({ fix: z.enum(['allow-track-params', 'allow-car-checksums']), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const changed = applyIgnoreFlag(c.serverDir, c.server.preset, b.fix === 'allow-track-params' ? 'MissingTrackParams' : 'MissingCarChecksums');
    const restarting = restartIfRunning(b.applyAndRestart && changed);
    return reply.send({ ok: true, changed, restarting });
  }));
  // Ajustes inteligentes (On/Off/Auto): WeatherFX, datos del circuito y data.acd (ver smart-settings.ts)
  app.get('/admin/api/smart-settings', async (_req, reply) => {
    const c = d.getConfig();
    try { return { settings: describeSmart(c.serverDir, c.server.preset, c.smartSettings) }; } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/smart-settings', guard(async (req, reply) => {
    const b = body(z.object({ key: z.enum(SMART_KEYS as [string, ...string[]]), mode: z.enum(['on', 'off', 'auto']), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const modes = { ...c.smartSettings, [b.key]: b.mode };
    const changed = applySmart(c.serverDir, c.server.preset, modes);
    d.saveConfig({ smartSettings: modes });
    const restarting = restartIfRunning(b.applyAndRestart);
    return reply.send({ ok: true, changed, settings: describeSmart(c.serverDir, c.server.preset, modes), restarting });
  }));
  // Ficha del servidor: título y descripción que enseña Content Manager (ver server-sheet.ts)
  app.get('/admin/api/server-sheet', async (_req, reply) => {
    const c = d.getConfig();
    try { return readServerSheet(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.put('/admin/api/server-sheet', guard(async (req, reply) => {
    const b = body(z.object({ title: z.string().max(300), description: z.string().max(20000), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const sheet = saveServerSheet(c.serverDir, c.server.preset, b.title, b.description);
    return reply.send({ ...sheet, restarting: restartIfRunning(b.applyAndRestart) });
  }));
  // Presets de la descripción (propios de quien usa Howler: <dataDir>/sheet-presets.json)
  app.get('/admin/api/sheet-presets', async () => readSheetPresets(d.getConfig().dataDir));
  app.post('/admin/api/sheet-presets', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string().max(200), description: z.string().max(20000) }), req);
    return reply.send(saveSheetPreset(d.getConfig().dataDir, b.name, b.description));
  }));
  app.put('/admin/api/sheet-presets/default', guard(async (req, reply) => {
    const b = body(z.object({ id: z.string().max(40).nullable() }), req);
    return reply.send(setDefaultSheetPreset(d.getConfig().dataDir, b.id));
  }));
  app.delete('/admin/api/sheet-presets/:id', guard(async (req, reply) => {
    const { id } = z.object({ id: z.string().max(40) }).parse((req as unknown as { params: unknown }).params);
    return reply.send(deleteSheetPreset(d.getConfig().dataDir, id));
  }));
  app.post('/admin/api/weather/mode', guard(async (req, reply) => {
    const b = body(z.object({ fx: z.boolean(), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    saveWeatherFx(c.serverDir, c.server.preset, b.fx);
    const restarting = restartIfRunning(b.applyAndRestart);
    return reply.send({ ok: true, fx: b.fx, restarting });
  }));
  app.post('/admin/api/weather/list', guard(async (req, reply) => {
    const b = body(z.object({ graphics: z.array(z.string().max(80)).min(1).max(40), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const list = saveWeatherList(c.serverDir, c.server.preset, b.graphics);
    const restarting = restartIfRunning(b.applyAndRestart);
    return reply.send({ ok: true, list, restarting });
  }));

  // ---- Contraseña para entrar al servidor ----
  app.get('/admin/api/server-password', async (_req, reply) => {
    const c = d.getConfig();
    try { return readServerPassword(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/server-password', guard(async (req, reply) => {
    const b = body(z.object({ password: z.string().max(200), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const r = writeServerPassword(c.serverDir, c.server.preset, b.password);
    return reply.send({ ok: true, ...r, restarting: restartIfRunning(b.applyAndRestart) });
  }));

  // ---- Entre sesiones: combustible, daños y desgaste ----
  app.get('/admin/api/session-settings', async (_req, reply) => {
    const c = d.getConfig();
    try { return readSessionSettings(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/session-settings', guard(async (req, reply) => {
    const b = body(
      z.object({
        fuelRate: z.number().optional(),
        damageMultiplier: z.number().optional(),
        tyreWearRate: z.number().optional(),
        applyAndRestart: z.boolean().default(false),
      }),
      req,
    );
    const c = d.getConfig();
    const { applyAndRestart, ...patch } = b;
    const settings = writeSessionSettings(c.serverDir, c.server.preset, patch);
    return reply.send({ ok: true, settings, restarting: restartIfRunning(applyAndRestart) });
  }));

  // ---- Panel de sesión completo (todos los ajustes del preset; ver shared/session-spec.ts) ----
  app.get('/admin/api/session-panel', async (_req, reply) => {
    const c = d.getConfig();
    try { return readSessionPanel(c.serverDir, c.server.preset); } catch (e) { return fail(reply, e, 404); }
  });
  app.post('/admin/api/session-panel', guard(async (req, reply) => {
    const b = body(z.object({ values: z.record(z.string(), z.unknown()).optional(), sessions: z.unknown().optional(), applyAndRestart: z.boolean().default(false) }), req);
    const c = d.getConfig();
    const panel = writeSessionPanel(c.serverDir, c.server.preset, { values: b.values, sessions: b.sessions });
    return reply.send({ ok: true, panel, restarting: restartIfRunning(b.applyAndRestart) });
  }));

  // ---- Setups fijos (FIXED_SETUP) ----
  app.get('/admin/api/setups', async () => {
    const c = d.getConfig();
    return { server: listServerSetups(c.serverDir), user: listUserSetups() };
  });
  app.post('/admin/api/setups/import', guard(async (req, reply) => {
    const b = body(z.object({ car: z.string().min(1).max(100), track: z.string().min(1).max(100), file: z.string().min(1).max(120) }), req);
    const c = d.getConfig();
    return reply.send({ ok: true, name: importUserSetup(c.serverDir, b) });
  }));

  // ---- Presets de sesión propios (<dataDir>/session-presets.json) ----
  app.get('/admin/api/session-presets', async () => readSessionPresets(d.getConfig().dataDir));
  app.post('/admin/api/session-presets', guard(async (req, reply) => {
    const b = body(z.object({ name: z.string().min(1).max(60), values: z.record(z.string(), z.unknown()), sessions: z.unknown() }), req);
    return reply.send(saveSessionPreset(d.getConfig().dataDir, b.name, b.values, b.sessions));
  }));
  app.delete('/admin/api/session-presets/:id', guard(async (req, reply) => {
    const { id } = (req as unknown as { params: { id: string } }).params;
    return reply.send(deleteSessionPreset(d.getConfig().dataDir, String(id)));
  }));

}
