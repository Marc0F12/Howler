import { createReadStream, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BackupStateDto } from '@howler/shared';
import { autoBackupDue, backupsDir, cancelRestore, createBackup, deleteBackup, isBackupName, listBackups, pendingRestore, rotateAutoBackups, stageRestore } from '../core/backup';
import type { Repository } from '../db/repository';
import type { RouteKit } from './route-kit';

const MAX_UPLOAD = 1024 * 1024 * 1024;

export interface BackupDeps {
  repo: Repository;
  dataDir: string;
  howlerVersion: string;
  /** Versión de esquema de la base de datos de esta versión de Howler. */
  schemaVersion: number;
  getBackup: () => { auto: boolean; everyDays: number; keep: number };
  saveBackup: (patch: { auto: boolean; everyDays: number; keep: number }) => void;
  /** Cierra Howler (para aplicar una restauración al volver a abrirlo). */
  requestExit: () => void;
}

/** Hace una copia y recorta las automáticas viejas. Lo usan el botón del panel y el temporizador. */
export async function runBackup(d: Pick<BackupDeps, 'repo' | 'dataDir' | 'howlerVersion' | 'getBackup'>, auto: boolean) {
  const made = await createBackup({ dataDir: d.dataDir, snapshot: (f) => d.repo.snapshotTo(f), howlerVersion: d.howlerVersion, auto });
  if (auto) rotateAutoBackups(d.dataDir, d.getBackup().keep);
  return made;
}

/** Temporizador de las copias automáticas: cada 15 minutos mira si toca (y una vez poco después de arrancar). */
export function startBackupScheduler(d: Pick<BackupDeps, 'repo' | 'dataDir' | 'howlerVersion' | 'getBackup'>): void {
  let running = false;
  const tick = async () => {
    const cfg = d.getBackup();
    if (running || !cfg.auto || !autoBackupDue(d.dataDir, cfg.everyDays)) return;
    running = true;
    try { const b = await runBackup(d, true); console.log(`[howler] copia de seguridad automática: ${b.name}`); }
    catch (e) { console.warn('[howler] no se pudo hacer la copia automática:', (e as Error).message); }
    finally { running = false; }
  };
  setTimeout(() => void tick(), 60_000).unref();
  setInterval(() => void tick(), 15 * 60_000).unref();
}

/** Copias de seguridad, restauración y exportación de tiempos (solo panel). */
export function registerBackupRoutes(app: FastifyInstance, d: BackupDeps, kit: RouteKit) {
  const { fail, guard, body } = kit;
  app.addContentTypeParser('application/x-howler-backup', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, payload, done) => done(null, payload));

  const state = (): BackupStateDto => ({
    settings: d.getBackup(),
    backups: listBackups(d.dataDir),
    pending: pendingRestore(d.dataDir),
  });
  const nameParam = (req: unknown) => z.object({ name: z.string().max(80) }).parse((req as { params: unknown }).params).name;

  app.get('/admin/api/backup', async () => state());

  app.post('/admin/api/backup/create', guard(async () => {
    const made = await runBackup(d, false);
    return { made, ...state() };
  }));

  app.put('/admin/api/backup/settings', guard(async (req) => {
    d.saveBackup(body(z.object({ auto: z.boolean(), everyDays: z.number().int().min(1).max(90), keep: z.number().int().min(1).max(60) }), req));
    return state();
  }));

  app.get('/admin/api/backup/files/:name', async (req, reply) => {
    const name = nameParam(req);
    const file = join(backupsDir(d.dataDir), name);
    if (!isBackupName(name) || !existsSync(file)) return fail(reply, new Error('No existe esa copia.'), 404);
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${name}"`).send(createReadStream(file));
  });

  app.delete('/admin/api/backup/files/:name', guard(async (req) => {
    deleteBackup(d.dataDir, nameParam(req));
    return state();
  }));

  // Restaurar: la copia se valida y se deja preparada; se aplica al volver a abrir Howler.
  app.post('/admin/api/backup/restore/from/:name', guard(async (req) => {
    const name = nameParam(req);
    if (!isBackupName(name)) throw new Error('Nombre de copia no válido.');
    const file = join(backupsDir(d.dataDir), name);
    if (!existsSync(file)) throw new Error('No existe esa copia.');
    await stageRestore(d.dataDir, file, d.schemaVersion);
    return state();
  }));

  app.post('/admin/api/backup/restore/upload', async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(reply, new Error('Manda el archivo de la copia de seguridad.'));
    const tmp = join(d.dataDir, `restore-upload-${process.pid}.tmp`);
    try {
      writeFileSync(tmp, req.body);
      await stageRestore(d.dataDir, tmp, d.schemaVersion);
      return reply.send(state());
    } catch (e) {
      return fail(reply, e);
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  app.post('/admin/api/backup/restore/cancel', guard(async () => { cancelRestore(d.dataDir); return state(); }));

  app.post('/admin/api/backup/restart', guard(async (_req, reply) => {
    if (!pendingRestore(d.dataDir)) throw new Error('No hay ninguna restauración preparada.');
    setTimeout(() => d.requestExit(), 800);
    return (reply as { code: (n: number) => { send: (v: unknown) => unknown } }).code(202).send({ ok: true });
  }));

  // Exportar los tiempos: CSV (Excel en español) o JSON en líneas. Sin Steam ID.
  app.get('/admin/api/export/laps', async (req, reply) => {
    const q = z.object({ format: z.enum(['csv', 'json']).default('csv'), valid: z.enum(['0', '1']).default('0') }).parse(req.query);
    const stamp = new Date().toISOString().slice(0, 10);
    const gen = q.format === 'csv' ? d.repo.lapExport.csv({ onlyValid: q.valid === '1' }) : d.repo.lapExport.jsonLines({ onlyValid: q.valid === '1' });
    return reply
      .header('Content-Type', q.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="howler-vueltas-${stamp}.${q.format === 'csv' ? 'csv' : 'jsonl'}"`)
      .send(Readable.from(gen));
  });
}
