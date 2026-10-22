import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { z } from 'zod';
import { cleanTrackId, DEFAULT_SOUND, sanitizeAppearance, type PositionsDto, type ReplayDto } from '@howler/shared';
import type { FastifyReply } from 'fastify';
import type { Bus } from '../core/bus';
import { registerMultiHowlerPublic } from './multihowler-routes';
import type { MultiHowler } from '../core/multihowler';
import { registerAdminRoutes, type AdminDeps } from '../admin/admin-routes';
import { registerRateLimit, type RateLimitConfig } from './rate-limit';
import { createContentReader } from '../core/ac-content';
import type { AvatarService } from '../core/steam-avatar';
import { decodeTrace } from '../core/lap-trace';
import { findTrackMap, SAFE_NAME } from '../core/track-map';
import type { Tracker } from '../core/tracker';
import { hasAlpha, imageFileOf, type ImageStore } from '../core/championship-images';
import type { SoundStore } from '../core/sounds';
import type { Repository } from '../db/repository';
import { ROOT } from '../config';

const recordsQuery = z.object({
  track: z.string().min(1),
  layout: z.string().default(''),
  /** Uno o varios (`car=a&car=b`); sin ninguno, todos los coches del circuito. */
  car: z.union([z.string().min(1), z.array(z.string().min(1))]).optional().transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
});
const recentQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) });

/** Circuito tal como lo guarda CM/AssettoServer («csp/3465/../x»): se queda con la carpeta. */
const trackIdParam = z.string().min(1).max(200).transform(cleanTrackId).pipe(z.string().min(1).max(100).regex(SAFE_NAME));
const mapQuery = z.object({ track: z.string().min(1).max(200).transform(cleanTrackId), layout: z.string().max(100).default('') });

/** Cada cuánto se envían posiciones a la web (ms). El servidor de AC las manda cada ~100 ms. */
const POSITIONS_INTERVAL_MS = 100;

/**
 * Construye la aplicación HTTP. Con `admin` se añaden las rutas del panel de control: eso solo se hace en la
 * instancia que escucha en 127.0.0.1; la pública (para los amigos) nunca las tiene.
 */
/** Kilómetros de vueltas completas: vueltas de cada combinación × longitud del circuito; null si ninguna longitud es conocida. */
export function driverKm(combos: { track: string; layout: string; laps: number }[], lengthKm: (track: string, layout: string) => number | null): number | null {
  let km = 0, known = false;
  for (const c of combos) { const len = lengthKm(c.track, c.layout); if (len != null) { km += len * c.laps; known = true; } }
  return known ? Math.round(km * 10) / 10 : null;
}

