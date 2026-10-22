import { describe, expect, it } from 'vitest';
import { skinsBySteam } from './entry-skins';
import type { EntrySlot } from './entry-list';

const slot = (o: Partial<EntrySlot>): EntrySlot => ({ model: 'bmw_m3_e30', skin: 'rojo', driverName: '', team: '', guid: '', ballast: 0, restrictor: 0, fixedSetup: '', spectator: false, extras: [], ...o });

describe('skins de la lista de coches', () => {
  it('une cada Steam ID con el coche y la skin de su plaza, también con varios IDs en una', () => {
    const m = skinsBySteam([slot({ guid: '76561198000000001' }), slot({ model: 'abarth500', skin: '', guid: '76561198000000002;76561198000000003' })]);
    expect(m.get('76561198000000001')).toEqual({ car: 'bmw_m3_e30', skin: 'rojo' });
    expect(m.get('76561198000000002')).toEqual({ car: 'abarth500', skin: null });
    expect(m.get('76561198000000003')).toEqual({ car: 'abarth500', skin: null });
  });
  it('ignora plazas sin coche, sin piloto o con IDs que no son de Steam, y la primera plaza gana', () => {
    const m = skinsBySteam([slot({ model: '', guid: '76561198000000004' }), slot({ guid: 'abc' }), slot({ guid: '' }), slot({ guid: '76561198000000005', skin: 'a' }), slot({ guid: '76561198000000005', skin: 'b' })]);
    expect([...m.keys()]).toEqual(['76561198000000005']);
    expect(m.get('76561198000000005')!.skin).toBe('a');
  });
});
