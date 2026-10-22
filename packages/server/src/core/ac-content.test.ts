import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContentReader, formatSpec, formatTrackLength, parseDrivetrainIni, parseLooseJson } from './ac-content';

const root = mkdtempSync(join(tmpdir(), 'howler-content-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, content = 'x') {
  const path = join(root, ...rel.split('/'));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

put('cars/porsche/ui/ui_car.json', JSON.stringify({ name: 'Porsche 992 GT3 RS', brand: 'Porsche' }));
put('cars/porsche/skins/02_b/preview.jpg');
const first = put('cars/porsche/skins/01_a/preview.jpg');
put('cars/nodata/skins/x/readme.txt');
put('tracks/castelloli/ui/ui_track.json', '﻿' + JSON.stringify({ name: 'Parcmotor Castelloli', country: 'Spain' }));
const trackImg = put('tracks/castelloli/ui/preview.png');
put('tracks/ring/ui/gp/ui_track.json', JSON.stringify({ name: 'Nordschleife GP' }));

const reader = createContentReader([root]);

describe('contenido de AC', () => {
  it('lee el nombre real y la marca de un coche, y elige la primera skin con imagen', () => {
    expect(reader.carInfo('porsche')).toEqual({ name: 'Porsche 992 GT3 RS', brand: 'Porsche' });
    expect(reader.carPreview('porsche')).toBe(first);
  });

  it('lee circuitos con y sin layout, incluido un JSON con BOM', () => {
    expect(reader.trackInfo('castelloli', '')).toEqual({ name: 'Parcmotor Castelloli', country: 'Spain' });
    expect(reader.trackPreview('castelloli', '')).toBe(trackImg);
    expect(reader.trackInfo('ring', 'gp')).toEqual({ name: 'Nordschleife GP', country: null });
    expect(reader.trackPreview('ring', 'gp')).toBeNull();
  });

  it('lo que no existe devuelve null, sin fallar', () => {
    expect(reader.carInfo('nodata')).toBeNull();
    expect(reader.carPreview('nodata')).toBeNull();
    expect(reader.carInfo('noexiste')).toBeNull();
    expect(reader.trackInfo('noexiste', '')).toBeNull();
  });

  it('rechaza identificadores con rutas: nunca sale de content/cars y content/tracks', () => {
    for (const id of ['..', '../cars/porsche', 'a/b', 'a\\b', '']) {
      expect(reader.carInfo(id)).toBeNull();
      expect(reader.carPreview(id)).toBeNull();
      expect(reader.trackPreview(id, '')).toBeNull();
    }
    expect(reader.trackPreview('castelloli', '../..')).toBeNull();
  });

  it('names() devuelve solo lo conocido, con la clave circuito|layout', () => {
    expect(reader.names(['porsche', 'otro'], [{ track: 'castelloli', layout: '' }, { track: 'x', layout: '' }])).toEqual({
      cars: { porsche: { name: 'Porsche 992 GT3 RS', brand: 'Porsche' } },
      tracks: { 'castelloli|': { name: 'Parcmotor Castelloli', country: 'Spain' } },
    });
  });

  it('parseLooseJson tolera saltos de línea sueltos dentro de un texto', () => {
    expect(parseLooseJson('{"name": "Linea 1\nLinea 2"}')).toEqual({ name: 'Linea 1 Linea 2' });
    expect(parseLooseJson('no es json')).toBeNull();
  });
});

describe('fichas de coches y circuitos', () => {
  put('cars/gt3/ui/ui_car.json', JSON.stringify({ name: 'Porsche 911 GT3 R', brand: 'Porsche', year: 2016, class: 'race', tags: ['gt3', 'RWD', 'race'], specs: { bhp: '550bhp', torque: '600Nm', weight: '1300kg', topspeed: '290km/h', acceleration: '3.1s', pwratio: '-' } }));
  put('cars/gt3/data/drivetrain.ini', '[TRACTION]\r\nTYPE=RWD\r\n[GEARS]\r\nCOUNT=6 ; hacia delante\r\nGEAR_R=-3.1\r\n');
  put('cars/awdcar/ui/ui_car.json', JSON.stringify({ name: 'Audi RS3', tags: ['awd'], specs: {} }));
  put('tracks/monza/ui/ui_track.json', JSON.stringify({ name: 'Monza', country: 'Italia', city: 'Monza', length: '5793', pitboxes: '30', run: 'clockwise', geotags: ['45.62 N', '9.28 E'] }));
  put('tracks/nord/ui/gp/ui_track.json', JSON.stringify({ name: 'Nordschleife', length: '5.1 km' }));
  const r = createContentReader([root]);

  it('el coche trae potencia, par, peso, velocidad y aceleración; tracción y marchas de drivetrain.ini si está sin empaquetar', () => {
    expect(r.carCard('gt3')).toEqual({
      name: 'Porsche 911 GT3 R', subtitle: 'Porsche · 2016 · race',
      specs: { Potencia: '550 bhp', Par: '600 Nm', Peso: '1300 kg', 'Velocidad máxima': '290 km/h', '0-100 km/h': '3.1 s', Tracción: 'Trasera (RWD)', Marchas: '6' },
    });
  });

  it('sin drivetrain.ini la tracción sale de las etiquetas; los valores de relleno se descartan', () => {
    expect(r.carCard('awdcar')).toEqual({ name: 'Audi RS3', subtitle: null, specs: { Tracción: 'Total (AWD)' } });
    expect(r.carCard('porsche')!.specs).toEqual({}); // sin specs ni tags: ficha vacía, pero con nombre
    expect(r.carCard('noexiste')).toBeNull();
    expect(r.carCard('../etc')).toBeNull();
  });

  it('el circuito trae país, longitud en km, boxes y sentido; también por layout', () => {
    expect(r.trackCard('monza', '')).toEqual({ name: 'Monza', subtitle: 'Monza, Italia', specs: { País: 'Italia', Ciudad: 'Monza', Longitud: '5,79 km', Boxes: '30', Sentido: 'clockwise' }, geo: { lat: 45.62, lon: 9.28 } });
    expect(r.trackCard('nord', 'gp')!.specs).toEqual({ Longitud: '5,10 km' });
    expect(r.trackCard('nord', 'gp')!.geo).toBeNull();
    expect(r.trackCard('nada', '')).toBeNull();
  });

  it('formatos: unidades separadas, metros y kilómetros, y ini con comentarios', () => {
    expect(formatSpec('460bhp')).toBe('460 bhp');
    expect(formatSpec('N/A')).toBeNull();
    expect(formatSpec('0')).toBeNull();
    expect(formatSpec(30)).toBe('30');
    expect(formatTrackLength('5793')).toBe('5,79 km');
    expect(formatTrackLength('12.4km')).toBe('12,40 km');
    expect(formatTrackLength('mucho')).toBe('mucho');
    expect(parseDrivetrainIni('[GEARS]\nCOUNT=7\n[TRACTION]\nTYPE=awd')).toEqual({ traction: 'Total (AWD)', gears: 7 });
    expect(parseDrivetrainIni('')).toEqual({ traction: null, gears: null });
  });
});

describe('installed', () => {
  const inst = mkdtempSync(join(tmpdir(), 'howler-installed-'));
  afterAll(() => rmSync(inst, { recursive: true, force: true }));
  const put = (rel: string, json: unknown) => { mkdirSync(join(inst, rel, '..'), { recursive: true }); writeFileSync(join(inst, rel), JSON.stringify(json)); };
  it('lista coches y circuitos con cada layout, ordenados por nombre y sin repetir', () => {
    put('cars/zeta_car/ui/ui_car.json', { name: 'Zeta GT', brand: 'Zeta' });
    put('cars/alfa_car/ui/ui_car.json', { name: 'Alfa RS' });
    mkdirSync(join(inst, 'cars/sin_ui'), { recursive: true });
    put('tracks/monza/ui/ui_track.json', { name: 'Monza', country: 'Italia' });
    put('tracks/imola/ui/gp/ui_track.json', { name: 'Imola GP' });
    put('tracks/imola/ui/short/ui_track.json', { name: 'Imola corto' });
    const r = createContentReader([inst, inst]).installed();
    expect(r.cars.map((c) => c.id)).toEqual(['alfa_car', 'zeta_car']);
    expect(r.tracks.map((t) => `${t.track}|${t.layout}`)).toEqual(['imola|short', 'imola|gp', 'monza|']) // ordenados por nombre: «Imola corto» antes que «Imola GP»;
    expect(r.tracks.find((t) => t.track === 'monza')!.country).toBe('Italia');
  });
});
