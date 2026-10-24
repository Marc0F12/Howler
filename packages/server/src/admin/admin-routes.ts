import { openExternal } from '../core/open-url';
import { execFile } from 'node:child_process';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { type AppearanceConfig, sanitizeAppearance, type InstalledContentDto, type LapRulesConfig, type OnlineDriver } from '@howler/shared';
import { type HowlerConfig } from '../config';
import { resolveRules } from '../core/lap-rules';
import type { Repository } from '../db/repository';
import { type ImageStore } from '../core/championship-images';
import { registerChampionshipRoutes } from './championship-routes';
import { registerSignupAdminRoutes } from './signup-routes';
import { registerSoundRoutes } from './sound-routes';
import type { SoundStore } from '../core/sounds';
import { registerDiscordRoutes } from './discord-routes';
import { registerPresetRoutes } from './preset-routes';
import { registerScheduleRoutes } from './schedule-routes';
import type { Scheduler } from './scheduler';
import { registerAccountRoutes } from './account-routes';
import { roleAllows, type AuthService } from './auth';
import { registerRulesRoutes } from './rules-routes';
import { registerWorldRoutes } from './world-routes';
import { SAFE_NAME } from '../core/track-map';
import { routeKit } from './route-kit';
import { registerImportRoutes } from './import-routes';
import { registerBackupRoutes, type BackupDeps } from './backup-routes';
import { registerUpdateRoutes } from './update-routes';
import type { UpdateService } from '../core/updates';
import { registerDriverRoutes } from './driver-routes';
import { registerMultiHowlerAdmin } from './multihowler-routes';
import type { MultiHowler } from '../core/multihowler';
import { checkServerDir, detectServers, type ServerDirCheck } from './detect-server';
import { commands, type CommandResult, type PluginCommander } from './plugin-commander';
import type { ContentReader } from '../core/ac-content';
import type { ServerProcess } from './server-process';

/** Todo lo que el panel necesita del resto de Howler. */
export interface AdminDeps {
  /** Configuración en vigor (con las rutas ya resueltas). */
  getConfig: () => HowlerConfig;
  /** Guarda un cambio parcial en howler.config.json y devuelve la configuración resultante. */
  saveConfig: (patch: Record<string, unknown>) => void;
  /** Guarda la disposición de la web (ya limpios). */
  saveAppearance: (a: AppearanceConfig) => void;
  process: ServerProcess;
  commander: PluginCommander;
  /** Eventos programados (arrancar el servidor con un preset a una hora). */
  scheduler?: Scheduler;
  /** Cuentas y acceso remoto. Sin esto el panel solo funciona desde el propio PC (como antes). */
  auth?: AuthService;
  /** Pilotos conectados ahora (para elegir a quién expulsar, etc.). */
  online: () => OnlineDriver[];
  /** ¿Está activo el plugin de Howler? */
  pluginAlive: () => boolean;
  /** ¿Hay un servidor de AC en marcha que NO ha arrancado Howler? (por ejemplo desde Content Manager) */
  externalServerRunning?: () => Promise<boolean>;
  /** Base de datos: para revisar vueltas y recalcular su validez. */
  repo: Repository;
  /** Guarda las reglas de vuelta válida (sustituye la sección entera) y las deja en vigor. */
  saveLapRules: (cfg: LapRulesConfig) => void;
  /** Guarda los ajustes del mapa del mundo (sustituye la sección entera). */
  saveWorldMap: (cfg: { online: boolean; manual: Record<string, { lat: number; lon: number }> }) => void;
  /** Avisa a la web de que han cambiado vueltas (para que recargue tiempos y clasificaciones). */
  onLapsChanged: () => void;
  /** Coches y circuitos instalados en AC (para el selector de carreras). */
  installedContent?: () => InstalledContentDto;
  /** Lector del contenido de AC instalado (skins, nombres, imágenes). */
  content?: () => ContentReader;
  /** Un campeonato se activó o terminó (para avisar, p. ej. a Discord). */
  onChampionship?: (kind: 'started' | 'finished', id: number) => void;
  /** Carpeta temporal para los archivos que se suben a importar (stracker). Sin ella, la importación no está disponible. */
  importsDir?: string;
  /** Copias de seguridad y exportación de tiempos. */
  backup?: Omit<BackupDeps, 'repo'>;
  /** ¿Existe ese circuito y layout en el contenido de AC instalado? */
  trackInContent?: (track: string, layout: string) => boolean;
  /** Imágenes de portada subidas desde el panel. */
  images?: ImageStore;
  /** Sonidos personalizados del aviso de récord. */
  sounds?: SoundStore;
  multihowler?: MultiHowler;
  updates?: UpdateService;
  /** Hosts por los que se permite abrir el panel (anti DNS-rebinding). */
  allowedHosts: string[];
}

