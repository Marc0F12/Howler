import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BackupFileDto, PendingRestoreDto } from '@howler/shared';
import { extractTarGz, writeTarGz, type TarEntry } from './tar';

/**
 * Copias de seguridad de los datos de Howler: un solo archivo `.howler-backup` (tar + gzip) con la base de datos (copia
 * consistente con VACUUM INTO), las fotos de perfil y las imágenes de campeonato. Restaurar no toca nada en caliente: la copia se
 * deja preparada en `restore-pending/` y se aplica al arrancar Howler (guardando antes lo que había en `antes-de-restaurar/`).
 * OJO: la base de datos lleva los Steam ID de los pilotos; la copia es privada y no debe compartirse.
 */

export const BACKUP_EXT = '.howler-backup';
const FORMAT = 'howler-backup';
const NAME_OK = /^howler-(auto-|manual-)?\d{8}-\d{4}(-\d+)?\.howler-backup$/;
const ASSET_OK = /^(avatars|championship-images)\/[A-Za-z0-9_.-]{1,80}$/;

export interface BackupMeta {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  howlerVersion: string;
  /** `PRAGMA user_version` de la base de datos de la copia. */
  schemaVersion: number;
  auto: boolean;
}

export const isBackupName = (n: string) => NAME_OK.test(n);

export function backupsDir(dataDir: string) { return join(dataDir, 'backups'); }
const pendingDir = (dataDir: string) => join(dataDir, 'restore-pending');

