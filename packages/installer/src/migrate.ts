import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { transformExtraCfg, transformServerCfg } from './transform';
import EXTRA_SCHEMA from '../assets/extra_cfg.schema.pre35.json';


/**
 * Migra un servidor de AC (AssettoServer 0.0.54 + Content Manager) a la versión validada con Howler.
 *
 * Reglas de seguridad:
 *  1. Primero se lee y se transforma TODA la configuración en memoria. Si algo no se entiende, se aborta sin tocar nada.
 *  2. Antes de modificar un archivo se copia a howler-backup/<fecha>/ y se anota en el manifiesto.
 *  3. Si algo falla a mitad, se deshace solo todo lo hecho.
 *  4. rollback() lo deja todo como estaba.
 */

export interface MigrateOptions {
  /** Carpeta del servidor (donde está acServer.exe). */
  serverDir: string;
  /** Carpeta con la versión nueva ya descomprimida (AssettoServer.exe, wwwroot, plugins...). */
  newServerDir: string;
  /** Carpeta con HowlerPlugin.dll y sus archivos. */
  pluginDir: string;
  acspPort?: number;
  acspServerPort?: number;
  now?: () => Date;
  /** Simulación: calcula y devuelve los cambios sin escribir nada. */
  dryRun?: boolean;
  /** Solo para tests: simula un fallo tras copiar N archivos. */
  failAfterCopies?: number;
}

export interface MigrationReport {
  backupDir: string;
  changes: string[];
  warnings: string[];
}

interface Manifest {
  createdAt: string;
  /** Archivos que existían y se han sobrescrito (ruta relativa al servidor). */
  replaced: string[];
  /** Archivos que no existían y se han creado. */
  created: string[];
}

const MARKER = 'howler-migration.json';

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

class Session {
  readonly manifest: Manifest;
  private copies = 0;
  constructor(private serverDir: string, readonly backupDir: string, now: Date, private failAfter?: number) {
    mkdirSync(backupDir, { recursive: true });
    this.manifest = { createdAt: now.toISOString(), replaced: [], created: [] };
  }

  /** Guarda el estado previo de `rel` (si existía) y lo anota en el manifiesto antes de tocarlo. */
  private prepare(rel: string) {
    if (this.failAfter != null && ++this.copies > this.failAfter) throw new Error('fallo simulado');
    const dst = join(this.serverDir, rel);
    if (this.manifest.replaced.includes(rel) || this.manifest.created.includes(rel)) return dst;
    if (existsSync(dst)) {
      const bak = join(this.backupDir, rel);
      mkdirSync(dirname(bak), { recursive: true });
      copyFileSync(dst, bak);
      this.manifest.replaced.push(rel);
    } else {
      this.manifest.created.push(rel);
    }
    this.save(); // el manifiesto siempre va por delante de lo que se toca: así se puede deshacer en cualquier punto
    mkdirSync(dirname(dst), { recursive: true });
    return dst;
  }

  copy(src: string, rel: string) {
    copyFileSync(src, this.prepare(rel));
  }

  write(rel: string, content: string) {
    writeFileSync(this.prepare(rel), content);
  }

  save() {
    writeFileSync(join(this.backupDir, 'manifest.json'), JSON.stringify(this.manifest, null, 2));
    writeFileSync(join(this.serverDir, MARKER), JSON.stringify({ backupDir: this.backupDir, ...this.manifest }, null, 2));
  }
}

