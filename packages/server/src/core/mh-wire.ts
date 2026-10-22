import { z } from 'zod';

/** Lo que viaja entre Howlers. Se valida todo lo recibido: un par aprobado no deja de ser entrada externa. */
const str = (max: number) => z.string().max(max);
const int = z.number().int();

export const wireLapSchema = z.object({
  origin: z.string().uuid(),
  originId: int.positive(),
  originName: str(80).optional(),
  originBadge: str(100).optional(),
  originBadgeBg: str(7).optional(),
  originBadgeFg: str(7).optional(),
  rev: int.nonnegative(),
  session: z.object({
    id: int.positive(),
    track: str(200), layout: str(200), name: str(200),
    type: int.min(0).max(10),
    startedAt: str(40), endedAt: str(40).nullable(),
    fuelPct: int.nullable(), damagePct: int.nullable(), tyreWearPct: int.nullable(), tyresOut: int.nullable(),
  }),
  driver: z.object({ steamId: z.string().regex(/^[\w:.-]{1,100}$/), name: str(100) }),
  track: str(200), layout: str(200), car: str(200),
  lapMs: int.positive().max(86_400_000),
  cuts: int.min(0).max(10_000),
  grip: z.number().nullable(),
  valid: z.boolean(), pending: z.boolean(), invalidReason: str(300).nullable(),
  outLap: z.boolean(), sectorsExact: z.boolean(),
  maxSpeed: z.number().nullable(),
  createdAt: str(40),
  tempAir: int.nullable(), tempTrack: int.nullable(),
  aids: str(2000).nullable(),
  sectorsMs: z.array(int.nonnegative().max(86_400_000)).max(60),
});
export type WireLap = z.infer<typeof wireLapSchema>;

export const MAX_BATCH = 500;

/**
 * Lista tolerante: cada elemento se valida por separado y el que no vale se salta. Así UNA vuelta o campeonato mal formado
 * (por ejemplo, un nombre demasiado largo) no bloquea para siempre la sincronización de todo lo demás.
 */
const lenient = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(z.unknown()).max(max).transform((list) => list.flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data as z.infer<T>] : []; }));
const haveSchema = z.record(z.string().uuid(), int.nonnegative());

/** Trayectorias de las mejores vueltas (comparador y fantasmas): cada lado pide las que le faltan y contesta las suyas. */
const wireTrace = z.object({ id: int.positive(), samples: int.nonnegative().max(200_000), data: str(450_000) });
const traceFields = {
  /** Mi interruptor «compartir trayectorias» de este vínculo. */
  shareTraces: z.boolean().optional(),
  /** Ids (de MIS vueltas, en el Howler que lee esto) de las que quiero la traza. */
  wantTraces: z.array(int.positive()).max(20).optional(),
  traces: lenient(wireTrace, 20).optional(),
  /** Ids ya contestados (con traza o sin ella): el otro lado no los vuelve a pedir. */
  tracesDone: z.array(int.positive()).max(20).optional(),
};

export const syncRequestSchema = z.object({
  uuid: z.string().uuid(),
  name: str(80),
  give: z.boolean(),
  receive: z.boolean(),
  shareChampionships: z.boolean().optional(),
  have: haveSchema,
  push: lenient(wireLapSchema, MAX_BATCH),
  /** Mis campeonatos, solo en la primera vuelta del intercambio y si se comparten. `wantChampionships`: pido los del otro. */
  championships: z.lazy(() => championshipsField).optional(),
  wantChampionships: z.boolean().optional(),
  ...traceFields,
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResponseSchema = z.object({
  uuid: z.string().uuid(),
  name: str(80),
  give: z.boolean(),
  receive: z.boolean(),
  shareChampionships: z.boolean().optional(),
  have: haveSchema,
  changes: lenient(wireLapSchema, MAX_BATCH),
  championships: z.lazy(() => championshipsField).optional(),
  ...traceFields,
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export const requestBodySchema = z.object({
  key: str(100), uuid: z.string().uuid(), name: str(80), give: z.boolean(), receive: z.boolean(),
});
export const statusBodySchema = z.object({ uuid: z.string().uuid(), secret: z.string().regex(/^[0-9a-f]{32}$/) });

// ---- campeonatos compartidos ----
import { modSchema, scoringSchema } from '../admin/championship-schema';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const wireChampionshipSchema = z.object({
  id: int.positive(),
  name: str(100), description: str(2000),
  imageUrl: str(500).regex(/^https?:\/\//i).nullable(),
  format: z.enum(['individual', 'pairs', 'teams']),
  status: z.enum(['active', 'finished']),
  scoring: scoringSchema,
  teams: z.array(z.object({ key: str(40), name: str(60), color: hex })).max(100),
  entries: z.array(z.object({ steamId: z.string().regex(/^[\w:.-]{1,100}$/), name: str(100), teamKey: str(40).nullable(), color: hex.nullable() })).max(500),
  rounds: z.array(z.object({
    id: int.positive(), track: str(100), layout: str(100), cars: z.array(str(100)).max(50),
    practiceAt: str(40).nullable(), qualiAt: str(40).nullable(), raceAt: str(40).nullable(),
    raceSession: int.positive().nullable(), qualiSession: int.positive().nullable(),
    mods: z.array(modSchema).max(30),
  })).max(100),
  mods: z.array(modSchema).max(50),
  adjustments: z.array(z.object({ round: int.positive(), steamId: z.string().regex(/^[\w:.-]{1,100}$/), points: z.number().min(-1000).max(1000), reason: str(300) })).max(1000),
});
export type WireChampionship = z.infer<typeof wireChampionshipSchema>;
export const championshipsField = lenient(wireChampionshipSchema, 50);