/** Mira si hay un servidor de AC en marcha en el sistema (tasklist en Windows, pgrep en Linux y macOS). El resultado se guarda 3 s: el panel pregunta cada pocos segundos. */
let externalCache: { at: number; value: Promise<boolean> } | null = null;
export function defaultExternalServerRunning(): Promise<boolean> {
  if (externalCache && Date.now() - externalCache.at < 3000) return externalCache.value;
  const value = new Promise<boolean>((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => resolve(!err && /"(acServer|AssettoServer)\.exe"/i.test(out)));
    } else {
      // Linux y macOS: pgrep -x busca por nombre exacto del proceso (sale con 0 si encuentra alguno)
      execFile('pgrep', ['-x', 'AssettoServer|acServer'], (err) => resolve(!err));
    }
  });
  externalCache = { at: Date.now(), value };
  return value;
}

const settingsPatch = z
  .object({
    language: z.enum(['es', 'en']),
    serverDir: z.string().max(500),
    http: z.object({ port: z.number().int().min(1024).max(65535) }).partial().strict(),
    admin: z.object({ port: z.number().int().min(1024).max(65535) }).partial().strict(),
    server: z
      .object({
        exe: z.string().regex(/^[\w.-]+\.exe$/i, 'El ejecutable debe ser un nombre de archivo .exe'),
        preset: z.string().regex(SAFE_NAME, 'Nombre de preset no válido'),
        startWithHowler: z.boolean(),
        stopWarningSeconds: z.number().int().min(0).max(300),
      })
      .partial().strict(),
    acsp: z
      .object({
        listenPort: z.number().int().min(1024).max(65535),
        serverPort: z.number().int().min(1024).max(65535),
        pluginPort: z.number().int().min(1024).max(65535),
        pluginCommandPort: z.number().int().min(0).max(65535),
        forward: z.array(z.number().int().min(1024).max(65535)).max(5),
        positionIntervalMs: z.number().int().min(20).max(1000),
        referenceOffsetM: z.number().min(-5).max(5),
      })
      .partial().strict(),
  })
  .partial()
  .strict();

/** Ajustes que solo se aplican al reiniciar Howler. */
const NEEDS_RESTART = ['http.port', 'admin.port', 'acsp.listenPort', 'acsp.serverPort', 'acsp.pluginPort', 'acsp.pluginCommandPort', 'acsp.forward', 'acsp.positionIntervalMs', 'acsp.referenceOffsetM'];

const flatten = (o: unknown, prefix = ''): string[] =>
  o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

