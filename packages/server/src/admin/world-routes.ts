import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { worldKey, type WorldMapAdminDto, type WorldMapConfig, type WorldSuggestionDto } from '@howler/shared';
import { geocode, geocodeQueries } from '../core/geocode';
import type { AdminDeps } from './admin-routes';
import type { RouteKit } from './route-kit';

const coord = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const putBody = z.object({ online: z.boolean(), manual: z.record(z.string().min(1).max(220), coord).refine((m) => Object.keys(m).length <= 500, 'Demasiadas ubicaciones') });

/** Mapa del mundo en el panel: permitir mapas en línea y ubicar a mano los circuitos que no traen coordenadas. */
export function registerWorldRoutes(app: FastifyInstance, d: AdminDeps, { body, guard }: RouteKit) {
  const state = (): WorldMapAdminDto => {
    const cfg = d.getConfig().worldMap;
    const reader = d.content?.();
    return {
      online: cfg.online,
      played: d.repo.profiles.worldBoard().map((b) => {
        const manual = cfg.manual[worldKey(b.track, b.layout)];
        const geo = manual ?? reader?.trackCard(b.track, b.layout)?.geo ?? null;
        return { track: b.track, layout: b.layout, lat: geo?.lat ?? null, lon: geo?.lon ?? null, source: manual ? 'manual' : geo ? 'content' : null };
      }),
    };
  };
  app.get('/admin/api/world-map', async () => state());
  // Buscar por nombre dónde está un circuito (Nominatim de OpenStreetMap). Solo propone sitios: quien administra elige cuál usar.
  app.post('/admin/api/world-map/search', guard(async (req, reply) => {
    const b = body(z.object({ track: z.string().min(1).max(100), layout: z.string().max(100) }), req);
    const card = d.content?.().trackCard(b.track, b.layout);
    const name = card?.name ?? b.track.replace(/^ks_/, '').replace(/_/g, ' ');
    const out: WorldSuggestionDto = { track: b.track, layout: b.layout, query: name, approx: false, candidates: [] };
    try {
      for (const { q, approx } of geocodeQueries(name, card?.subtitle ?? null, b.track)) {
        out.candidates = await geocode(q, d.getConfig().language);
        if (out.candidates.length > 0) { out.query = q; out.approx = approx; break; }
        await new Promise((r) => setTimeout(r, 1100)); // el servicio pide como mucho una consulta por segundo
      }
    } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
    return reply.send(out);
  }));
  // Buscar una dirección o un lugar cualquiera (para centrar el mapa al ubicar un circuito).
  app.post('/admin/api/world-map/geocode', guard(async (req, reply) => {
    const b = body(z.object({ q: z.string().trim().min(2).max(200) }), req);
    return reply.send({ candidates: await geocode(b.q, d.getConfig().language, undefined, 5) });
  }));
  app.put('/admin/api/world-map', guard(async (req, reply) => {
    const b = body(putBody, req);
    d.saveWorldMap({ online: b.online, manual: b.manual } satisfies WorldMapConfig);
    return reply.send(state());
  }));
}
