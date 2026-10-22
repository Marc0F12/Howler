import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importUserSetup, listServerSetups, listUserSetups, setupCar } from './setups';

const SETUP = '[CAR]\r\nMODEL=ks_nissan_370z\r\n\r\n[FRONT_BIAS]\r\nVALUE=60\r\n';
let dir: string, docs: string, server: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'howler-setups-'));
  docs = join(dir, 'Documents', 'Assetto Corsa', 'setups');
  server = join(dir, 'server');
  mkdirSync(join(docs, 'ks_nissan_370z', 'monza'), { recursive: true });
  mkdirSync(server, { recursive: true });
  writeFileSync(join(docs, 'ks_nissan_370z', 'monza', 'mio.ini'), SETUP);
  writeFileSync(join(docs, 'ks_nissan_370z', 'monza', 'raro.ini'), 'no es un setup');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('setups fijos', () => {
  it('lee el coche del setup', () => {
    expect(setupCar(SETUP)).toBe('ks_nissan_370z');
    expect(setupCar('[OTRA]\nX=1')).toBeNull();
  });
  it('lista los setups del jugador por coche y circuito', () => {
    expect(listUserSetups([docs]).map((s) => `${s.car}/${s.track}/${s.file}`).sort()).toEqual(['ks_nissan_370z/monza/mio.ini', 'ks_nissan_370z/monza/raro.ini']);
  });
  it('importa a la carpeta del servidor con un nombre plano y lo lista con su coche', () => {
    const name = importUserSetup(server, { car: 'ks_nissan_370z', track: 'monza', file: 'mio.ini' }, [docs]);
    expect(name).toBe('ks_nissan_370z__monza__mio.ini');
    expect(readFileSync(join(server, 'setups', name), 'utf8')).toBe(SETUP);
    expect(listServerSetups(server)).toEqual([{ file: name, car: 'ks_nissan_370z', bytes: SETUP.length }]);
  });
  it('rechaza rutas con «..», archivos que no son setups y los que no existen', () => {
    expect(() => importUserSetup(server, { car: '..', track: 'monza', file: 'mio.ini' }, [docs])).toThrow(/no válido/);
    expect(() => importUserSetup(server, { car: 'ks_nissan_370z', track: 'monza', file: '../mio.ini' }, [docs])).toThrow(/no válido/);
    expect(() => importUserSetup(server, { car: 'ks_nissan_370z', track: 'monza', file: 'raro.ini' }, [docs])).toThrow(/no parece/);
    expect(() => importUserSetup(server, { car: 'ks_nissan_370z', track: 'monza', file: 'nada.ini' }, [docs])).toThrow(/No encuentro/);
  });
});
