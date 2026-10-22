import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionConditions } from '@howler/shared';
import { SAFE_NAME } from '../core/track-map';

/**
 * Edición de los ajustes de sesión del servidor (los que se aplican al reiniciar), directamente en el
 * server_cfg.ini del preset. Solo se tocan las claves de la lista y se respeta todo lo demás, incluidos
 * los saltos de línea y la marca BOM que escribe Content Manager.
 */

export interface SessionSettings {
  /** Consumo de combustible en %, 100 = normal, 0 = infinito. */
  fuelRate: number;
  /** Nivel de daños en %, 100 = completo, 0 = sin daños, más de 100 = daños aumentados (Content Manager admite hasta 400). */
  damageMultiplier: number;
  /** Desgaste de neumáticos en %, 100 = normal, 0 = sin desgaste. */
  tyreWearRate: number;
}

const KEYS: Record<keyof SessionSettings, { key: string; min: number; max: number }> = {
  fuelRate: { key: 'FUEL_RATE', min: 0, max: 500 },
  damageMultiplier: { key: 'DAMAGE_MULTIPLIER', min: 0, max: 400 },
  tyreWearRate: { key: 'TYRE_WEAR_RATE', min: 0, max: 500 },
};

/** Ruta del server_cfg.ini del preset (o de cfg/ si no hay preset). Lanza si el nombre del preset no es seguro. */
export function serverCfgPath(serverDir: string, preset: string): string {
  if (preset && (!SAFE_NAME.test(preset) || preset.includes('..'))) throw new Error('Nombre de preset no válido.');
  return preset ? join(serverDir, 'presets', preset, 'server_cfg.ini') : join(serverDir, 'cfg', 'server_cfg.ini');
}

function readKey(text: string, key: string): number | null {
  const m = new RegExp(String.raw`^${key}=(-?[\d.]+)`, 'm').exec(text);
  return m ? Number(m[1]) : null;
}

export function readSessionSettings(serverDir: string, preset: string): SessionSettings {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const text = readFileSync(file, 'utf8');
  const get = (k: keyof SessionSettings) => readKey(text, KEYS[k].key) ?? 100;
  return { fuelRate: get('fuelRate'), damageMultiplier: get('damageMultiplier'), tyreWearRate: get('tyreWearRate') };
}

/** Lo que Howler anota de cada sesión: combustible, daños, desgaste y neumáticos fuera permitidos del preset. Nunca lanza: sin archivo, `null`. */
export function readSessionConditions(serverDir: string, preset: string): SessionConditions | null {
  try {
    const file = serverCfgPath(serverDir, preset);
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf8');
    const get = (key: string) => readKey(text, key);
    const c = { fuelPct: get('FUEL_RATE'), damagePct: get('DAMAGE_MULTIPLIER'), tyreWearPct: get('TYRE_WEAR_RATE'), tyresOut: get('ALLOWED_TYRES_OUT') };
    return Object.values(c).some((v) => v != null) ? c : null;
  } catch { return null; }
}

/**
 * Cambia ajustes de sesión. Valida todo antes de escribir. Guarda la versión anterior en
 * server_cfg.ini.howler-prev por si hay que deshacer. Devuelve los valores resultantes.
 */
export function writeSessionSettings(serverDir: string, preset: string, patch: Partial<SessionSettings>): SessionSettings {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);

  for (const [name, value] of Object.entries(patch) as [keyof SessionSettings, number][]) {
    const spec = KEYS[name];
    if (!spec) throw new Error(`Ajuste desconocido: ${name}.`);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(`${name} debe ser un número entero entre ${spec.min} y ${spec.max}.`);
    }
  }

  let text = readFileSync(file, 'utf8');
  for (const [name, value] of Object.entries(patch) as [keyof SessionSettings, number][]) {
    const { key } = KEYS[name];
    const re = new RegExp(String.raw`^(${key}=)[^\r\n]*`, 'm');
    text = re.test(text) ? text.replace(re, `$1${value}`) : text.replace(/^(\uFEFF?\[SERVER\]\r?\n)/m, (m) => `${m}${key}=${value}${m.endsWith('\r\n') ? '\r\n' : '\n'}`);
  }
  copyFileSync(file, `${file}.howler-prev`);
  writeFileSync(file, text);
  return readSessionSettings(serverDir, preset);
}
