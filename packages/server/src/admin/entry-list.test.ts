import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEntryList, parseServerTrack, readEntryList, saveEntryList, saveServerTrack, serializeEntryList, setServerCfgKey, validateSlots, type EntrySlot } from './entry-list';

const SAMPLE = '﻿[CAR_0]\r\nMODEL=ks_mazda\r\nSKIN=00_a\r\nSPECTATOR_MODE=0\r\nDRIVERNAME=Ana\r\nTEAM=\r\nGUID=76561190000000001\r\nBALLAST=10\r\nRESTRICTOR=5\r\nAI=fixed\r\n\r\n[CAR_1]\r\nMODEL=ks_mazda\r\nSKIN=01_b\r\nSPECTATOR_MODE=0\r\nDRIVERNAME=\r\nTEAM=\r\nGUID=\r\nBALLAST=0\r\nRESTRICTOR=0\r\nFIXED_SETUP=drift.ini\r\n';

function server(maxClients = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'howler-el-'));
  mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'P', 'entry_list.ini'), SAMPLE);
  writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), `[SERVER]\r\nNAME=x\r\nCARS=ks_mazda\r\nMAX_CLIENTS=${maxClients}\r\n`);
  return dir;
}
const slot = (o: Partial<EntrySlot> = {}): EntrySlot => ({ model: 'abarth', skin: '', driverName: '', team: '', guid: '', ballast: 0, restrictor: 0, fixedSetup: '', spectator: false, extras: [], ...o });

describe('circuito del preset', () => {
  it('entiende las rutas CSP de Content Manager', () => {
    expect(parseServerTrack('csp/3465/../D/../leroy_gandia', '')).toEqual({ track: 'leroy_gandia', layout: 'D' });
    expect(parseServerTrack('csp/3465/../D/../leroy_gandia', 'B')).toEqual({ track: 'leroy_gandia', layout: 'B' });
    expect(parseServerTrack('csp/3465/../ks_silverstone', '')).toEqual({ track: 'ks_silverstone', layout: '' });
    expect(parseServerTrack('ks_vallelunga', 'club')).toEqual({ track: 'ks_vallelunga', layout: 'club' });
  });
  it('un CONFIG_TRACK vacío no se traga la línea siguiente (TRACK)', () => {
    const dir = server();
    writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), '[SERVER]\r\nCONFIG_TRACK=\r\nTRACK=csp/3465/../st_autumnring\r\nMAX_CLIENTS=2\r\n');
    expect(readEntryList(dir, 'P')).toMatchObject({ track: 'st_autumnring', layout: '', maxClients: 2 });
  });
  it('cambia el circuito conservando el formato CSP', () => {
    const dir = server();
    const cfg = join(dir, 'presets', 'P', 'server_cfg.ini');
    writeFileSync(cfg, '[SERVER]\r\nTRACK=csp/3465/../D/../leroy_gandia\r\nCONFIG_TRACK=D\r\n');
    saveServerTrack(dir, 'P', 'ks_vallelunga', 'club');
    expect(readFileSync(cfg, 'utf8')).toContain('TRACK=csp/3465/../club/../ks_vallelunga\r\nCONFIG_TRACK=club');
    saveServerTrack(dir, 'P', 'ks_monza', '');
    expect(readFileSync(cfg, 'utf8')).toContain('TRACK=csp/3465/../ks_monza');
    expect(() => saveServerTrack(dir, 'P', '../x', '')).toThrow();
  });
  it('lee TRACK y CONFIG_TRACK del server_cfg.ini', () => {
    const dir = server();
    writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), '[SERVER]\r\nTRACK=gandia\r\nCONFIG_TRACK=short\r\nMAX_CLIENTS=2\r\n');
    expect(readEntryList(dir, 'P')).toMatchObject({ track: 'gandia', layout: 'short' });
  });
});

describe('entry_list.ini', () => {
  it('lee los huecos y conserva claves desconocidas', () => {
    const s = parseEntryList(SAMPLE);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ model: 'ks_mazda', skin: '00_a', driverName: 'Ana', guid: '76561190000000001', ballast: 10, restrictor: 5, extras: [['AI', 'fixed']] });
    expect(s[1]!.fixedSetup).toBe('drift.ini');
  });
  it('escribir y volver a leer da lo mismo (ida y vuelta)', () => {
    const s = parseEntryList(SAMPLE);
    expect(parseEntryList(serializeEntryList(s))).toEqual(s);
    expect(serializeEntryList(s).startsWith('﻿[CAR_0]\r\n')).toBe(true);
  });
  it('valida: coche, steam id, lastre y restrictor', () => {
    expect(validateSlots([slot()])).toBeNull();
    expect(validateSlots([])).toMatch(/al menos/);
    expect(validateSlots([slot({ model: '../x' })])).toMatch(/coche/);
    expect(validateSlots([slot({ guid: '123' })])).toMatch(/17 cifras/);
    expect(validateSlots([slot({ guid: '76561190000000001;76561190000000002' })])).toBeNull();
    expect(validateSlots([slot({ ballast: -1 })])).toMatch(/lastre/);
    expect(validateSlots([slot({ restrictor: 401 })])).toMatch(/restrictor/);
    expect(validateSlots([slot({ driverName: 'a\nb' })])).toMatch(/saltos/);
    expect(validateSlots([slot({ extras: [['AI', 'fixed\nMODEL=x']] })])).toMatch(/extra/);
    expect(validateSlots([slot({ extras: [['A B', 'x']] })])).toMatch(/extra/);
    expect(validateSlots([slot({ extras: [['AI', 'fixed']] })])).toBeNull();
  });
  it('guarda con copia, y deja CARS y MAX_CLIENTS coherentes', () => {
    const dir = server(2);
    const r = saveEntryList(dir, 'P', [slot(), slot(), slot({ model: 'ks_mazda' })]);
    expect(r.slots).toHaveLength(3);
    const cfg = readFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), 'utf8');
    expect(cfg).toContain('CARS=abarth;ks_mazda\r\n');
    expect(cfg).toContain('MAX_CLIENTS=3\r\n');
    expect(readFileSync(join(dir, 'presets', 'P', 'entry_list.ini.howler-prev'), 'utf8')).toBe(SAMPLE);
  });
  it('respeta un MAX_CLIENTS menor que las plazas sin pasarse', () => {
    const dir = server(1);
    saveEntryList(dir, 'P', [slot(), slot(), slot()]);
    expect(readEntryList(dir, 'P').maxClients).toBe(1);
    saveEntryList(dir, 'P', [slot()]);
    expect(readEntryList(dir, 'P').maxClients).toBe(1);
  });
  it('no guarda nada si algo no vale', () => {
    const dir = server();
    expect(() => saveEntryList(dir, 'P', [slot({ guid: 'x' })])).toThrow();
    expect(readFileSync(join(dir, 'presets', 'P', 'entry_list.ini'), 'utf8')).toBe(SAMPLE);
  });
  it('setServerCfgKey cambia o añade', () => {
    expect(setServerCfgKey('[SERVER]\nA=1\n', 'A', '2')).toBe('[SERVER]\nA=2\n');
    expect(setServerCfgKey('[SERVER]\nA=1\n', 'B', '2')).toBe('[SERVER]\nB=2\nA=1\n');
    // con la marca BOM que escribe Content Manager
    expect(setServerCfgKey('\uFEFF[SERVER]\r\nA=1\r\n', 'B', '2')).toBe('\uFEFF[SERVER]\r\nB=2\r\nA=1\r\n');
  });
});
