import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanBbcode, MAX_SHEET_CHARS, type SheetPresetsDto } from '@howler/shared';

/**
 * Presets de la ficha del servidor guardados por la persona (además de los de serie, que viven en la web).
 * Se guardan en `<dataDir>/sheet-presets.json`, no en el preset del servidor: son de quien usa Howler y valen para cualquier servidor.
 */

const FILE = 'sheet-presets.json';
export const MAX_SHEET_PRESETS = 30;
export const MAX_PRESET_NAME = 40;

function path(dataDir: string): string { return join(dataDir, FILE); }

export function readSheetPresets(dataDir: string): SheetPresetsDto {
  try {
    const raw = JSON.parse(readFileSync(path(dataDir), 'utf8')) as Partial<SheetPresetsDto>;
    const presets = (Array.isArray(raw.presets) ? raw.presets : [])
      .filter((p): p is SheetPresetsDto['presets'][number] => !!p && typeof p.id === 'string' && /^u[0-9a-f]{12}$/.test(p.id) && typeof p.name === 'string' && typeof p.description === 'string')
      .map((p) => ({ id: p.id, name: p.name.slice(0, MAX_PRESET_NAME), description: p.description.slice(0, MAX_SHEET_CHARS) }))
      .slice(0, MAX_SHEET_PRESETS);
    return { presets, defaultId: typeof raw.defaultId === 'string' ? raw.defaultId : null };
  } catch {
    return { presets: [], defaultId: null };
  }
}

function write(dataDir: string, data: SheetPresetsDto): SheetPresetsDto {
  const file = path(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
  return data;
}

/** Guarda un preset nuevo (o sustituye uno con el mismo nombre). La descripción pasa por el limpiador de BBCode. */
export function saveSheetPreset(dataDir: string, name: string, description: string): SheetPresetsDto {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean === '') throw new Error('El preset necesita un nombre.');
  if (clean.length > MAX_PRESET_NAME) throw new Error(`El nombre es demasiado largo (máximo ${MAX_PRESET_NAME} letras).`);
  const text = cleanBbcode(description);
  if (text.length > MAX_SHEET_CHARS) throw new Error(`La descripción es demasiado larga (máximo ${MAX_SHEET_CHARS} caracteres).`);
  const cur = readSheetPresets(dataDir);
  const same = cur.presets.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (same) return write(dataDir, { ...cur, presets: cur.presets.map((p) => (p.id === same.id ? { ...p, description: text } : p)) });
  if (cur.presets.length >= MAX_SHEET_PRESETS) throw new Error(`Ya hay ${MAX_SHEET_PRESETS} presets: borra alguno antes de guardar otro.`);
  return write(dataDir, { ...cur, presets: [...cur.presets, { id: `u${randomBytes(6).toString('hex')}`, name: clean, description: text }] });
}

export function deleteSheetPreset(dataDir: string, id: string): SheetPresetsDto {
  const cur = readSheetPresets(dataDir);
  if (!cur.presets.some((p) => p.id === id)) throw new Error('Ese preset no existe.');
  return write(dataDir, { presets: cur.presets.filter((p) => p.id !== id), defaultId: cur.defaultId === id ? null : cur.defaultId });
}

/** El preset que se carga cuando la descripción está vacía: uno de serie (`howler`, `empty`, `banner`, `rules`), uno propio o `null` (el de serie de Howler). */
export function setDefaultSheetPreset(dataDir: string, id: string | null): SheetPresetsDto {
  const cur = readSheetPresets(dataDir);
  if (id !== null && !/^(howler|empty|banner|rules)$/.test(id) && !cur.presets.some((p) => p.id === id)) throw new Error('Ese preset no existe.');
  return write(dataDir, { ...cur, defaultId: id === 'howler' ? null : id });
}