const stamp = (d: Date) => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function listBackups(dataDir: string): BackupFileDto[] {
  const dir = backupsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isBackupName).map((name) => {
    const st = statSync(join(dir, name));
    return { name, bytes: st.size, at: st.mtime.toISOString(), auto: name.startsWith('howler-auto-') };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

function assetFiles(dataDir: string): TarEntry[] {
  const out: TarEntry[] = [];
  for (const dir of ['avatars', 'championship-images']) {
    const p = join(dataDir, dir);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) if (ASSET_OK.test(`${dir}/${f}`) && statSync(join(p, f)).isFile()) out.push({ name: `${dir}/${f}`, file: join(p, f) });
  }
  return out;
}

/**
 * Crea una copia en `<dataDir>/backups/`. `snapshot(file)` debe dejar en `file` una copia consistente de la base de datos
 * (VACUUM INTO sobre la conexión abierta). Devuelve el archivo creado.
 */
export async function createBackup(opts: { dataDir: string; snapshot: (file: string) => void; howlerVersion: string; auto: boolean; now?: Date }): Promise<BackupFileDto> {
  const now = opts.now ?? new Date();
  const dir = backupsDir(opts.dataDir);
  mkdirSync(dir, { recursive: true });
  const tmpDb = join(dir, `.snapshot-${process.pid}-${now.getTime()}.db`);
  let name = '';
  for (let n = 0; ; n++) {
    name = `howler-${opts.auto ? 'auto-' : 'manual-'}${stamp(now)}${n ? `-${n}` : ''}${BACKUP_EXT}`;
    if (!existsSync(join(dir, name))) break;
  }
  try {
    opts.snapshot(tmpDb);
    const schema = new DatabaseSync(tmpDb, { readOnly: true });
    let schemaVersion = 0;
    try { schemaVersion = (schema.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { schema.close(); }
    const meta: BackupMeta = { format: FORMAT, version: 1, createdAt: now.toISOString(), howlerVersion: opts.howlerVersion, schemaVersion, auto: opts.auto };
    const part = join(dir, `${name}.part`);
    await writeTarGz(part, [
      { name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2)) },
      { name: 'howler.db', file: tmpDb },
      ...assetFiles(opts.dataDir),
    ]);
    renameSync(part, join(dir, name));
  } finally {
    rmSync(tmpDb, { force: true });
    rmSync(join(dir, `${name}.part`), { force: true });
  }
  const st = statSync(join(dir, name));
  return { name, bytes: st.size, at: st.mtime.toISOString(), auto: opts.auto };
}

/** Borra las copias automáticas más antiguas dejando `keep`. Las manuales no se tocan nunca. */
export function rotateAutoBackups(dataDir: string, keep: number): string[] {
  const autos = listBackups(dataDir).filter((b) => b.auto);
  const gone = autos.slice(Math.max(1, keep)).map((b) => b.name);
  for (const n of gone) rmSync(join(backupsDir(dataDir), n), { force: true });
  return gone;
}

export function deleteBackup(dataDir: string, name: string): void {
  if (!isBackupName(name)) throw new Error('Nombre de copia no válido.');
  rmSync(join(backupsDir(dataDir), name), { force: true });
}

function clearPending(dataDir: string) { rmSync(pendingDir(dataDir), { recursive: true, force: true }); }

export function pendingRestore(dataDir: string): PendingRestoreDto | null {
  const dir = pendingDir(dataDir);
  try {
    if (!existsSync(join(dir, 'ready'))) return null;
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as BackupMeta;
    const count = (sub: string) => { try { return readdirSync(join(dir, sub)).length; } catch { return 0; } };
    return { createdAt: meta.createdAt, howlerVersion: meta.howlerVersion, schemaVersion: meta.schemaVersion, hasAvatars: count('avatars'), hasImages: count('championship-images') };
  } catch { return null; }
}

export function cancelRestore(dataDir: string) { clearPending(dataDir); }

/**
 * Deja una copia lista para aplicar en el próximo arranque. Valida el archivo entero (formato, que la base de datos abra y esté
 * íntegra y que no sea de una versión de Howler más nueva que esta) ANTES de aceptar nada.
 * `maxSchema` = versión de esquema que conoce esta versión de Howler.
 */
export async function stageRestore(dataDir: string, file: string, maxSchema: number): Promise<PendingRestoreDto> {
  clearPending(dataDir);
  const dest = pendingDir(dataDir);
  try {
    await extractTarGz(file, dest, (n) => n === 'meta.json' || n === 'howler.db' || ASSET_OK.test(n)).catch((e: Error) => {
      throw /incorrect header|unexpected end|invalid/i.test(e.message) ? new Error('El archivo no es una copia de seguridad de Howler.') : e;
    });
    if (!existsSync(join(dest, 'meta.json')) || !existsSync(join(dest, 'howler.db'))) throw new Error('El archivo no es una copia de seguridad de Howler (falta la base de datos).');
    let meta: BackupMeta;
    try { meta = JSON.parse(readFileSync(join(dest, 'meta.json'), 'utf8')) as BackupMeta; } catch { throw new Error('La copia de seguridad está dañada (meta.json).'); }
    if (meta.format !== FORMAT || meta.version !== 1) throw new Error('El archivo no es una copia de seguridad de Howler.');
    const db = new DatabaseSync(join(dest, 'howler.db'), { readOnly: true });
    try {
      const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      if (check.integrity_check !== 'ok') throw new Error('La base de datos de la copia está dañada.');
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (version > maxSchema) throw new Error('Esta copia es de una versión de Howler más nueva que la instalada. Actualiza Howler y vuelve a intentarlo.');
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'laps'").get()) throw new Error('La copia no contiene los datos de Howler.');
      meta.schemaVersion = version;
    } finally { db.close(); }
    writeFileSync(join(dest, 'meta.json'), JSON.stringify(meta, null, 2));
    writeFileSync(join(dest, 'ready'), new Date().toISOString());
    return pendingRestore(dataDir)!;
  } catch (e) {
    clearPending(dataDir);
    throw e;
  }
}

/**
 * Se llama al arrancar, ANTES de abrir la base de datos: si hay una restauración preparada, guarda lo actual en
 * `antes-de-restaurar/<fecha>/` y pone la copia en su sitio. Devuelve true si se aplicó.
 */
export function applyPendingRestore(dataDir: string, now = new Date()): boolean {
  const pending = pendingDir(dataDir);
  if (!existsSync(join(pending, 'ready')) || !existsSync(join(pending, 'howler.db'))) { clearPending(dataDir); return false; }
  const safe = join(dataDir, 'antes-de-restaurar', stamp(now) + `-${now.getSeconds()}`);
  mkdirSync(safe, { recursive: true });
  for (const f of ['howler.db', 'howler.db-wal', 'howler.db-shm']) if (existsSync(join(dataDir, f))) renameSync(join(dataDir, f), join(safe, f));
  for (const d of ['avatars', 'championship-images']) if (existsSync(join(dataDir, d))) renameSync(join(dataDir, d), join(safe, d));
  copyFileSync(join(pending, 'howler.db'), join(dataDir, 'howler.db'));
  for (const d of ['avatars', 'championship-images']) if (existsSync(join(pending, d))) renameSync(join(pending, d), join(dataDir, d));
  clearPending(dataDir);
  return true;
}

/** ¿Toca hacer una copia automática? (la última automática es más vieja que `everyDays`, o no hay ninguna) */
export function autoBackupDue(dataDir: string, everyDays: number, now = new Date()): boolean {
  const last = listBackups(dataDir).find((b) => b.auto);
  return !last || now.getTime() - new Date(last.at).getTime() >= everyDays * 86_400_000 - 60_000;
}
