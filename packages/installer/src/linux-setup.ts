import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkServerDir } from '../../server/src/admin/detect-server';
import { updatePlugin } from './setup/flow';
import { writeHowlerConfig } from './plan';
import { transformExtraCfg, transformServerCfg } from './transform';

/**
 * Prepara un servidor AssettoServer (Linux o cualquier sistema sin el instalador de Windows) para Howler: copia el plugin,
 * activa la interfaz de plugins y el plugin en cada preset, y crea `howler.config.json` si no existe. Lo que cambia en un
 * archivo del servidor se guarda antes como `<archivo>.howler-prev`. Lo usa `install.sh` del paquete de Linux.
 */

export interface LinuxSetupOptions {
  /** Carpeta del servidor (la que tiene el binario `AssettoServer`). */
  serverDir: string;
  /** `plugin/HowlerPlugin` del paquete. */
  pluginDir: string;
  /** Carpeta de Howler (donde va `howler.config.json`). */
  installDir: string;
  /** Preset a usar; sin él se toma el primero (y se preparan todos). */
  preset?: string;
  acspPort?: number;
  acspServerPort?: number;
}

export interface LinuxSetupReport {
  exe: string;
  preset: string | null;
  presets: string[];
  changes: string[];
  warnings: string[];
  backupDir: string | null;
  config: 'created' | 'kept';
}

export function setupLinuxServer(o: LinuxSetupOptions): LinuxSetupReport {
  const check = checkServerDir(o.serverDir);
  if (!check.ok || !check.exe) throw new Error(`La carpeta del servidor no es válida: ${check.problems.join(' ')}`);
  if (/^acServer/i.test(check.exe)) throw new Error('Howler necesita AssettoServer v0.0.55-pre35 (el binario se llama AssettoServer), no el acServer antiguo.');
  if (!existsSync(join(o.pluginDir, 'HowlerPlugin.dll'))) throw new Error(`No encuentro HowlerPlugin.dll en ${o.pluginDir}.`);
  if (o.preset && !check.presets.includes(o.preset)) throw new Error(`El preset «${o.preset}» no existe en ${o.serverDir}/presets (hay: ${check.presets.join(', ') || 'ninguno'}).`);

  const changes: string[] = [];
  const warnings: string[] = [];
  try { chmodSync(join(o.serverDir, check.exe), 0o755); } catch { /* en sistemas sin permisos de archivo no hace falta */ }

  const plugin = updatePlugin(o.serverDir, o.pluginDir);
  changes.push(`Plugin de Howler copiado a plugins/HowlerPlugin (${plugin.created + plugin.replaced} archivos)`);

  const pluginsDir = join(o.serverDir, 'plugins');
  const available = [...new Set([...(existsSync(pluginsDir) ? readdirSync(pluginsDir).filter((n) => statSync(join(pluginsDir, n)).isDirectory()) : []), 'HowlerPlugin'])];
  const schemaFile = join(o.serverDir, 'cfg', 'schemas', 'extra_cfg.schema.json');
  let schema: unknown;
  try { schema = existsSync(schemaFile) ? JSON.parse(readFileSync(schemaFile, 'utf8')) : undefined; } catch { schema = undefined; }

  const targets = [
    ...(o.preset ? [o.preset] : check.presets).map((p) => ({ label: `presets/${p}`, dir: join(o.serverDir, 'presets', p) })),
    ...(existsSync(join(o.serverDir, 'cfg', 'server_cfg.ini')) ? [{ label: 'cfg', dir: join(o.serverDir, 'cfg') }] : []),
  ];
  const patch = (file: string, fix: (text: string) => { text: string; changes: string[]; warnings: string[] }, label: string, initial?: string) => {
    const exists = existsSync(file);
    if (!exists && initial === undefined) return;
    const before = exists ? readFileSync(file, 'utf8') : initial!;
    const r = fix(before);
    if (r.text === before) return;
    if (exists && !existsSync(`${file}.howler-prev`)) copyFileSync(file, `${file}.howler-prev`);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, r.text);
    changes.push(...r.changes.map((c) => `${label}: ${c}`));
    warnings.push(...r.warnings.map((w) => `${label}: ${w}`));
  };
  for (const t of targets) {
    patch(join(t.dir, 'server_cfg.ini'), (text) => transformServerCfg(text, { acspPort: o.acspPort ?? 12000, acspServerPort: o.acspServerPort ?? 11000 }), `${t.label}/server_cfg.ini`);
    patch(join(t.dir, 'extra_cfg.yml'), (text) => transformExtraCfg(text, { availablePlugins: available, schema }), `${t.label}/extra_cfg.yml`, 'EnableLegacyPluginInterface: true\n');
  }

  const preset = o.preset ?? check.presets[0] ?? null;
  const config = writeHowlerConfig(o.installDir, o.serverDir, {}, { exe: check.exe, ...(preset ? { preset } : {}) });
  return { exe: check.exe, preset, presets: check.presets, changes, warnings, backupDir: plugin.backupDir, config };
}
