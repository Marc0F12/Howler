import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { LapRules } from '@howler/shared';
import type { ImportReportDto } from '@howler/shared';
import { importStrackerSteps, inspectStracker, type ImportProgress } from '../core/stracker-import';
import type { Repository } from '../db/repository';

/** Tamaño máximo del archivo de stracker que se acepta subir. */
const MAX_UPLOAD = 500 * 1024 * 1024;
const STALE_MS = 2 * 3_600_000;
const ID = /^[0-9a-f]{32}$/;

export interface ImportDeps {
  repo: Repository;
  /** Carpeta temporal donde se guardan los archivos subidos mientras se decide qué importar. */
  dir: string;
  rulesFor: (track: string, layout: string) => LapRules;
  /** ¿Existe ese circuito y layout en el contenido de AC instalado? */
  inContent?: (track: string, layout: string) => boolean;
  onLapsChanged: () => void;
}

const choice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new') }),
  z.object({ mode: z.literal('skip') }),
  z.object({ mode: z.literal('link'), driverId: z.number().int().positive() }),
]);
const applySchema = z.object({
  uploadId: z.string().regex(ID),
  players: z.record(z.string().regex(/^\d+$/), choice),
  tracks: z.record(z.string().max(300), z.object({ track: z.string().trim().min(1).max(200), layout: z.string().trim().max(200) })),
  championships: z.boolean(),
});

/**
 * Importar desde stracker (solo panel): se sube el `.db3`, se enseña un resumen para decidir (a quién enlazar, circuitos,
 * campeonatos) y se aplica. El archivo se guarda con nombre aleatorio y se borra al terminar.
 */
export function registerImportRoutes(
  app: FastifyInstance,
  d: ImportDeps,
  h: { guard: (fn: (req: { body: unknown }, reply: FastifyReply) => Promise<unknown>) => (req: { body: unknown }, reply: FastifyReply) => Promise<unknown>; fail: (reply: FastifyReply, e: unknown, code?: number) => FastifyReply },
) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, payload, done) => done(null, payload));
  const fileOf = (id: string) => join(d.dir, `${id}.db3`);
  const sweep = () => {
    try {
      for (const f of readdirSync(d.dir)) {
        const p = join(d.dir, f);
        if (/\.db3$/.test(f) && Date.now() - statSync(p).mtimeMs > STALE_MS) unlinkSync(p);
      }
    } catch { /* sin carpeta aún */ }
  };

  app.post('/admin/api/import/stracker/upload', async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return h.fail(reply, new Error('Manda el archivo .db3 de stracker.'));
    mkdirSync(d.dir, { recursive: true });
    sweep();
    const id = randomBytes(16).toString('hex');
    writeFileSync(fileOf(id), req.body);
    try {
      return reply.send({ uploadId: id, ...inspectStracker(fileOf(id), d.repo, d.inContent) });
    } catch (e) {
      unlinkSync(fileOf(id));
      return h.fail(reply, e);
    }
  });

  // La importación corre en segundo plano, sesión a sesión, para poder enseñar el avance y no bloquear el servidor.
  type Job = { state: 'running' | 'done' | 'error'; progress: ImportProgress; report?: ImportReportDto; error?: string; finishedAt?: number };
  const jobs = new Map<string, Job>();
  const forgetOld = () => { for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 10 * 60_000) jobs.delete(id); };
  const runJob = (job: Job, uploadId: string, input: z.infer<typeof applySchema>) => {
    const it = importStrackerSteps(d.repo, fileOf(uploadId), input, d.rulesFor, d.inContent);
    const step = () => {
      try {
        const r = it.next();
        if (r.done) {
          job.state = 'done'; job.report = r.value; job.finishedAt = Date.now();
          try { unlinkSync(fileOf(uploadId)); } catch { /* ya borrado */ }
          d.onLapsChanged();
          return;
        }
        job.progress = r.value;
        setImmediate(step);
      } catch (e) {
        job.state = 'error'; job.error = e instanceof Error ? e.message : String(e); job.finishedAt = Date.now();
      }
    };
    setImmediate(step);
  };
  app.post('/admin/api/import/stracker/apply', h.guard(async (req, reply) => {
    const b = applySchema.parse(req.body);
    if (!existsSync(fileOf(b.uploadId))) return h.fail(reply, new Error('Ese archivo ya no está: vuelve a subirlo.'), 404);
    forgetOld();
    if ([...jobs.values()].some((j) => j.state === 'running')) return h.fail(reply, new Error('Ya hay una importación en marcha: espera a que termine.'), 409);
    const jobId = randomBytes(16).toString('hex');
    const job: Job = { state: 'running', progress: { done: 0, total: 0 } };
    jobs.set(jobId, job);
    runJob(job, b.uploadId, b);
    return reply.send({ jobId });
  }));
  app.get('/admin/api/import/stracker/jobs/:jobId', h.guard(async (req, reply) => {
    const { jobId } = z.object({ jobId: z.string().regex(ID) }).parse((req as unknown as { params: unknown }).params);
    const j = jobs.get(jobId);
    if (!j) return h.fail(reply, new Error('Esa importación no existe (¿se reinició Howler?).'), 404);
    return reply.send({ state: j.state, done: j.progress.done, total: j.progress.total, report: j.report ?? null, error: j.error ?? null });
  }));

  // Pilotos que creó una importación y que aún no se han unido a un piloto con Steam real.
  app.get('/admin/api/import/drivers', async () => ({ imported: d.repo.imports.importedDrivers(), drivers: d.repo.imports.allDrivers() }));
  app.post('/admin/api/import/merge', h.guard(async (req, reply) => {
    const b = z.object({ fromId: z.number().int().positive(), intoId: z.number().int().positive() }).parse(req.body);
    d.repo.imports.mergeDriver(b.fromId, b.intoId);
    d.onLapsChanged();
    return reply.send({ ok: true });
  }));

  app.delete('/admin/api/import/stracker/:uploadId', h.guard(async (req, reply) => {
    const { uploadId } = z.object({ uploadId: z.string().regex(ID) }).parse((req as unknown as { params: unknown }).params);
    try { unlinkSync(fileOf(uploadId)); } catch { /* no existía */ }
    return reply.send({ ok: true });
  }));
}
