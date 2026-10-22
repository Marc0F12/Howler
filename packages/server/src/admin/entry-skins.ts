import { readEntryList, type EntrySlot } from './entry-list';

export interface SlotSkin { car: string; skin: string | null }

/** Coche y skin de cada Steam ID reservado en la lista de coches (el GUID de una plaza puede traer varios, separados por «;»). Las plazas sin coche o sin piloto no cuentan. */
export function skinsBySteam(slots: EntrySlot[]): Map<string, SlotSkin> {
  const out = new Map<string, SlotSkin>();
  for (const s of slots) {
    if (!s.model) continue;
    for (const id of s.guid.split(';').map((g) => g.trim()).filter((g) => /^\d{17}$/.test(g))) if (!out.has(id)) out.set(id, { car: s.model, skin: s.skin || null });
  }
  return out;
}

/** Proveedor con memoria de 30 s para no leer el archivo en cada petición de la web. Sin lista de coches (o sin servidor) no hay skins que dar. */
export function createSkinSource(serverDir: () => string, preset: () => string, steamOf: (driverId: number) => string | null, now: () => number = Date.now) {
  let cache: { at: number; key: string; map: Map<string, SlotSkin> } | null = null;
  return (driverId: number): SlotSkin | null => {
    const key = `${serverDir()}|${preset()}`;
    if (!cache || cache.key !== key || now() - cache.at > 30_000) {
      let map = new Map<string, SlotSkin>();
      try { map = skinsBySteam(readEntryList(serverDir(), preset()).slots); } catch { /* sin lista de coches */ }
      cache = { at: now(), key, map };
    }
    const steam = steamOf(driverId);
    return steam ? cache.map.get(steam) ?? null : null;
  };
}
