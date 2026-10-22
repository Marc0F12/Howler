import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveMargin, findTrackMap, parseMapIni, SAFE_NAME } from './track-map';

const INI = '[PARAMETERS]\r\nWIDTH=1014\r\nHEIGHT=912\r\nX_OFFSET=519.092742919922\r\nZ_OFFSET=491.975128173828\r\nMARGIN=20\r\nSCALE_FACTOR=1\r\nDRAWING_SIZE=10\r\n';

describe('map.ini', () => {
  it('lee tamaño, desplazamientos, escala y el margen que lleva la imagen', () => {
    expect(parseMapIni(INI)).toEqual({ width: 1014, height: 912, xOffset: 519.092742919922, zOffset: 491.975128173828, scale: 1, margin: 20 });
  });
  it('rechaza un archivo incompleto y usa escala 1 si falta', () => {
    expect(parseMapIni('[PARAMETERS]\nWIDTH=10\n')).toBeNull();
    expect(parseMapIni('WIDTH=10\nHEIGHT=20\nX_OFFSET=1\nZ_OFFSET=2\n')?.scale).toBe(1);
  });
});

describe('búsqueda del mapa de un circuito', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  function fixture(layout = '') {
    const root = mkdtempSync(join(tmpdir(), 'howler-map-'));
    dirs.push(root);
    const base = layout ? join(root, 'mi_circuito', layout) : join(root, 'mi_circuito');
    mkdirSync(join(base, 'data'), { recursive: true });
    writeFileSync(join(base, 'map.png'), 'png');
    writeFileSync(join(base, 'data', 'map.ini'), INI);
    return root;
  }

  it('encuentra el mapa de un circuito sin layout y con layout', () => {
    expect(findTrackMap('mi_circuito', '', [fixture()])?.info).toMatchObject({ track: 'mi_circuito', width: 1014 });
    expect(findTrackMap('mi_circuito', 'club', [fixture('club')])?.info.layout).toBe('club');
  });
  it('prueba las carpetas en orden y devuelve null si no está', () => {
    expect(findTrackMap('mi_circuito', '', ['/no/existe', fixture()])).not.toBeNull();
    expect(findTrackMap('otro', '', [fixture()])).toBeNull();
  });
  it('no deja salir de la carpeta de circuitos', () => {
    const root = fixture();
    expect(findTrackMap('..', '', [root])).toBeNull();
    expect(findTrackMap('mi_circuito', '../mi_circuito', [root])).toBeNull();
    // «csp/../x» se reduce a su último tramo, que sí es seguro: nunca sale de la carpeta de circuitos
    expect(findTrackMap('../..', '', [root])).toBeNull();
    expect(findTrackMap('csp/3465/../mi_circuito', '', [root])?.info.track).toBe('mi_circuito');
    expect(findTrackMap('..\\x', '', [root])).toBeNull();
  });
});

describe('margen efectivo del mapa', () => {
  const vallelunga = { width: 599.505, height: 256.251, margin: 20 };
  it('si la imagen mide WIDTH×HEIGHT, X_OFFSET ya incluye el margen: no se suma', () => {
    expect(effectiveMargin(vallelunga, { w: 599, h: 256 })).toBe(0);
  });
  it('si la imagen mide WIDTH+2·MARGIN, se suma el margen', () => {
    expect(effectiveMargin({ width: 712, height: 1408, margin: 10 }, { w: 732, h: 1428 })).toBe(10);
  });
  it('sin poder medir la imagen, o si no encaja con nada, se usa el MARGIN del ini', () => {
    expect(effectiveMargin(vallelunga, null)).toBe(20);
    expect(effectiveMargin({ width: 2368, height: 890, margin: 10 }, { w: 1993, h: 872 })).toBe(10);
  });
});

describe('SAFE_NAME', () => {
  it('admite nombres de carpeta normales y rechaza rutas', () => {
    for (const ok of ['ks_vallelunga', 'club', 'mod-car.v2', 'Brooklyn Park', '']) expect(SAFE_NAME.test(ok), ok).toBe(true);
    for (const bad of ['..', '.', '.hidden', 'a/b', 'a\\b', '../x', ' a']) expect(SAFE_NAME.test(bad), bad).toBe(false);
  });
});
