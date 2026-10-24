import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentCardDto, ContentNamesDto, InstalledContentDto } from '@howler/shared';
import { cleanTrackId, folderKey, parseGeotags } from '@howler/shared';
import { SAFE_NAME } from './track-map';
import { carTyres, readCarDataFile, type CarTyre } from './car-data';

/**
 * Lee de la instalación de AC lo que sirve para enseñar coches y circuitos: nombre real, marca, país e imagen de
 * vista previa (la misma que ve Content Manager). Nunca sale de `content/cars` y `content/tracks`: los
 * identificadores se validan antes de tocar el disco.
 */

/** Los JSON de interfaz de AC a veces llevan saltos de línea sueltos dentro de los textos: se sustituyen por espacios. */
export function parseLooseJson(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/^﻿/, '');
  for (const candidate of [text, text.replace(/[\u0000-\u001f]+/g, ' ')]) {
    try {
      const v = JSON.parse(candidate) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch { /* se prueba la versión limpia */ }
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** Etiquetas de un `ui_*.json`: sin «#» delante, sin repetir (da igual mayúsculas) y sin pasarse de largo. */
const cleanTags = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Map<string, string>();
  for (const x of v) { const tg = String(x).trim().replace(/^#+/, '').trim(); if (tg && tg.length <= 40 && !seen.has(tg.toLowerCase())) seen.set(tg.toLowerCase(), tg); }
  return [...seen.values()].slice(0, 30);
};

/** «460bhp» → «460 bhp»; valores vacíos o de relleno («-», «N/A») se descartan. */
export function formatSpec(v: unknown): string | null {
  const t = typeof v === 'number' ? String(v) : str(v);
  if (!t || /^[-–—?]+$/.test(t) || /^n\/?a$/i.test(t) || /^0+([.,]0+)?\s*[a-z/%]*$/i.test(t)) return null;
  const m = /^(\d[\d.,]*)\s*([^\d\s.,].*)$/.exec(t);
  return m ? `${m[1]} ${m[2]}` : t;
}

/** Longitud de un circuito: los ui_track.json la dan en metros («5793»), pero algunos mods ponen «5.79 km». */
export function trackLengthKm(v: unknown): number | null {
  const t = typeof v === 'number' ? String(v) : str(v);
  const m = t && /^(\d+(?:[.,]\d+)?)\s*(km|kilometers|m|meters|metres)?$/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  if (!(n > 0)) return null;
  return /^k/i.test(m[2] ?? '') ? n : n >= 100 ? n / 1000 : n;
}

export function formatTrackLength(v: unknown): string | null {
  const t = typeof v === 'number' ? String(v) : str(v);
  if (!t) return null;
  const km = trackLengthKm(v);
  if (km === null) return /^\d+(?:[.,]\d+)?\s*(km|kilometers|m|meters|metres)?$/i.test(t) ? null : t;
  return `${km.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

const DRIVETRAINS: Record<string, string> = { rwd: 'Trasera (RWD)', fwd: 'Delantera (FWD)', awd: 'Total (AWD)', '4wd': 'Total (4WD)' };

/** Tracción y marchas de `drivetrain.ini` (suelto o dentro de `data.acd`, que se descifra con el nombre de la carpeta del coche). */
export function parseDrivetrainIni(text: string): { traction: string | null; gears: number | null } {
  let section = '';
  let traction: string | null = null;
  let gears: number | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.split(/[;]/)[0]!.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1]!.toUpperCase(); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.trim().toUpperCase(), val = kv[2]!.trim();
    if (section === 'TRACTION' && key === 'TYPE') traction = DRIVETRAINS[val.toLowerCase()] ?? null;
    if (section === 'GEARS' && key === 'COUNT') { const n = parseInt(val, 10); gears = n > 0 && n < 20 ? n : null; }
  }
  return { traction, gears };
}

export interface ContentReader {
  carInfo(id: string): { name: string; brand: string | null } | null;
  trackInfo(track: string, layout: string): { name: string; country: string | null } | null;
  /** Ficha para una tarjeta: nombre, marca/país y especificaciones (solo lo que el contenido instalado trae). */
  carCard(id: string): ContentCardDto | null;
  trackCard(track: string, layout: string): ContentCardDto | null;
  /** Skins de un coche (id de carpeta y nombre de `ui_skin.json` si lo tiene). */
  carSkins(id: string): { id: string; name: string }[];
  /** Compuestos de neumático del coche (de `tyres.ini`, suelto o dentro de `data.acd`). Vacío si no se pueden leer. */
  carTyres(id: string): CarTyre[];
  /** Imagen de una skin concreta. */
  skinPreview(id: string, skin: string): string | null;
  /** Ruta de la imagen de un coche (la primera skin que tenga preview.jpg). */
  carPreview(id: string): string | null;
  trackPreview(track: string, layout: string): string | null;
  /** Trazado del recorrido (`ui/outline.png`, línea blanca sobre transparente), para superponerlo a la foto. */
  trackOutline(track: string, layout: string): string | null;
  names(cars: string[], tracks: { track: string; layout: string }[]): ContentNamesDto;
  carMeta(id: string): { author: string | null; country: string | null; cls: string | null; year: string | null; drive: string | null; tags: string[] };
  trackMeta(track: string, layout: string): { author: string | null; lengthKm: number | null; city: string | null; pitboxes: number | null; tags: string[] };
  /** Todo lo instalado (coches y circuitos con cada layout), con su nombre. */
  installed(): InstalledContentDto;
}

/** `contentDirs`: carpetas `content` de AC (la instalación completa y la del servidor); gana la primera que lo tenga. */
export function createContentReader(contentDirs: string[]): ContentReader {
  // Solo se memorizan los JSON que se leyeron bien: así no se vuelve a leer el disco en cada petición de nombres.
  const jsonCache = new Map<string, Record<string, unknown>>();
  const readJson = (path: string) => {
    const hit = jsonCache.get(path);
    if (hit) return hit;
    try {
      const v = existsSync(path) ? parseLooseJson(readFileSync(path, 'utf8')) : null;
      if (v) jsonCache.set(path, v);
      return v;
    } catch { return null; }
  };
  const safe = (...parts: string[]) => parts.every((p) => SAFE_NAME.test(p));

  const carDir = (id: string) => (safe(id) && id ? contentDirs.map((d) => join(d, 'cars', id)).find((d) => existsSync(d)) ?? null : null);
  // Carpeta hija por nombre exacto o, si no, por nombre equivalente («Euphoria Hillside Park» ≈ euphoria_hillside_park).
  const listings = new Map<string, string[]>();
  const child = (parent: string, name: string): string | null => {
    if (existsSync(join(parent, name))) return name;
    let list = listings.get(parent);
    if (!list) { try { list = readdirSync(parent); } catch { list = []; } listings.set(parent, list); }
    const key = folderKey(name);
    return key ? list.find((n) => folderKey(n) === key) ?? null : null;
  };
  const trackUi = (rawTrack: string, rawLayout: string) => {
    const track = cleanTrackId(rawTrack);
    if (!track || !safe(track, rawLayout)) return null;
    for (const d of contentDirs) {
      const t = child(join(d, 'tracks'), track);
      if (!t) continue;
      const ui = join(d, 'tracks', t, 'ui');
      if (!rawLayout) { if (existsSync(ui)) return ui; continue; }
      const l = child(ui, rawLayout);
      if (l) return join(ui, l);
    }
    return null;
  };

  const reader: ContentReader = {
    carInfo(id) {
      const dir = carDir(id);
      const json = dir && readJson(join(dir, 'ui', 'ui_car.json'));
      const name = json && str(json.name);
      return name ? { name, brand: str(json.brand) } : null;
    },
    trackInfo(track, layout) {
      const dir = trackUi(track, layout);
      const json = dir && readJson(join(dir, 'ui_track.json'));
      const name = json && str(json.name);
      return name ? { name, country: str(json.country) } : null;
    },
    carMeta(id) {
      const dir = carDir(id);
      const json = dir && readJson(join(dir, 'ui', 'ui_car.json'));
      const tags = cleanTags(json && json.tags);
      const low = tags.map((x) => x.toLowerCase());
      const drive = low.includes('rwd') ? 'RWD' : low.includes('fwd') ? 'FWD' : low.includes('awd') || low.includes('4wd') ? 'AWD' : null;
      const year = json && (typeof json.year === 'number' || /^\d{4}$/.test(String(json.year ?? ''))) ? String(json.year) : null;
      return { author: json && str(json.author), country: json && str(json.country), cls: json && str(json.class), year, drive, tags: tags.filter((x) => !['rwd', 'fwd', 'awd', '4wd'].includes(x.toLowerCase())) };
    },
    trackMeta(track, layout) {
      const dir = trackUi(track, layout);
      const json = dir && readJson(join(dir, 'ui_track.json'));
      const boxes = json ? Number(/^\d+/.exec(String(json.pitboxes ?? ''))?.[0]) : NaN;
      return { author: json && str(json.author), lengthKm: json ? trackLengthKm(json.length) : null, city: json && str(json.city), pitboxes: Number.isFinite(boxes) && boxes > 0 ? boxes : null, tags: cleanTags(json && json.tags) };
    },
    carCard(id) {
      const dir = carDir(id);
      const json = dir && readJson(join(dir, 'ui', 'ui_car.json'));
      const name = json && str(json.name);
      if (!dir || !json || !name) return null;
      const specs: Record<string, string> = {};
      const raw = (json.specs && typeof json.specs === 'object' ? json.specs : {}) as Record<string, unknown>;
      for (const [label, key] of [['Potencia', 'bhp'], ['Par', 'torque'], ['Peso', 'weight'], ['Velocidad máxima', 'topspeed'], ['0-100 km/h', 'acceleration'], ['Peso/potencia', 'pwratio']] as const) {
        const v = formatSpec(raw[key]);
        if (v) specs[label] = v;
      }
      const tags = Array.isArray(json.tags) ? json.tags.map((t) => String(t).toLowerCase()) : [];
      let traction = Object.keys(DRIVETRAINS).filter((k) => tags.includes(k)).map((k) => DRIVETRAINS[k]!)[0] ?? null;
      let gears: number | null = null;
      const ini = readCarDataFile(dir, 'drivetrain.ini');
      if (ini) { const d = parseDrivetrainIni(ini); traction = d.traction ?? traction; gears = d.gears; }
      if (traction) specs['Tracción'] = traction;
      if (gears) specs['Marchas'] = String(gears);
      const year = typeof json.year === 'number' || /^\d{4}$/.test(String(json.year ?? '')) ? String(json.year) : null;
      return { name, subtitle: [str(json.brand), year, str(json.class)].filter(Boolean).join(' · ') || null, specs };
    },
    trackCard(track, layout) {
      const dir = trackUi(track, layout);
      const json = dir && readJson(join(dir, 'ui_track.json'));
      const name = json && str(json.name);
      if (!json || !name) return null;
      const specs: Record<string, string> = {};
      const set = (label: string, v: string | null) => { if (v) specs[label] = v; };
      set('País', str(json.country));
      set('Ciudad', str(json.city));
      set('Longitud', formatTrackLength(json.length));
      set('Boxes', formatSpec(json.pitboxes));
      set('Sentido', str(json.run));
      return { name, subtitle: [str(json.city), str(json.country)].filter(Boolean).join(', ') || null, specs, geo: parseGeotags(json.geotags) };
    },
    carTyres(id) {
      const dir = carDir(id);
      return dir ? carTyres(dir) : [];
    },
    carSkins(id) {
      const dir = carDir(id);
      if (!dir) return [];
      try {
        return readdirSync(join(dir, 'skins'), { withFileTypes: true })
          .filter((e) => e.isDirectory() && safe(e.name))
          .map((e) => ({ id: e.name, name: str(readJson(join(dir, 'skins', e.name, 'ui_skin.json'))?.skinname) ?? e.name }))
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch { return []; }
    },
    skinPreview(id, skin) {
      const dir = carDir(id);
      const p = dir && safe(skin) && skin ? join(dir, 'skins', skin, 'preview.jpg') : null;
      return p && existsSync(p) ? p : null;
    },
    carPreview(id) {
      const dir = carDir(id);
      if (!dir) return null;
      try {
        const skins = readdirSync(join(dir, 'skins')).sort();
        for (const skin of skins) {
          const p = join(dir, 'skins', skin, 'preview.jpg');
          if (existsSync(p)) return p;
        }
      } catch { /* sin skins */ }
      return null;
    },
    trackPreview(track, layout) {
      const dir = trackUi(track, layout);
      const p = dir && join(dir, 'preview.png');
      return p && existsSync(p) ? p : null;
    },
    trackOutline(track, layout) {
      const dir = trackUi(track, layout);
      const p = dir && join(dir, 'outline.png');
      return p && existsSync(p) ? p : null;
    },
    installed() {
      const cars = new Map<string, InstalledContentDto['cars'][number]>();
      const tracks = new Map<string, InstalledContentDto['tracks'][number]>();
      const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
      for (const root of contentDirs) {
        for (const id of dirs(join(root, 'cars'))) {
          if (cars.has(id) || !safe(id)) continue;
          const info = reader.carInfo(id);
          if (info) cars.set(id, { id, ...info, ...reader.carMeta(id) });
        }
        for (const track of dirs(join(root, 'tracks'))) {
          if (!safe(track)) continue;
          // Con layouts, cada uno tiene su carpeta dentro de ui/; sin layouts, ui_track.json está directamente en ui/
          const layouts = ['', ...dirs(join(root, 'tracks', track, 'ui')).filter((l) => safe(l))];
          for (const layout of layouts) {
            const key = `${track}|${layout}`;
            if (tracks.has(key)) continue;
            const info = reader.trackInfo(track, layout);
            if (info) tracks.set(key, { track, layout, ...info, ...reader.trackMeta(track, layout) });
          }
        }
      }
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es');
      return { cars: [...cars.values()].sort(byName), tracks: [...tracks.values()].sort(byName) };
    },
    names(cars, tracks) {
      const out: ContentNamesDto = { cars: {}, tracks: {} };
      for (const id of cars) {
        const info = reader.carInfo(id);
        if (info) out.cars[id] = info;
      }
      for (const t of tracks) {
        const info = reader.trackInfo(t.track, t.layout);
        if (info) out.tracks[`${t.track}|${t.layout}`] = info;
      }
      return out;
    },
  };
  return reader;
}
