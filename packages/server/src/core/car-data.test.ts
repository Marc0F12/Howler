import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acdCipherKey, readAcd, writeAcdForTests } from './acd';
import { carTyres, parseTyresIni, readCarDataFile } from './car-data';
import { createContentReader } from './ac-content';

const TYRES = `[HEADER]\r\nVERSION=10\r\n[COMPOUND_DEFAULT]\r\nINDEX=0\r\n[FRONT]\r\nNAME=Semislick\r\nSHORT_NAME=SM\r\nWIDTH=0.2\r\n[REAR]\r\nNAME=Semislick\r\nSHORT_NAME=SM\r\n[THERMAL_FRONT]\r\nNAME=x\r\n[FRONT_1]\r\nNAME=Slick Soft\r\nSHORT_NAME=S\r\n[REAR_1]\r\nNAME=Slick Soft\r\nSHORT_NAME=S\r\n[__CM_FRONT_ORIGINAL]\r\nNAME=Copia\r\nSHORT_NAME=ZZ\r\n[FRONT_2]\r\nNAME=Con espacio\r\nSHORT_NAME=A B\r\n`;

describe('data.acd', () => {
  it('la clave depende solo del nombre de la carpeta y tiene 8 partes', () => {
    expect(acdCipherKey('ks_mazda_mx5_cup')).toMatch(/^(\d+-){7}\d+$/);
    expect(acdCipherKey('ks_mazda_mx5_cup')).toBe(acdCipherKey('ks_mazda_mx5_cup'));
    expect(acdCipherKey('abarth500')).not.toBe(acdCipherKey('ks_mazda_mx5_cup'));
  });
  it('lee lo que escribe (ida y vuelta) y se niega con datos rotos', () => {
    const buf = writeAcdForTests([{ name: 'tyres.ini', data: Buffer.from(TYRES) }, { name: 'power.lut', data: Buffer.from('1000|50\n') }], 'mi_coche');
    const files = readAcd(buf, 'mi_coche');
    expect(files.map((f) => f.name)).toEqual(['tyres.ini', 'power.lut']);
    expect(files[0]!.data.toString()).toBe(TYRES);
    expect(readAcd(Buffer.from([1, 2, 3]), 'mi_coche')).toEqual([]);
    expect(readAcd(buf.subarray(0, buf.length - 10), 'mi_coche')).toEqual([]);
  });
});

describe('neumáticos del coche', () => {
  it('saca los compuestos de las secciones FRONT y descarta copias de CM y nombres con espacios', () => {
    expect(parseTyresIni(TYRES)).toEqual([{ short: 'SM', name: 'Semislick' }, { short: 'S', name: 'Slick Soft' }]);
  });
  it('los lee sueltos o desde data.acd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-acd-'));
    try {
      const a = join(dir, 'coche_a'); mkdirSync(join(a, 'data'), { recursive: true }); writeFileSync(join(a, 'data', 'tyres.ini'), TYRES);
      const b = join(dir, 'coche_b'); mkdirSync(b); writeFileSync(join(b, 'data.acd'), writeAcdForTests([{ name: 'tyres.ini', data: Buffer.from(TYRES) }], 'coche_b'));
      expect(carTyres(a).map((t) => t.short)).toEqual(['SM', 'S']);
      expect(carTyres(b).map((t) => t.short)).toEqual(['SM', 'S']);
      expect(readCarDataFile(b, 'nada.ini')).toBeNull();
      expect(carTyres(join(dir, 'no_existe'))).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});


describe('ficha de coche con data.acd', () => {
  it('saca tracción y marchas de un coche cuyo data.acd está cifrado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'howler-acd-'));
    try {
      const car = join(dir, 'cars', 'mi_coche'); mkdirSync(join(car, 'ui'), { recursive: true });
      writeFileSync(join(car, 'ui', 'ui_car.json'), JSON.stringify({ name: 'Mi coche', brand: 'X', tags: [] }));
      const ini = ['[TRACTION]', 'TYPE=RWD', '[GEARS]', 'COUNT=6', ''].join('\r\n');
      writeFileSync(join(car, 'data.acd'), writeAcdForTests([{ name: 'drivetrain.ini', data: Buffer.from(ini) }], 'mi_coche'));
      const card = createContentReader([dir]).carCard('mi_coche')!;
      expect(card.specs['Tracción']).toMatch(/RWD/);
      expect(card.specs['Marchas']).toBe('6');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