export async function buildApp(deps: { repo: Repository; tracker: Tracker; bus: Bus; trackDirs?: string[]; contentDirs?: string[]; avatars?: AvatarService; images?: ImageStore; sounds?: SoundStore; admin?: AdminDeps; multihowler?: MultiHowler; getAppearance?: () => unknown; rateLimit?: RateLimitConfig }) {
  const trackDirs = deps.trackDirs ?? [];
  const content = createContentReader(deps.contentDirs ?? []);
  // forceCloseConnections: al cerrar, se cortan también las conexiones largas (los datos en directo de la web); si no, Howler se quedaba
  // esperando a que el navegador las cerrara y el programa seguía vivo a medias después de cerrar la ventana.
  const app = Fastify({ logger: false, forceCloseConnections: true });
  // Cabeceras de seguridad: la web no ejecuta nada que no sea suyo, no se puede meter en un marco de otra página y no filtra la dirección de origen.
  // Las imágenes pueden venir de cualquier http(s) (fichas de mods, ficha del servidor); lo demás, solo de Howler.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });
  // Límites por dirección: solo en la web pública (el panel escucha en 127.0.0.1 y no los necesita). Van antes de las rutas.
  if (!deps.admin) registerRateLimit(app, deps.rateLimit);
  if (deps.admin) registerAdminRoutes(app, deps.admin);
  if (deps.multihowler) registerMultiHowlerPublic(app, deps.multihowler);

  // Disposición de la web (solo lectura; se cambian desde el panel).
  app.get('/api/appearance', async (_req, reply) => reply.header('Cache-Control', 'no-cache').send(sanitizeAppearance(deps.getAppearance?.())));
  app.get('/api/status', async () => deps.tracker.status());
  const serverQuery = z.object({ server: z.string().max(40).optional() });
  const serverOf = (req: { query: unknown }) => deps.repo.multihowler.serverFilter(serverQuery.parse(req.query).server);
  app.get('/api/servers', async () => deps.repo.multihowler.servers());
  app.get('/api/combos', async (req) => deps.repo.combos(serverOf(req)));
  app.get('/api/records/latest', async (req) => deps.repo.recentRecords(recentQuery.parse(req.query).limit));
  app.get('/api/timing', async () => deps.tracker.timing());
  app.get('/api/records', async (req) => {
    const q = recordsQuery.parse(req.query);
    return deps.repo.records(q.track, q.layout, q.car, serverOf(req));
  });
  // Fichas de piloto, circuito y coche y sus listados. Los pilotos van siempre por su id interno.
  const idParam = z.object({ id: z.coerce.number().int().positive() });
  const notFound = (reply: import('fastify').FastifyReply) => reply.code(404).send({ error: 'No existe' });
  app.get('/api/drivers', async () => deps.repo.profiles.driverList());
  app.get('/api/rankings', async (req) => {
    const q = z.object({ track: z.string().max(120).optional(), layout: z.string().max(120).optional(), days: z.coerce.number().int().min(1).max(3660).optional() }).parse(req.query);
    return deps.repo.profiles.rankings({ track: q.track, layout: q.layout, since: q.days ? new Date(Date.now() - q.days * 86_400_000).toISOString() : undefined });
  });
  app.get('/api/drivers/:id', async (req, reply) => {
    const p = deps.repo.profiles.driverProfile(idParam.parse(req.params).id);
    if (!p) return notFound(reply);
    return { ...p, km: driverKm(p.combos, (track, layout) => content.trackMeta(track, layout).lengthKm) };
  });
  app.get('/api/drivers/:id/avatar', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const path = (await deps.avatars?.get(id, deps.repo.driverSteamId(id))) ?? null;
    return sendImage(req, reply, path, 'image/jpeg');
  });
  app.get('/api/tracks', async () => deps.repo.profiles.trackList());
  app.get('/api/tracks/profile', async (req, reply) => {
    const q = mapQuery.parse(req.query);
    return deps.repo.profiles.trackProfile(q.track, q.layout) ?? notFound(reply);
  });
  app.get('/api/cars', async () => deps.repo.profiles.carList());
  app.get('/api/cars/profile', async (req, reply) => {
    const { car } = z.object({ car: z.string().min(1).max(100) }).parse(req.query);
    return deps.repo.profiles.carProfile(car) ?? notFound(reply);
  });

  // Campeonatos públicos (los borradores no existen para el público).
  // Ajuste de la imagen en «automático»: si es una imagen subida, se mira si tiene transparencia (insignia, copa → entera); si no, llena el marco
  const fitCache = new Map<string, 'cover' | 'contain'>();
  const autoFit = <T extends { imageUrl: string | null; imageFit: 'cover' | 'contain' | null }>(c: T): T => {
    if (c.imageFit != null) return c;
    const file = imageFileOf(c.imageUrl ?? '');
    const found = file ? deps.images?.find(file) : null;
    if (!file || !found) return c;
    let fit = fitCache.get(file);
    if (!fit) {
      try { const fd = openSync(found.path, 'r'); const buf = Buffer.alloc(4096); const n = readSync(fd, buf, 0, 4096, 0); closeSync(fd); fit = hasAlpha(buf.subarray(0, n)) ? 'contain' : 'cover'; } catch { fit = 'cover'; }
      fitCache.set(file, fit);
    }
    return { ...c, imageFit: fit };
  };
  app.get('/api/championships', async () => deps.repo.championships.list(false).map(autoFit));
  app.get('/api/championships/:id', async (req, reply) => { const c = deps.repo.championships.get(idParam.parse(req.params).id, true); return c ? autoFit(c) : notFound(reply); });

  app.get('/api/championship-images/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().max(80) }).parse(req.params);
    const img = deps.images?.find(file);
    return sendImage(req, reply, img?.path ?? null, img?.type ?? 'image/png');
  });

  // Sonidos de la web (aviso de récord): cuál suena y los personalizados que subió el administrador.
  app.get('/api/sounds', async (_req, reply): Promise<unknown> => reply.header('Cache-Control', 'no-cache').send(deps.sounds?.list() ?? { record: DEFAULT_SOUND, custom: [], maxSeconds: 5, volumeStyle: 'banana' }));
  app.get('/api/sound-files/:file', async (req, reply) => {
    const { file } = z.object({ file: z.string().max(80) }).parse(req.params);
    const snd = deps.sounds?.find(file);
    return sendImage(req, reply, snd?.path ?? null, snd?.type ?? 'audio/wav');
  });

  // Fantasmas: las 3 mejores vueltas del circuito (para los coches elegidos) con su traza para reproducirla.
  app.get('/api/replay', async (req): Promise<ReplayDto> => {
    const q = recordsQuery.parse(req.query);
    const laps = deps.repo.topLapsWithTraces(q.track, q.layout, q.car).map(({ data, ...lap }) => ({ ...lap, trace: data ? decodeTrace(data) : null }));
    return { track: q.track, layout: q.layout, laps };
  });
  // Comparador: la mejor vuelta (con su trayectoria) de cada piloto y coche pedidos, de 2 a 3. `pick=idPiloto~coche`.
  app.get('/api/compare', async (req, reply): Promise<ReplayDto | FastifyReply> => {
    const q = z.object({
      track: z.string().min(1).max(100),
      layout: z.string().max(100).default(''),
      pick: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v])).pipe(z.array(z.string().regex(/^\d+~[\w.\- ]+$/)).min(2).max(3)),
    }).parse(req.query);
    const picks = q.pick.map((p) => { const [id, ...car] = p.split('~'); return { driverId: Number(id), car: car.join('~') }; });
    const laps = deps.repo.bestLapsWithTraces(q.track, q.layout, picks).map(({ data, ...lap }) => ({ ...lap, trace: data ? decodeTrace(data) : null }));
    return laps.length < 2 ? reply.code(404).send({ error: 'No hay vueltas válidas que comparar' }) : { track: q.track, layout: q.layout, laps };
  });
  const sessionParams = z.object({ id: z.coerce.number().int().positive(), driverId: z.coerce.number().int().positive().optional() });
  app.get('/api/sessions/:id/drivers/:driverId/laps', async (req) => {
    const p = sessionParams.parse(req.params);
    return deps.repo.driverSessionLaps(p.id, p.driverId!);
  });
  // Historial: lista filtrable de sesiones y la clasificación de cualquiera de ellas
  app.get('/api/sessions', async (req) => {
    const q = z.object({
      track: z.string().max(120).optional(), layout: z.string().max(120).optional(), car: z.string().max(120).optional(),
      type: z.coerce.number().int().min(0).max(9).optional(), driverId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0),
      server: z.string().max(40).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).max(30).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).max(30).optional(),
    }).parse(req.query);
    return deps.repo.sessionHistory.list({ ...q, server: deps.repo.multihowler.serverFilter(q.server) });
  });
  app.get('/api/sessions/:id/timing', async (req, reply) => {
    const id = sessionParams.parse(req.params).id;
    const s = deps.repo.sessionById(id);
    if (!s) return notFound(reply);
    const st = deps.tracker.status();
    return deps.repo.sessionTiming(s, st.session?.id === s.id ? st.online : []);
  });
  app.get('/api/sessions/:id/progression', async (req) => deps.repo.sessionProgression(sessionParams.parse(req.params).id));
  app.get('/api/laps/recent', async (req) => deps.repo.recentLaps(recentQuery.parse(req.query).limit));

  // Nombres reales e imágenes de coches y circuitos, leídos de la instalación de AC.
  app.get('/api/content/names', async () => {
    const combos = deps.repo.combos();
    return content.names([...new Set(combos.map((c) => c.car))], combos.map((c) => ({ track: c.track, layout: c.layout })));
  });
  app.get('/api/content/cars/:id/card', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    return content.carCard(id) ?? notFound(reply);
  });
  app.get('/api/content/tracks/:id/card', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    const { layout } = z.object({ layout: z.string().max(100).default('') }).parse(req.query);
    return content.trackCard(id, layout) ?? notFound(reply);
  });
  // Las imágenes se revalidan con ETag: el navegador siempre pregunta, pero si no han cambiado la respuesta es un 304 vacío.
  const sendImage = (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, path: string | null, type: string) => {
    if (!path) return reply.code(404).send({ error: 'Sin imagen' });
    const st = statSync(path);
    const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    reply.header('ETag', etag).header('Cache-Control', 'public, no-cache').header('Content-Type', type);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.send(createReadStream(path));
  };
  app.get('/api/content/cars/:id/skins/:skin/preview', async (req, reply) => {
    const { id, skin } = z.object({ id: z.string().min(1).max(100).regex(SAFE_NAME), skin: z.string().min(1).max(100).regex(SAFE_NAME) }).parse(req.params);
    return sendImage(req, reply, content.skinPreview(id, skin), 'image/jpeg');
  });
  app.get('/api/content/cars/:id/preview', async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1).max(100).regex(SAFE_NAME) }).parse(req.params);
    return sendImage(req, reply, content.carPreview(id), 'image/jpeg');
  });
  app.get('/api/content/tracks/:id/preview', async (req, reply) => {
    const { id } = z.object({ id: trackIdParam }).parse(req.params);
    const { layout } = mapQuery.pick({ layout: true }).parse(req.query);
    return sendImage(req, reply, content.trackPreview(id, layout), 'image/png');
  });

  app.get('/api/content/tracks/:id/outline', async (req, reply) => {
    const { id } = z.object({ id: trackIdParam }).parse(req.params);
    const { layout } = mapQuery.pick({ layout: true }).parse(req.query);
    return sendImage(req, reply, content.trackOutline(id, layout), 'image/png');
  });

  // Mapa del circuito: información (tamaño y desplazamientos) e imagen, leídos de la instalación de AC.
  app.get('/api/map', async (req, reply) => {
    const q = mapQuery.parse(req.query);
    const map = findTrackMap(q.track, q.layout, trackDirs);
    return map ? map.info : reply.code(404).send({ error: 'No hay mapa de este circuito' });
  });
  app.get('/api/map/road', async (req, reply) => {
    const q = mapQuery.parse(req.query);
    const road = findTrackMap(q.track, q.layout, trackDirs)?.road();
    return road ? reply.header('Cache-Control', 'public, max-age=3600').send(road) : reply.code(404).send({ error: 'No hay línea de este circuito' });
  });
  app.get('/api/map/image', async (req, reply) => {
    const q = mapQuery.parse(req.query);
    const map = findTrackMap(q.track, q.layout, trackDirs);
    if (!map) return reply.code(404).send({ error: 'No hay mapa de este circuito' });
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=3600').send(createReadStream(map.imagePath));
  });

  // Posiciones en directo: un flujo SSE que solo trabaja mientras haya alguien mirando el mapa. Un único temporizador
  // para todos los visitantes: se calcula y se serializa una vez por intervalo, sean 1 o 100 los que miran.
  const positionClients = new Set<(text: string) => void>();
  let positionTimer: NodeJS.Timeout | null = null;
  let lastPositions = '';
  const positionsText = () => JSON.stringify({ cars: deps.tracker.positions() } satisfies PositionsDto);
  app.get('/api/positions', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write('retry: 2000\n\n');
    const write = (text: string) => reply.raw.write(`data: ${text}\n\n`);
    write(positionsText());
    positionClients.add(write);
    positionTimer ??= setInterval(() => {
      const text = positionsText();
      if (text === lastPositions) return; // nada se mueve: no se manda nada
      lastPositions = text;
      for (const w of positionClients) w(text);
    }, POSITIONS_INTERVAL_MS);
    const beat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      positionClients.delete(write);
      clearInterval(beat);
      if (positionClients.size === 0 && positionTimer) { clearInterval(positionTimer); positionTimer = null; lastPositions = ''; }
    });
  });

  // Canal SSE: la web recarga datos al recibir una señal, sin sondear.
  app.get('/api/live', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 2000\n\n');
    const off = deps.bus.on((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const beat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      off();
      clearInterval(beat);
    });
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError') return reply.code(400).send({ error: 'Parámetros no válidos', details: err.issues });
    // Errores del cliente (cuerpo mal formado, tipo no soportado...): se devuelven tal cual, no son un fallo del servidor.
    if (typeof err?.statusCode === 'number' && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'Petición no válida', detail: err.message });
    console.error(`[howler] error en ${_req.method} ${_req.url}:`, err);
    return reply.code(500).send({ error: 'Error interno' });
  });

  // En producción el propio servidor sirve la web compilada.
  const dist = process.env.HOWLER_HOME ? resolve(ROOT, 'web') : resolve(ROOT, 'packages/web/dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.url.startsWith('/admin/api') ? reply.code(404).send({ error: 'No existe' }) : reply.sendFile('index.html'),
    );
  }
  return app;
}