export function registerAdminRoutes(app: FastifyInstance, d: AdminDeps) {
  // Defensa contra páginas web ajenas que intenten mandar órdenes al panel desde el navegador del usuario.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin/api')) return;
    if (d.auth && d.auth.isRemote(req)) {
      // Petición de fuera del PC (otro equipo o un túnel): hace falta el acceso remoto activado y una sesión con permiso.
      if (!d.auth.remoteEnabled) return reply.code(403).send({ error: 'El acceso remoto está desactivado.' });
      const origin = req.headers.origin;
      if (origin) {
        let same = false;
        try { same = new URL(origin).host === String(req.headers.host ?? ''); } catch { /* origen roto */ }
        if (!same) return reply.code(403).send({ error: 'Origen no permitido.' });
      }
      if (req.method !== 'GET' && req.headers['x-howler-admin'] !== '1') return reply.code(403).send({ error: 'Falta la cabecera del panel.' });
      const path = req.url.split('?')[0]!;
      if (path === '/admin/api/ping' || path === '/admin/api/login' || path === '/admin/api/logout') return;
      const who = d.auth.caller(req);
      if (who.kind === 'remote' && !who.account) return reply.code(401).send({ error: 'Inicia sesión para usar el panel.' });
      if (who.kind === 'remote' && who.account && !roleAllows(who.account.role, req.method, req.url)) return reply.code(403).send({ error: 'Tu cuenta no puede hacer esto.' });
      return;
    }
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!d.allowedHosts.includes(host)) return reply.code(403).send({ error: 'Host no permitido.' });
    const origin = req.headers.origin;
    if (origin && !d.allowedHosts.some((h) => origin === `http://${h}`)) return reply.code(403).send({ error: 'Origen no permitido.' });
    if (req.method !== 'GET' && req.headers['x-howler-admin'] !== '1') return reply.code(403).send({ error: 'Falta la cabecera del panel.' });
  });

  const kit = routeKit(d);
  const { fail, body, guard, stopOpts } = kit;
  const run = async (reply: FastifyReply, build: () => string): Promise<CommandResult | FastifyReply> => {
    let cmd: string;
    try { cmd = build(); } catch (e) { return fail(reply, e); }
    const r = await d.commander.exec(cmd);
    return reply.code(r.ok ? 200 : 502).send(r);
  };

  let checkCache: { key: string; at: number; value: ServerDirCheck } | null = null;
  const check = (): ServerDirCheck => {
    const c = d.getConfig();
    const key = `${c.serverDir}|${c.server.exe}`;
    if (checkCache && checkCache.key === key && Date.now() - checkCache.at < 3000) return checkCache.value;
    const value = checkServerDir(c.serverDir, c.server.exe);
    checkCache = { key, at: Date.now(), value };
    return value;
  };

  registerAccountRoutes(app, d, kit);
  if (d.multihowler) registerMultiHowlerAdmin(app, d.multihowler);
  if (d.updates) registerUpdateRoutes(app, { updates: d.updates, saveUpdateSettings: (p) => d.saveConfig({ updates: p }) });
  registerDriverRoutes(app, { repo: d.repo, online: d.online, onChanged: d.onLapsChanged });
  registerPresetRoutes(app, d, kit);
  registerScheduleRoutes(app, d, kit);
  registerRulesRoutes(app, d, kit);
  registerWorldRoutes(app, d, kit);
  registerChampionshipRoutes(app, d, kit);
  registerSignupAdminRoutes(app, d, kit);
  registerSoundRoutes(app, d, kit);
  registerDiscordRoutes(app, d, kit);

  // «Abrir la web»: la web pública se ve en el navegador normal del usuario, separada de la ventana del panel.
  app.post('/admin/api/open-web', async () => {
    const url = `http://localhost:${d.getConfig().http.port}/`;
    openExternal(url);
    return { ok: true, url };
  });

  // «Conectar»: abre el enlace de invitación de Content Manager (el navegador lo pasa a CM/AC). Solo el enlace que sacó la consola del servidor.
  app.post('/admin/api/server/connect', async (_req, reply) => {
    const link = d.process.snapshot().inviteLink;
    if (!link || !/^https:\/\/acstuff\.club\/\S+$/i.test(link)) return fail(reply, new Error('El servidor aún no ha dado su enlace de invitación.'), 409);
    openExternal(link); // sin intérprete de órdenes: ningún carácter del enlace se interpreta como orden
    return { ok: true };
  });

  app.get('/admin/api/state', async () => {
    const c = d.getConfig();
    const snap = d.process.snapshot();
    return {
      server: { ...snap, logs: undefined },
      // Fuera de Howler: el proceso se ve en el sistema, o el plugin sigue mandando señales de vida (sirve aunque el .exe se llame distinto)
      externalServerRunning: snap.state === 'stopped' ? d.pluginAlive() || await (d.externalServerRunning ?? defaultExternalServerRunning)() : false,
      pluginAlive: d.pluginAlive(),
      check: check(),
      online: d.online(),
      settings: {
        serverDir: c.serverDir,
        http: { port: c.http.port },
        admin: { port: c.admin.port },
        server: c.server,
        acsp: { listenPort: c.acsp.listenPort, serverPort: c.acsp.serverPort, pluginPort: c.acsp.pluginPort, pluginCommandPort: c.acsp.pluginCommandPort, forward: c.acsp.forward },
        language: c.language,
      },
    };
  });

  app.get('/admin/api/detect', async () => detectServers());
  app.get('/admin/api/check', async (req) => {
    const dir = String((req.query as { dir?: string }).dir ?? '');
    return checkServerDir(dir, d.getConfig().server.exe);
  });

  // ---- Ajustes ----
  app.post('/admin/api/settings', async (req, reply) => {
    const parsed = settingsPatch.safeParse(req.body);
    if (!parsed.success) return fail(reply, new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
    try {
      d.saveConfig(parsed.data as Record<string, unknown>);
    } catch (e) {
      return fail(reply, e);
    }
    const c = d.getConfig();
    if (d.process.snapshot().state === 'stopped') d.process.configure({ serverDir: c.serverDir, exe: c.server.exe, preset: c.server.preset });
    checkCache = null;
    const restartRequired = flatten(parsed.data).filter((k) => NEEDS_RESTART.includes(k));
    return { ok: true, restartRequired };
  });

  // ---- Servidor de AC ----
  app.post('/admin/api/server/start', async (_req, reply) => {
    if (d.process.snapshot().state === 'stopped' && await (d.externalServerRunning ?? defaultExternalServerRunning)()) {
      return fail(reply, new Error('Ya hay un servidor de AC en marcha que no ha arrancado Howler (¿Content Manager?). Páralo antes de arrancarlo desde aquí.'), 409);
    }
    const c = d.getConfig();
    d.process.configure({ serverDir: c.serverDir, exe: c.server.exe, preset: c.server.preset });
    try { d.process.start(); } catch (e) { return fail(reply, e, 409); }
    return { ok: true };
  });

  app.post('/admin/api/server/stop', async (_req, reply) => {
    d.process.stop(stopOpts()).catch(() => {}); // la parada puede tardar (aviso a los jugadores): se sigue por el estado
    return reply.code(202).send({ ok: true });
  });
  app.post('/admin/api/server/restart', async (_req, reply) => {
    d.process.restart(stopOpts()).catch(() => {});
    return reply.code(202).send({ ok: true });
  });

  // Consola del servidor en directo.
  app.get('/admin/api/server/logs', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write('retry: 2000\n\n');
    const send = (line: string) => reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
    for (const l of d.process.snapshot().logs.slice(-300)) send(l);
    d.process.on('log', send);
    const beat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => { d.process.off('log', send); clearInterval(beat); });
  });

  // ---- Control en directo (por el plugin) ----
  app.post('/admin/api/control/time', guard(async (req, reply) => { const b = body(z.object({ time: z.string() }), req); return run(reply, () => commands.setTime(b.time)); }));
  app.post('/admin/api/control/weather', guard(async (req, reply) => { const b = body(z.object({ type: z.string(), durationSeconds: z.number().default(30) }), req); return run(reply, () => commands.setWeather(b.type, b.durationSeconds)); }));
  app.post('/admin/api/control/rain', guard(async (req, reply) => { const b = body(z.object({ intensity: z.number(), wetness: z.number(), water: z.number() }), req); return run(reply, () => commands.setRain(b.intensity, b.wetness, b.water)); }));
  app.post('/admin/api/control/grip', guard(async (req, reply) => { const b = body(z.object({ percent: z.number() }), req); return run(reply, () => commands.setGrip(b.percent)); }));
  app.post('/admin/api/control/weather-id', guard(async (req, reply) => { const b = body(z.object({ id: z.number() }), req); return run(reply, () => commands.setWeatherId(b.id)); }));
  // Hora actual del servidor (para que el deslizador empiece donde está): el servidor responde "It is currently 18:45."
  app.get('/admin/api/control/time', async () => {
    const r = await d.commander.exec(commands.currentTime());
    const m = /(\d{1,2}):(\d{2})/.exec(r.reply);
    return { time: r.ok && m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null };
  });
  app.post('/admin/api/control/say', guard(async (req, reply) => { const b = body(z.object({ message: z.string().min(1) }), req); return run(reply, () => commands.say(b.message)); }));
  app.post('/admin/api/control/kick', guard(async (req, reply) => { const b = body(z.object({ carId: z.number() }), req); return run(reply, () => commands.kick(b.carId)); }));
  app.post('/admin/api/control/ban', guard(async (req, reply) => { const b = body(z.object({ carId: z.number() }), req); return run(reply, () => commands.ban(b.carId)); }));
  app.post('/admin/api/control/ballast', guard(async (req, reply) => { const b = body(z.object({ carId: z.number(), kg: z.number() }), req); return run(reply, () => commands.ballast(b.carId, b.kg)); }));
  app.post('/admin/api/control/restrictor', guard(async (req, reply) => { const b = body(z.object({ carId: z.number(), percent: z.number() }), req); return run(reply, () => commands.restrictor(b.carId, b.percent)); }));
  app.post('/admin/api/control/session', guard(async (req, reply) => {
    const b = body(z.object({ action: z.enum(['next', 'restart']) }), req);
    return run(reply, () => (b.action === 'next' ? commands.nextSession() : commands.restartSession()));
  }));

  // ---------- Apariencia: disposición de la web ----------
  app.get('/admin/api/appearance', async () => sanitizeAppearance(d.getConfig().appearance));
  app.put('/admin/api/appearance', guard(async (req, reply) => {
    // Idioma, hora y medidas se guardan aparte de la disposición y el tema: si la orden no los trae, se conservan
    const body = (req as { body: unknown }).body as Record<string, unknown> | null;
    const before = sanitizeAppearance(d.getConfig().appearance);
    // El tema del panel (`panelTheme`) también se conserva si la orden no lo menciona; con `null` se quita
    const next = sanitizeAppearance({ ...(body ?? {}), display: body?.display ?? before.display, panelTheme: body && 'panelTheme' in body ? body.panelTheme : before.panelTheme });
    d.saveAppearance(next);
    return reply.send(next);
  }));

  if (d.backup) registerBackupRoutes(app, { repo: d.repo, ...d.backup }, kit);

  if (d.importsDir) {
    registerImportRoutes(app, {
      repo: d.repo, dir: d.importsDir, inContent: d.trackInContent, onLapsChanged: d.onLapsChanged,
      rulesFor: (t, l) => resolveRules(d.getConfig().lapRules, t, l).rules,
    }, { guard, fail });
  }
}
