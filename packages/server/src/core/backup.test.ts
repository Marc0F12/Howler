import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../db/database';
import { csvField } from '../db/lap-export';
import { Repository } from '../db/repository';
import { applyPendingRestore, autoBackupDue, createBackup, deleteBackup, listBackups, pendingRestore, rotateAutoBackups, stageRestore } from './backup';
import { extractTarGz, writeTarGz } from './tar';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-backup-')); dirs.push(d); return d; };
const dbs: DatabaseSync[] = [];
/** Abre una base de datos y la cierra al acabar la prueba (en Windows no se puede borrar un archivo abierto). */
const open = (path: string) => { const db = openDatabase(path); dbs.push(db); return db; };
afterEach(() => {
  dbs.splice(0).forEach((db) => { try { db.close(); } catch { /* ya cerrada */ } });
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** Una carpeta de datos con base de datos real, una vuelta y una foto de perfil. */
function dataDir(driverName: string) {
  const dir = tmp();
  const db = open(join(dir, 'howler.db'));
  const repo = new Repository(db);
  const s = repo.createSession({ track: 'monza', layout: '', name: 'Practice', type: 1 });
  const d = repo.upsertDriver('76561190000000001', driverName);
  repo.insertLap({ sessionId: s.id, driverId: d, track: 'monza', layout: '', car: 'mx5', lapMs: 100_000, sectorsMs: [30_000, 40_000, 30_000], cuts: 0, grip: 1, valid: true, invalidReason: null, weather: 'Rain' }, []);
  mkdirSync(join(dir, 'avatars'), { recursive: true });
  writeFileSync(join(dir, 'avatars', '1.jpg'), 'foto');
  return { dir, repo, db };
}

describe('copia de seguridad y restauración', () => {
  it('copia, prepara y aplica: la base de datos y las fotos vuelven y lo anterior se guarda aparte', async () => {
    const a = dataDir('Ana');
    const made = await createBackup({ dataDir: a.dir, snapshot: (f) => a.repo.snapshotTo(f), howlerVersion: '9.9.9', auto: false });
    expect(made.name).toMatch(/^howler-manual-\d{8}-\d{4}\.howler-backup$/);
    expect(listBackups(a.dir).map((b) => b.name)).toEqual([made.name]);

    // Otra instalación distinta restaura esa copia
    const b = dataDir('Beto');
    b.repo.snapshotTo(join(b.dir, 'unused.db')); // la conexión sigue abierta, como en un Howler en marcha
    const file = join(a.dir, 'backups', made.name);
    const pending = await stageRestore(b.dir, file, SCHEMA_VERSION);
    expect(pending).toMatchObject({ howlerVersion: '9.9.9', schemaVersion: SCHEMA_VERSION, hasAvatars: 1 });
    expect(pendingRestore(b.dir)).not.toBeNull();
    rmSync(join(b.dir, 'unused.db'));
    b.db.close(); // la restauración se aplica al arrancar, antes de abrir la base de datos

    expect(applyPendingRestore(b.dir)).toBe(true);
    expect(pendingRestore(b.dir)).toBeNull();
    const restored = new Repository(open(join(b.dir, 'howler.db')));
    expect(restored.driverSessionLaps(1, 1).map((l) => [l.lapMs, l.weather])).toEqual([[100_000, 'Rain']]);
    expect(restored.profiles.driverList().map((x) => x.name)).toEqual(['Ana']);
    expect(readFileSync(join(b.dir, 'avatars', '1.jpg'), 'utf8')).toBe('foto');
    // Lo que había antes (la base de Beto) queda guardado
    const before = join(b.dir, 'antes-de-restaurar');
    expect(existsSync(before)).toBe(true);
    const kept = join(before, readdirSync(before)[0]!, 'howler.db');
    expect(new Repository(open(kept)).profiles.driverList().map((x) => x.name)).toEqual(['Beto']);
  });

  it('rechaza un archivo que no es una copia y no deja nada preparado', async () => {
    const dir = tmp();
    const junk = join(dir, 'junk.howler-backup');
    writeFileSync(junk, 'esto no es una copia de seguridad');
    await expect(stageRestore(dir, junk, SCHEMA_VERSION)).rejects.toThrow(/copia de seguridad/);
    expect(pendingRestore(dir)).toBeNull();
    expect(existsSync(join(dir, 'restore-pending'))).toBe(false);
  });

  it('rechaza una copia de una versión más nueva de Howler', async () => {
    const a = dataDir('Ana');
    const made = await createBackup({ dataDir: a.dir, snapshot: (f) => a.repo.snapshotTo(f), howlerVersion: '1', auto: false });
    const dir = tmp();
    await expect(stageRestore(dir, join(a.dir, 'backups', made.name), SCHEMA_VERSION - 1)).rejects.toThrow(/más nueva/);
    expect(pendingRestore(dir)).toBeNull();
  });

  it('no extrae entradas que se salgan de la carpeta ni archivos no permitidos', async () => {
    const dir = tmp();
    const evil = join(dir, 'evil.tar.gz');
    await writeTarGz(evil, [{ name: '../escapado.txt', data: Buffer.from('x') }]);
    await expect(extractTarGz(evil, join(dir, 'out'), () => true)).rejects.toThrow(/sospechosa/);
    expect(existsSync(join(dir, 'escapado.txt'))).toBe(false);
    const mixed = join(dir, 'mixed.tar.gz');
    await writeTarGz(mixed, [{ name: 'meta.json', data: Buffer.from('{}') }, { name: 'otro.exe', data: Buffer.from('mz') }]);
    const r = await extractTarGz(mixed, join(dir, 'out2'), (n) => n === 'meta.json');
    expect(r.files.map((f) => f.name)).toEqual(['meta.json']);
    expect(r.skipped).toEqual(['otro.exe']);
    expect(existsSync(join(dir, 'out2', 'otro.exe'))).toBe(false);
  });

  it('el tar guarda archivos grandes y de tamaños raros sin corromperlos', async () => {
    const dir = tmp();
    const big = Buffer.alloc(3_000_017, 7);
    writeFileSync(join(dir, 'big.bin'), big);
    const out = join(dir, 'x.tar.gz');
    await writeTarGz(out, [{ name: 'big.bin', file: join(dir, 'big.bin') }, { name: 'vacio', data: Buffer.alloc(0) }, { name: 'uno', data: Buffer.from('1') }]);
    const r = await extractTarGz(out, join(dir, 'o'), () => true);
    expect(r.files.map((f) => [f.name, f.size])).toEqual([['big.bin', 3_000_017], ['vacio', 0], ['uno', 1]]);
    expect(readFileSync(join(dir, 'o', 'big.bin')).equals(big)).toBe(true);
  });
});

describe('copias automáticas', () => {
  it('rota solo las automáticas y avisa cuándo toca otra', async () => {
    const a = dataDir('Ana');
    const make = (auto: boolean, min: number) => createBackup({ dataDir: a.dir, snapshot: (f) => a.repo.snapshotTo(f), howlerVersion: '1', auto, now: new Date(2026, 9, 10, 10, min) });
    expect(autoBackupDue(a.dir, 1)).toBe(true);
    await make(true, 1); await make(true, 2); await make(true, 3); const manual = await make(false, 4);
    expect(rotateAutoBackups(a.dir, 2)).toHaveLength(1);
    const names = listBackups(a.dir).map((b) => b.name);
    expect(names).toHaveLength(3);
    expect(names).toContain(manual.name);
    expect(autoBackupDue(a.dir, 1)).toBe(false);
    expect(autoBackupDue(a.dir, 1, new Date(Date.now() + 2 * 86_400_000))).toBe(true);
    deleteBackup(a.dir, manual.name);
    expect(listBackups(a.dir)).toHaveLength(2);
    expect(() => deleteBackup(a.dir, '../../x')).toThrow();
  });
});

describe('exportar tiempos', () => {
  it('escapa campos y neutraliza fórmulas de hoja de cálculo', () => {
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('di "hola"')).toBe('"di ""hola"""');
    expect(csvField('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(csvField(-5)).toBe('-5');
    expect(csvField(null)).toBe('');
  });

  it('el CSV lleva cabecera y una fila por vuelta, sin Steam ID', () => {
    const a = dataDir('Ana');
    const lines = [...a.repo.lapExport.csv()].join('').split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('piloto');
    expect(lines[1]).toContain('Ana');
    expect(lines[1]).toContain('1:40.000');
    expect(lines[1]).toContain('30000 40000 30000');
    expect(lines.join('')).not.toContain('76561190000000001');
  });
});
