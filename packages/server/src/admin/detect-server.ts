import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Rutas de bibliotecas de Steam a partir del texto de libraryfolders.vdf. */
export function parseLibraryFolders(vdf: string): string[] {
  const out: string[] = [];
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1]!.replace(/\\\\/g, '\\'));
  return out;
}

/** Dónde puede estar el servidor de AC: la carpeta `server` dentro de la instalación de Assetto Corsa en cada biblioteca de Steam. */
export function candidateServerDirs(steamRoots: string[] = defaultSteamRoots()): string[] {
  const libs = new Set<string>(steamRoots);
  for (const root of steamRoots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) for (const l of parseLibraryFolders(readFileSync(vdf, 'utf8'))) libs.add(l);
  }
  return [...libs].map((l) => join(l, 'steamapps', 'common', 'assettocorsa', 'server'));
}

function defaultSteamRoots(): string[] {
  const win = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((p) => join(p!, 'Steam'));
  if (process.platform === 'win32') return win;
  const home = process.env.HOME ?? '';
  return home ? [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam')] : [];
}

export interface ServerDirCheck {
  ok: boolean;
  /** Ejecutable encontrado (AssettoServer.exe o acServer.exe en Windows; AssettoServer o acServer en Linux). */
  exe: string | null;
  /** Presets de Content Manager disponibles. */
  presets: string[];
  /** true si el servidor ya lleva el plugin de Howler. */
  hasPlugin: boolean;
  /** true si Howler lo migró (hay marcador y copia de seguridad). */
  migrated: boolean;
  /** Carpeta de circuitos de la instalación de AC, para los mapas y los sectores. */
  tracksDir: string | null;
  problems: string[];
}

/** Nombre habitual del ejecutable según el sistema. */
export const defaultExe = (platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? 'acServer.exe' : 'AssettoServer');

/** Comprueba que una carpeta es un servidor de AC utilizable y dice qué le falta. */
export function checkServerDir(dir: string, exeName = defaultExe()): ServerDirCheck {
  const problems: string[] = [];
  if (!dir || !existsSync(dir)) {
    return { ok: false, exe: null, presets: [], hasPlugin: false, migrated: false, tracksDir: null, problems: ['La carpeta no existe.'] };
  }
  const exe = [exeName, 'AssettoServer.exe', 'acServer.exe', 'AssettoServer', 'acServer'].find((e) => existsSync(join(dir, e))) ?? null;
  if (!exe) problems.push(`No encuentro ${[...new Set([exeName, process.platform === 'win32' ? 'AssettoServer.exe' : 'AssettoServer'])].join(' ni ')} en esa carpeta.`);

  const presetsDir = join(dir, 'presets');
  const presets = existsSync(presetsDir)
    ? readdirSync(presetsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(presetsDir, d.name, 'server_cfg.ini'))).map((d) => d.name)
    : [];
  if (!presets.length && !existsSync(join(dir, 'cfg', 'server_cfg.ini'))) problems.push('No hay ningún preset ni cfg/server_cfg.ini.');

  const hasPlugin = existsSync(join(dir, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'));
  if (exe && !hasPlugin) problems.push('El servidor no tiene el plugin de Howler: los sectores serán estimaciones y el panel no podrá cambiar hora ni clima.');

  const parentTracks = join(dir, '..', 'content', 'tracks');
  const tracksDir = existsSync(parentTracks) ? join(dir, '..', 'content', 'tracks') : existsSync(join(dir, 'content', 'tracks')) ? join(dir, 'content', 'tracks') : null;
  if (!tracksDir) problems.push('No encuentro la carpeta content/tracks: no habrá mapa ni sectores automáticos.');

  return { ok: !!exe && (presets.length > 0 || existsSync(join(dir, 'cfg', 'server_cfg.ini'))), exe, presets, hasPlugin, migrated: existsSync(join(dir, 'howler-migration.json')), tracksDir, problems };
}

/** Busca servidores de AC en este PC. */
export function detectServers(steamRoots?: string[]): { dir: string; check: ServerDirCheck }[] {
  return candidateServerDirs(steamRoots)
    .filter((d) => existsSync(d))
    .map((dir) => ({ dir, check: checkServerDir(dir) }))
    .filter((r) => r.check.exe !== null);
}