export function migrate(o: MigrateOptions): MigrationReport {
  const acspPort = o.acspPort ?? 12000;
  const acspServerPort = o.acspServerPort ?? 11000;
  if (!existsSync(join(o.serverDir, 'acServer.exe'))) throw new Error(`No encuentro acServer.exe en ${o.serverDir}`);
  if (!existsSync(join(o.newServerDir, 'AssettoServer.exe'))) throw new Error(`No encuentro AssettoServer.exe en ${o.newServerDir}`);
  if (!existsSync(join(o.pluginDir, 'HowlerPlugin.dll'))) throw new Error(`No encuentro HowlerPlugin.dll en ${o.pluginDir}`);
  if (existsSync(join(o.serverDir, MARKER))) throw new Error('Este servidor ya está migrado (usa la marcha atrás primero si quieres repetirlo)');

  const changes: string[] = [];
  const warnings: string[] = [];

  // Fase 1: leer y transformar toda la configuración en memoria. Un error aquí no ha tocado nada todavía.
  const available = [
    'HowlerPlugin',
    ...(existsSync(join(o.newServerDir, 'plugins')) ? readdirSync(join(o.newServerDir, 'plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []),
  ];
  const cfgDirs: string[] = [];
  const presets = join(o.serverDir, 'presets');
  if (existsSync(presets)) for (const d of readdirSync(presets, { withFileTypes: true })) if (d.isDirectory()) cfgDirs.push(join('presets', d.name));
  if (existsSync(join(o.serverDir, 'cfg'))) cfgDirs.push('cfg');

  const writes: { rel: string; text: string }[] = [];
  for (const rel of cfgDirs) {
    const server = join(rel, 'server_cfg.ini');
    if (existsSync(join(o.serverDir, server))) {
      const r = transformServerCfg(readFileSync(join(o.serverDir, server), 'utf8'), { acspPort, acspServerPort });
      if (r.changes.length) writes.push({ rel: server, text: r.text });
      changes.push(...r.changes.map((c) => `${server}: ${c}`));
    }
    const extra = join(rel, 'extra_cfg.yml');
    if (existsSync(join(o.serverDir, extra))) {
      let r;
      try {
        r = transformExtraCfg(readFileSync(join(o.serverDir, extra), 'utf8'), { availablePlugins: available, schema: EXTRA_SCHEMA });
      } catch (e) {
        throw new Error(`${extra}: ${(e as Error).message}. No se ha modificado nada.`);
      }
      if (r.changes.length) writes.push({ rel: extra, text: r.text });
      changes.push(...r.changes.map((c) => `${extra}: ${c}`));
      warnings.push(...r.warnings.map((w) => `${extra}: ${w}`));
    }
  }

  if (o.dryRun) {
    changes.unshift('acServer.exe → AssettoServer v0.0.55-pre35');
    changes.push('Plugin de Howler instalado en plugins/HowlerPlugin');
    return { backupDir: '(simulación: no se ha escrito nada)', changes, warnings };
  }

  // Fase 2: aplicar, con copia de seguridad previa de cada archivo y deshacer automático si algo falla.
  const now = (o.now ?? (() => new Date()))();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const s = new Session(o.serverDir, join(o.serverDir, 'howler-backup', stamp), now, o.failAfterCopies);
  try {
    s.copy(join(o.newServerDir, 'AssettoServer.exe'), 'acServer.exe');
    changes.unshift('acServer.exe → AssettoServer v0.0.55-pre35 (el anterior queda en la copia de seguridad)');
    for (const f of ['aspnetcorev2_inprocess.dll', 'csp_xxhash3.dll', 'steam_api64.dll']) {
      if (existsSync(join(o.newServerDir, f))) s.copy(join(o.newServerDir, f), f);
    }
    for (const dir of ['wwwroot', 'plugins']) {
      const base = join(o.newServerDir, dir);
      if (existsSync(base)) for (const f of walk(base)) s.copy(f, relative(o.newServerDir, f));
    }
    for (const f of walk(o.pluginDir)) s.copy(f, join('plugins', 'HowlerPlugin', relative(o.pluginDir, f)));
    changes.push('Plugin de Howler instalado en plugins/HowlerPlugin');
    for (const w of writes) s.write(w.rel, w.text);
    s.save();
  } catch (e) {
    if (s.manifest.replaced.length + s.manifest.created.length === 0) {
      // Falló antes de tocar nada: solo se quita la carpeta de copia de ESTA vez (las copias anteriores no se tocan).
      rmSync(s.backupDir, { recursive: true, force: true });
      const parent = join(o.serverDir, 'howler-backup');
      if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
      throw new Error(`La migración falló (${(e as Error).message}). Se ha deshecho todo; el servidor está como estaba.`);
    }
    try {
      rollback(o.serverDir);
    } catch (e2) {
      throw new Error(`La migración falló (${(e as Error).message}) y la marcha atrás automática también (${(e2 as Error).message}). Copia de seguridad en ${s.backupDir}`);
    }
    throw new Error(`La migración falló (${(e as Error).message}). Se ha deshecho todo; el servidor está como estaba.`);
  }
  return { backupDir: s.backupDir, changes, warnings };
}

/** Deja el servidor exactamente como estaba antes de la migración. */
export function rollback(serverDir: string): { restored: number; removed: number } {
  const markerPath = join(serverDir, MARKER);
  if (!existsSync(markerPath)) throw new Error('Este servidor no está migrado por Howler (no hay marcador)');
  const m = JSON.parse(readFileSync(markerPath, 'utf8')) as Manifest & { backupDir: string };

  for (const rel of m.replaced) {
    if (!existsSync(join(m.backupDir, rel))) throw new Error(`Falta ${join(m.backupDir, rel)} en la copia de seguridad; no se restaura nada más`);
  }
  let restored = 0;
  for (const rel of m.replaced) {
    copyFileSync(join(m.backupDir, rel), join(serverDir, rel));
    restored++;
  }
  let removed = 0;
  for (const rel of m.created) {
    const p = join(serverDir, rel);
    if (existsSync(p)) {
      rmSync(p);
      removed++;
      // Se borran las carpetas que hayan quedado vacías.
      for (let d = dirname(p); d !== serverDir && existsSync(d) && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
    }
  }
  rmSync(markerPath);
  return { restored, removed };
}
