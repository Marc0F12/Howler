import type { ScheduledEventInput } from '@howler/shared';
import { readEntryList, saveEntryList, saveServerTrack, type EntrySlot } from './entry-list';

/**
 * Lo que un evento programado cambia en el servidor además del preset de sesión: el circuito y la lista de coches.
 * De la lista se conservan las plazas que ya existían de cada coche (con su skin, piloto reservado y demás) hasta el
 * número pedido; las que faltan se añaden nuevas con una skin distinta cada una si hay varias, y las de coches que ya no
 * se piden se quitan.
 */
export function applyEventSetup(
  serverDir: string, preset: string,
  ev: Pick<ScheduledEventInput, 'track' | 'entries'>,
  skinsOf: (car: string) => string[],
): void {
  if (ev.track) saveServerTrack(serverDir, preset, ev.track.track, ev.track.layout);
  if (ev.entries.length === 0) return;
  const cur = readEntryList(serverDir, preset).slots;
  const slots: EntrySlot[] = [];
  for (const { car, count } of ev.entries) {
    const mine = cur.filter((s) => s.model === car);
    const skins = skinsOf(car);
    for (let i = 0; i < count; i++) {
      const old = mine[i];
      if (old) { slots.push(old); continue; }
      slots.push({
        model: car, skin: skins.length > 0 ? skins[i % skins.length]! : (mine[0]?.skin ?? ''), driverName: '', team: '', guid: '',
        ballast: 0, restrictor: 0, fixedSetup: '', spectator: false, extras: [],
      });
    }
  }
  saveEntryList(serverDir, preset, slots);
}
