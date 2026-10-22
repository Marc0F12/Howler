import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SAFE_NAME } from '../core/track-map';

/**
 * Setups fijos (`FIXED_SETUP` de la lista de coches). AssettoServer lee `setups/<nombre>` relativo a su carpeta de
 * trabajo, que es la carpeta del servidor (donde lo arranca Howler), y se lo manda a los jugadores de esa plaza.
 * El archivo es el `.ini` que exporta Assetto Corsa: `[CAR] MODEL=<coche>` y una sección por ajuste con `VALUE=`.
 */

const MAX_SETUP_BYTES = 200 * 1024;
/** Un archivo de setup en la carpeta `setups/` del servidor. */
export interface ServerSetup { file: string; car: string | null; bytes: number }
/** Un setup guardado por el jugador en `Documentos\Assetto Corsa\setups\<coche>\<circuito>\`. */
export interface UserSetup { car: string; track: string; file: string }

const SETUP_FILE = /^[\w.\- ()]{1,100}\.ini$/i;

/** Coche del setup (`[CAR]` / `MODEL=`), o null si el archivo no lo dice. */
export function setupCar(text: string): string | null {
  const m = /^\[CAR\][^[]*?^MODEL=([^\r\n]+)/ims.exec(text);
  return m ? m[1]!.trim() : null;
}

const looksLikeSetup = (text: string) => /^﻿?\[/.test(text) && /^\[CAR\]/im.test(text);

/** Setups que ya están en la carpeta del servidor. */
export function listServerSetups(serverDir: string): ServerSetup[] {
  const dir = join(serverDir, 'setups');
  if (!existsSync(dir)) return [];
  const out: ServerSetup[] = [];
  for (const file of readdirSync(dir)) {
    if (!SETUP_FILE.test(file)) continue;
    const p = join(dir, file);
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size > MAX_SETUP_BYTES) continue;
      out.push({ file, car: setupCar(readFileSync(p, 'utf8')), bytes: st.size });
    } catch { /* ilegible: se salta */ }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Carpetas donde Assetto Corsa guarda los setups del jugador (Documentos normal o redirigido por OneDrive). */
export function userSetupRoots(home = homedir()): string[] {
  const docs = [join(home, 'Documents'), join(home, 'OneDrive', 'Documents'), join(home, 'Documentos'), join(home, 'OneDrive', 'Documentos')];
  return docs.map((d) => join(d, 'Assetto Corsa', 'setups')).filter((p) => existsSync(p));
}

/** Setups del jugador, de todos los coches y circuitos (`setups/<coche>/<circuito>/*.ini`). */
export function listUserSetups(roots = userSetupRoots()): UserSetup[] {
  const out: UserSetup[] = [];
  for (const root of roots) {
    for (const car of safeDirs(root)) {
      for (const track of safeDirs(join(root, car))) {
        for (const file of readdirSync(join(root, car, track))) if (SETUP_FILE.test(file)) out.push({ car, track, file });
      }
    }
  }
  return out;
}

function safeDirs(dir: string): string[] {
  try { return readdirSync(dir).filter((n) => SAFE_NAME.test(n) && statSync(join(dir, n)).isDirectory()); } catch { return []; }
}

/** Nombre plano con el que se guarda en el servidor: `<coche>__<circuito>__<archivo>`. */
export const importedName = (s: UserSetup) => `${s.car}__${s.track}__${s.file}`.replace(/[^\w.\- ()]/g, '_').slice(0, 100);

/**
 * Copia un setup del jugador a `<serverDir>/setups/`. Valida los nombres, el tamaño y que parezca un setup de AC.
 * Devuelve el nombre con el que se puede usar en `FIXED_SETUP`.
 */
export function importUserSetup(serverDir: string, pick: UserSetup, roots = userSetupRoots()): string {
  for (const part of [pick.car, pick.track]) if (!SAFE_NAME.test(part)) throw new Error('Nombre de coche o circuito no válido.');
  if (!SETUP_FILE.test(pick.file)) throw new Error('Nombre de archivo no válido.');
  const src = roots.map((r) => join(r, pick.car, pick.track, pick.file)).find((p) => existsSync(p));
  if (!src) throw new Error('No encuentro ese setup en tus carpetas de Assetto Corsa.');
  const st = statSync(src);
  if (!st.isFile() || st.size > MAX_SETUP_BYTES) throw new Error('El archivo del setup no es válido o es demasiado grande.');
  if (!looksLikeSetup(readFileSync(src, 'utf8'))) throw new Error('Ese archivo no parece un setup de Assetto Corsa.');
  const dir = join(serverDir, 'setups');
  mkdirSync(dir, { recursive: true });
  const name = importedName(pick);
  copyFileSync(src, join(dir, name));
  return name;
}
