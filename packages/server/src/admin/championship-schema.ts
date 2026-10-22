import { z } from 'zod';
import { isChampionshipImageRef, validateBadge, type ChampionshipInput } from '@howler/shared';

const bonus = z.object({
  kind: z.enum(['pole', 'bestLap', 'topSpeed', 'mostLaps', 'participation']),
  points: z.number().min(-1000).max(1000),
  maxFinish: z.number().int().min(1).max(200).optional(),
});
const metric = z.enum(['finish', 'bestLap', 'avgLap', 'consistency', 'laps', 'topSpeed']);

export const scoringSchema = z.object({
  mode: z.enum(['points', 'aggregate']),
  metric,
  pointsTable: z.array(z.number().min(-1000).max(1000)).max(200),
  defaultPoints: z.number().min(-1000).max(1000),
  minLaps: z.number().int().min(0).max(1000),
  bonuses: z.array(bonus).max(20),
  qualiTable: z.array(z.number().min(-1000).max(1000)).max(200).optional(),
  aggregate: z.object({ metric, how: z.enum(['sum', 'best', 'mean']) }),
  dropWorst: z.number().int().min(0).max(50),
  team: z.object({ rule: z.enum(['sumAll', 'bestN', 'mean']), n: z.number().int().min(1).max(50) }),
  tiebreaks: z.array(z.enum(['wins', 'bestFinish', 'bestRound'])).max(3),
});

const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha no válida').nullable().optional();
/** Los enlaces de descarga solo pueden ser http(s): nada de `javascript:` ni `file:`. */
const url = z.string().trim().max(500).refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'El enlace debe empezar por http:// o https://');
const image = z.string().trim().max(500).refine((v) => /^https?:\/\//i.test(v), 'La imagen debe ser un enlace http(s)').nullable().optional();
const specs = z.record(z.string().trim().min(1).max(40), z.string().trim().max(80)).refine((o) => Object.keys(o).length <= 20, 'Demasiadas especificaciones').optional();
export const modSchema = z.object({ name: text(120), kind: z.enum(['car', 'track', 'weather', 'skins', 'other']), url, note: z.string().trim().max(300).nullable().optional(), imageUrl: image, specs });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser tipo #ff8800');

const scheduleItem = z.object({
  kind: z.enum(['practice', 'quali', 'race', 'post', 'custom']), at: date.transform((v) => v ?? null),
  title: z.string().trim().max(60).optional(), duration: z.string().trim().max(40).optional(), text: z.string().trim().max(400).optional(),
}).transform((i) => ({ kind: i.kind, at: i.at as string | null, ...(i.title ? { title: i.title } : {}), ...(i.duration ? { duration: i.duration } : {}), ...(i.text ? { text: i.text } : {}) }));

export const championshipInputSchema = z.object({
  name: text(100),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().max(500).refine(isChampionshipImageRef, 'La imagen debe ser una subida del panel o un enlace http(s)').nullable().optional(),
  imageFit: z.enum(['cover', 'contain']).nullable().optional(),
  badgeDesign: z.unknown().transform((v, ctx) => {
    if (v == null) return null;
    const r = validateBadge(v);
    if (!r.ok) { ctx.addIssue({ code: 'custom', message: r.error }); return z.NEVER; }
    return r.badge;
  }).optional(),
  format: z.enum(['individual', 'pairs', 'teams']),
  status: z.enum(['draft', 'active', 'finished']).optional(),
  scoring: scoringSchema,
  teams: z.array(z.object({ key: text(40), name: text(60), color })).max(100),
  entries: z.array(z.object({ driverId: z.number().int().positive(), teamKey: z.string().max(40).nullable(), color: color.nullable().optional(), car: z.string().trim().max(100).nullable().optional(), skin: z.string().trim().max(100).nullable().optional() })).max(500),
  rounds: z.array(z.object({
    id: z.number().int().positive().optional(), track: text(100), layout: z.string().max(100).optional(), cars: z.array(text(100)).max(50).optional(),
    practiceAt: date, qualiAt: date, raceAt: date, weather: z.string().trim().max(60).nullable().optional(), schedule: z.array(scheduleItem).max(12).nullable().optional(), mods: z.array(modSchema).max(30).optional(),
  })).max(100),
  mods: z.array(modSchema).max(50).optional(),
}) satisfies z.ZodType<ChampionshipInput, z.ZodTypeDef, unknown>;
