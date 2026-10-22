import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSessionConditions, readSessionSettings, serverCfgPath, writeSessionSettings } from './server-config';

const CFG = '\uFEFF[SERVER]\r\nNAME=Patata\r\nFUEL_RATE=100\r\nDAMAGE_MULTIPLIER=100\r\nTYRE_WEAR_RATE=0\r\nTCP_PORT=9600\r\n\r\n[PRACTICE]\r\nNAME=Practice\r\n';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function server(cfg = CFG) {
  const d = mkdtempSync(join(tmpdir(), 'howler-cfg-'));
  dirs.push(d);
  mkdirSync(join(d, 'presets', 'SERVER_00'), { recursive: true });
  writeFileSync(join(d, 'presets', 'SERVER_00', 'server_cfg.ini'), cfg);
  return d;
}

describe('ajustes de sesión', () => {
  it('lee combustible, daños y desgaste', () => {
    expect(readSessionSettings(server(), 'SERVER_00')).toEqual({ fuelRate: 100, damageMultiplier: 100, tyreWearRate: 0 });
  });

  it('cambia solo las claves pedidas y conserva todo lo demás, BOM y saltos de línea incluidos', () => {
    const d = server();
    const r = writeSessionSettings(d, 'SERVER_00', { damageMultiplier: 50, tyreWearRate: 200 });
    expect(r).toEqual({ fuelRate: 100, damageMultiplier: 50, tyreWearRate: 200 });
    const out = readFileSync(join(d, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8');
    expect(out).toBe(CFG.replace('DAMAGE_MULTIPLIER=100', 'DAMAGE_MULTIPLIER=50').replace('TYRE_WEAR_RATE=0', 'TYRE_WEAR_RATE=200'));
  });

  it('guarda la versión anterior por si hay que deshacer', () => {
    const d = server();
    writeSessionSettings(d, 'SERVER_00', { fuelRate: 0 });
    expect(readFileSync(join(d, 'presets', 'SERVER_00', 'server_cfg.ini.howler-prev'), 'utf8')).toBe(CFG);
  });

  it('añade la clave si no existía', () => {
    const d = server('[SERVER]\nNAME=x\n');
    writeSessionSettings(d, 'SERVER_00', { fuelRate: 150 });
    expect(readFileSync(join(d, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8')).toBe('[SERVER]\nFUEL_RATE=150\nNAME=x\n');
  });

  it('valida los rangos y no escribe nada si algo es inválido', () => {
    const d = server();
    expect(() => writeSessionSettings(d, 'SERVER_00', { damageMultiplier: 401 })).toThrow(/entre 0 y 400/);
    expect(() => writeSessionSettings(d, 'SERVER_00', { fuelRate: -1 })).toThrow();
    expect(() => writeSessionSettings(d, 'SERVER_00', { fuelRate: 1.5 })).toThrow();
    expect(() => writeSessionSettings(d, 'SERVER_00', { fuelRate: 50, damageMultiplier: 999 })).toThrow();
    expect(readFileSync(join(d, 'presets', 'SERVER_00', 'server_cfg.ini'), 'utf8')).toBe(CFG);
  });

  it('no permite salir de la carpeta del servidor con el nombre del preset', () => {
    expect(() => serverCfgPath('C:\\srv', '..\\..\\Windows')).toThrow(/no válido/);
    expect(() => serverCfgPath('C:\\srv', '../x')).toThrow();
    expect(serverCfgPath('C:\\srv', '')).toContain('cfg');
  });
});

describe('condiciones de sesión (para anotarlas en cada sesión)', () => {
  it('lee combustible, daños, desgaste y neumáticos fuera; lo que no está queda en null', () => {
    expect(readSessionConditions(server(), 'SERVER_00')).toEqual({ fuelPct: 100, damagePct: 100, tyreWearPct: 0, tyresOut: null });
    expect(readSessionConditions(server(CFG.replace('TCP_PORT=9600', 'ALLOWED_TYRES_OUT=2')), 'SERVER_00')!.tyresOut).toBe(2);
  });
  it('nunca lanza: sin archivo, sin preset válido o sin claves devuelve null', () => {
    expect(readSessionConditions(join(tmpdir(), 'no-existe-howler'), 'SERVER_00')).toBeNull();
    expect(readSessionConditions(server(), '../../etc')).toBeNull();
    expect(readSessionConditions(server('[SERVER]\r\nNAME=x\r\n'), 'SERVER_00')).toBeNull();
  });
});

describe('clave que falta en un server_cfg.ini con BOM', () => {
  it('se añade tras [SERVER] y se conserva el BOM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-bom-'));
    mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
    const file = join(dir, 'presets', 'P', 'server_cfg.ini');
    writeFileSync(file, '﻿[SERVER]\r\nFUEL_RATE=100\r\nDAMAGE_MULTIPLIER=100\r\n');
    expect(writeSessionSettings(dir, 'P', { tyreWearRate: 50 }).tyreWearRate).toBe(50);
    expect(readFileSync(file, 'utf8')).toBe('﻿[SERVER]\r\nTYRE_WEAR_RATE=50\r\nFUEL_RATE=100\r\nDAMAGE_MULTIPLIER=100\r\n');
  });
});
