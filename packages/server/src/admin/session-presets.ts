import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SETTINGS_BY_ID, validateSessions, validateSetting, type SessionsPlan, type SettingValue } from '@howler/shared';

/**
 * Presets de sesión propios (un conjunto de ajustes y de sesiones con nombre). Viven en `<dataDir>/session-presets.json`, no en el
 * preset del servidor: son de quien usa Howler y valen para cualquier servidor. Cada ajuste se valida con el registro compartido.
 */

export interface StoredSessionPreset { id: string; name: string; values: Record<string, SettingValue>; sessions: SessionsPlan }
export interface SessionPresetsDto { presets: StoredSessionPreset[] }

const FILE = 'session-presets.json';
export const MAX_SESSION_PRESETS = 30;
export const MAX_SESSION_PRESET_NAME = 40;
const ID = /^s[0-9a-f]{12}$/;

const path = (dataDir: string) => join(dataDir, FILE);

/** Quita lo que no sea válido (por ejemplo un ajuste que ya no existe) en vez de fallar: un preset viejo sigue sirviendo. */
function clean(values: Record<string, unknown>): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const [id, v] of Object.entries(values)) {
    const spec = SETTINGS_BY_ID.get(id);
    if (!spec) continue;
    try { out[id] = validateSetting(spec, v); } catch { /* valor no válido: se omite */ }
  }
  return out;
}

export function readSessionPresets(dataDir: string): SessionPresetsDto {
  try {
    const raw = JSON.parse(readFileSync(path(dataDir), 'utf8')) as { presets?: unknown };
    const presets: StoredSessionPreset[] = [];
    for (const p of Array.isArray(raw.presets) ? raw.presets : []) {
      const q = p as Partial<StoredSessionPreset>;
      if (!q || typeof q.id !== 'string' || !ID.test(q.id) || typeof q.name !== 'string' || typeof q.values !== 'object' || q.values === null) continue;
      try { presets.push({ id: q.id, name: q.name.slice(0, MAX_SESSION_PRESET_NAME), values: clean(q.values), sessions: validateSessions(q.sessions) }); } catch { /* preset roto: se salta */ }
    }
    return { presets: presets.slice(0, MAX_SESSION_PRESETS) };
  } catch {
    return { presets: [] };
  }
}

function write(dataDir: string, data: SessionPresetsDto): SessionPresetsDto {
  const file = path(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
  return data;
}

/** Guarda un preset nuevo, o sustituye el que tenga el mismo nombre. */
export function saveSessionPreset(dataDir: string, name: string, values: Record<string, unknown>, sessions: unknown): SessionPresetsDto {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n === '') throw new Error('El preset necesita un nombre.');
  if (n.length > MAX_SESSION_PRESET_NAME) throw new Error(`El nombre es demasiado largo (máximo ${MAX_SESSION_PRESET_NAME} letras).`);
  const preset = { values: clean(values), sessions: validateSessions(sessions) };
  const cur = readSessionPresets(dataDir);
  const same = cur.presets.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (same) return write(dataDir, { presets: cur.presets.map((p) => (p.id === same.id ? { ...p, ...preset } : p)) });
  if (cur.presets.length >= MAX_SESSION_PRESETS) throw new Error(`Ya hay ${MAX_SESSION_PRESETS} presets: borra alguno antes de guardar otro.`);
  return write(dataDir, { presets: [...cur.presets, { id: `s${randomBytes(6).toString('hex')}`, name: n, ...preset }] });
}

export function deleteSessionPreset(dataDir: string, id: string): SessionPresetsDto {
  const cur = readSessionPresets(dataDir);
  if (!cur.presets.some((p) => p.id === id)) throw new Error('No existe ese preset.');
  return write(dataDir, { presets: cur.presets.filter((p) => p.id !== id) });
}
