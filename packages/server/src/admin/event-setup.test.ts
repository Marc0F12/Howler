import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEventSetup } from './event-setup';
import { parseEntryList } from './entry-list';

let dir: string;
const presetDir = () => join(dir, 'presets', 'SERVER_00');
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'howler-evsetup-'));
  mkdirSync(presetDir(), { recursive: true });
  writeFileSync(join(presetDir(), 'server_cfg.ini'), '[SERVER]\r\nTRACK=imola\r\nCONFIG_TRACK=\r\nCARS=mazda_mx5\r\nMAX_CLIENTS=2\r\n');
  writeFileSync(join(presetDir(), 'entry_list.ini'), '[CAR_0]\r\nMODEL=mazda_mx5\r\nSKIN=red\r\nDRIVERNAME=Ana\r\nGUID=\r\n\r\n[CAR_1]\r\nMODEL=bmw_m3\r\nSKIN=blue\r\nDRIVERNAME=\r\nGUID=\r\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('lo que un evento cambia en el servidor', () => {
  it('pone el circuito y rehace la lista de coches conservando las plazas que ya existían', () => {
    applyEventSetup(dir, 'SERVER_00', { track: { track: 'monza', layout: 'gp' }, entries: [{ car: 'mazda_mx5', count: 3 }, { car: 'ferrari', count: 1 }] }, (car) => (car === 'mazda_mx5' ? ['red', 'green', 'white'] : ['rosso']));
    const cfg = readFileSync(join(presetDir(), 'server_cfg.ini'), 'utf8');
    expect(cfg).toMatch(/TRACK=monza/);
    expect(cfg).toMatch(/CONFIG_TRACK=gp/);
    const slots = parseEntryList(readFileSync(join(presetDir(), 'entry_list.ini'), 'utf8'));
    expect(slots.map((s) => [s.model, s.skin])).toEqual([['mazda_mx5', 'red'], ['mazda_mx5', 'green'], ['mazda_mx5', 'white'], ['ferrari', 'rosso']]);
    expect(slots[0]!.driverName).toBe('Ana'); // la plaza que ya existía conserva su piloto
    expect(cfg).toMatch(/MAX_CLIENTS=4/); // el servidor queda coherente con la lista
  });
  it('sin coches no toca la lista, y sin circuito no toca el circuito', () => {
    const before = readFileSync(join(presetDir(), 'entry_list.ini'), 'utf8');
    applyEventSetup(dir, 'SERVER_00', { track: null, entries: [] }, () => []);
    expect(readFileSync(join(presetDir(), 'entry_list.ini'), 'utf8')).toBe(before);
    expect(readFileSync(join(presetDir(), 'server_cfg.ini'), 'utf8')).toMatch(/TRACK=imola/);
  });
});
