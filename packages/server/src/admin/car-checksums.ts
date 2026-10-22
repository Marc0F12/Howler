import { copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { serverCfgPath } from './server-config';
import { setIgnoreFlagText } from './extra-cfg-flags';

/**
 * Comprobación de `data.acd` de los coches. El servidor guarda una suma de control de cada coche y obliga a los jugadores
 * a tener EXACTAMENTE el mismo archivo; con un mod que no se puede repartir eso impide entrar. La solución de AssettoServer
 * (FAQ) es quitar el `data.acd` de ese coche en la carpeta del SERVIDOR y activar `IgnoreConfigurationErrors.MissingCarChecksums`:
 * el servidor deja de exigirlo para ese coche. Aquí el archivo no se borra, se renombra a `data.acd.howler-off` (reversible).
 * Es menos seguro contra trampas (se podría modificar el coche), algo asumible entre amigos.
 */

const SAFE_MODEL = /^(?!\.)[A-Za-z0-9_.-]{1,80}$/;
const OFF_SUFFIX = '.howler-off';

export interface CarChecksumDto {
  model: string;
  /** Hay `data.acd` activo en el servidor: los jugadores deben tener el mismo. */
  required: boolean;
  /** Ya está desactivado por Howler (existe `data.acd.howler-off`). */
  skipped: boolean;
  /** Tiene la carpeta `data` sin empaquetar (y no `data.acd`): el servidor no puede calcular su suma de control. */
  unpacked: boolean;
  /** El coche no está en la carpeta de contenido del servidor. */
  missing: boolean;
  /** La carpeta del coche del servidor es un enlace a otra carpeta (p. ej. tu juego): no se toca. */
  linked: boolean;
}

export interface CarChecksumsState { cars: CarChecksumDto[]; flag: boolean }

/** Coches distintos del `entry_list.ini` del preset. */
export function entryListCars(serverDir: string, preset: string): string[] {
  const file = join(dirname(serverCfgPath(serverDir, preset)), 'entry_list.ini');
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const models = [...readFileSync(file, 'utf8').matchAll(/^\s*MODEL\s*=\s*(\S+)/gim)].map((m) => m[1]!);
  return [...new Set(models)].filter((m) => SAFE_MODEL.test(m));
}

const carDir = (serverDir: string, model: string) => join(serverDir, 'content', 'cars', model);

/** ¿Alguna parte del camino hasta la carpeta del coche es un enlace/junction? */
function isLinked(serverDir: string, model: string): boolean {
  const dir = carDir(serverDir, model);
  try {
    for (const p of [join(serverDir, 'content'), join(serverDir, 'content', 'cars'), dir]) if (lstatSync(p).isSymbolicLink()) return true;
    return resolve(realpathSync(dir)) !== resolve(dir);
  } catch {
    return false;
  }
}

export function setMissingCarChecksumsText(extraCfg: string, on: boolean): string { return setIgnoreFlagText(extraCfg, 'MissingCarChecksums', on); }

function extraCfgPath(serverDir: string, preset: string) { return join(dirname(serverCfgPath(serverDir, preset)), 'extra_cfg.yml'); }

export function readCarChecksums(serverDir: string, preset: string): CarChecksumsState {
  const extra = extraCfgPath(serverDir, preset);
  const flag = existsSync(extra) && /^\s+MissingCarChecksums:\s*true\b/m.test(readFileSync(extra, 'utf8'));
  const cars = entryListCars(serverDir, preset).map((model): CarChecksumDto => {
    const dir = carDir(serverDir, model);
    return {
      model,
      missing: !existsSync(dir),
      required: existsSync(join(dir, 'data.acd')),
      unpacked: !existsSync(join(dir, 'data.acd')) && existsSync(join(dir, 'data')),
      skipped: existsSync(join(dir, `data.acd${OFF_SUFFIX}`)) && !existsSync(join(dir, 'data.acd')),
      linked: isLinked(serverDir, model),
    };
  });
  return { cars, flag };
}

/**
 * Deja de exigir (`skip: true`) o vuelve a exigir (`skip: false`) el `data.acd` de los coches indicados. Devuelve qué se hizo
 * con cada uno. Requiere reiniciar el servidor. Un coche cuya carpeta es un enlace no se toca.
 */
export function applyCarChecksums(serverDir: string, preset: string, models: string[], skip: boolean): { changed: string[]; refused: { model: string; reason: string }[] } {
  const inList = new Set(entryListCars(serverDir, preset));
  const changed: string[] = [], refused: { model: string; reason: string }[] = [];
  for (const model of models) {
    if (!inList.has(model)) { refused.push({ model, reason: 'El coche no está en la lista del servidor.' }); continue; }
    const dir = carDir(serverDir, model);
    if (!existsSync(dir)) { refused.push({ model, reason: 'El coche no está en la carpeta del servidor.' }); continue; }
    if (isLinked(serverDir, model)) { refused.push({ model, reason: 'La carpeta del coche del servidor es un enlace a otra carpeta (p. ej. tu juego): tocarla le quitaría el archivo también a tu propio juego.' }); continue; }
    const acd = join(dir, 'data.acd'), off = join(dir, `data.acd${OFF_SUFFIX}`);
    if (skip && existsSync(acd)) { if (existsSync(off)) { refused.push({ model, reason: 'Ya hay una copia desactivada; revisa la carpeta del coche.' }); continue; } renameSync(acd, off); changed.push(model); }
    else if (!skip && existsSync(off) && !existsSync(acd)) { renameSync(off, acd); changed.push(model); }
  }
  if (skip && (changed.length > 0 || readCarChecksums(serverDir, preset).cars.some((c) => c.skipped))) {
    const extra = extraCfgPath(serverDir, preset);
    if (!existsSync(extra)) throw new Error(`No existe ${extra}.`);
    const text = readFileSync(extra, 'utf8');
    const next = setMissingCarChecksumsText(text, true);
    if (next !== text) { copyFileSync(extra, `${extra}.howler-prev`); writeFileSync(extra, next); }
  }
  return { changed, refused };
}

/**
 * Permite (`on: true`) o vuelve a exigir (`on: false`) que los coches no tengan `data.acd` en el servidor
 * (`IgnoreConfigurationErrors.MissingCarChecksums`). Es el arreglo de un clic cuando el servidor no arranca por un coche sin `data.acd`.
 * No toca ningún coche. Requiere reiniciar el servidor.
 */
export function allowMissingChecksums(serverDir: string, preset: string, on: boolean): boolean {
  const extra = extraCfgPath(serverDir, preset);
  if (!existsSync(extra)) throw new Error(`No existe ${extra}.`);
  const text = readFileSync(extra, 'utf8');
  const next = setMissingCarChecksumsText(text, on);
  if (next === text) return false;
  copyFileSync(extra, `${extra}.howler-prev`);
  writeFileSync(extra, next);
  return true;
}
