import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SAFE_NAME } from '../core/track-map';
import { serverCfgPath } from './server-config';

/**
 * Lista de coches del servidor (`entry_list.ini` del preset): lo que Content Manager llama «Entry list». Una entrada por
 * hueco (plaza); varios huecos pueden ser del mismo coche. Se conservan las claves que no conocemos (AssettoServer admite
 * extras como `AI=fixed`), el BOM y los saltos de línea de Content Manager, y se guarda copia `.howler-prev`.
 * Al guardar se mantienen coherentes `CARS` y `MAX_CLIENTS` del `server_cfg.ini`, como hace CM.
 */

export interface EntrySlot {
  model: string;
  skin: string;
  driverName: string;
  team: string;
  /** SteamID64 reservados para este hueco (varios separados por `;`); vacío = abierto a cualquiera. */
  guid: string;
  /** Lastre en kg. */
  ballast: number;
  /** Restrictor en %. */
  restrictor: number;
  fixedSetup: string;
  /** Hueco de espectador. */
  spectator: boolean;
  /** Claves desconocidas, tal cual venían. */
  extras: [string, string][];
}

export interface EntryListState { slots: EntrySlot[]; maxClients: number | null; track: string; layout: string }

/**
 * `TRACK` y `CONFIG_TRACK` del preset → circuito y layout reales. Content Manager escribe rutas CSP tipo
 * «csp/3465/../D/../leroy_gandia» (versión de CSP, layout y circuito); solo el último tramo es la carpeta del circuito.
 * El layout sale de `CONFIG_TRACK` y, si está vacío, del tramo intermedio.
 */
export function parseServerTrack(trackRaw: string, configTrack: string): { track: string; layout: string } {
  const parts = trackRaw.split('/').map((p) => p.trim()).filter((p) => p && p !== '..');
  const isCsp = /^csp$/i.test(parts[0] ?? '');
  const rest = isCsp ? parts.slice(1).filter((p) => !/^\d+$/.test(p)) : parts;
  const track = rest.at(-1) ?? trackRaw;
  const layout = configTrack.trim() || (isCsp && rest.length > 1 ? rest[0]! : '');
  return { track, layout };
}

/** Cambia el circuito del preset (`TRACK` y `CONFIG_TRACK`) conservando el formato CSP si el archivo ya lo usaba. */
export function saveServerTrack(serverDir: string, preset: string, track: string, layout: string): void {
  if (!SAFE_NAME.test(track) || !track || !SAFE_NAME.test(layout)) throw new Error('Circuito no válido.');
  const cfg = serverCfgPath(serverDir, preset);
  if (!existsSync(cfg)) throw new Error(`No existe ${cfg}.`);
  const text = readFileSync(cfg, 'utf8');
  const csp = /^TRACK\s*=\s*csp\/(\d+)\/\.\./im.exec(text);
  const value = csp ? `csp/${csp[1]}/../${layout ? `${layout}/../` : ''}${track}` : track;
  let next = setServerCfgKey(text, 'TRACK', value);
  next = setServerCfgKey(next, 'CONFIG_TRACK', layout);
  if (next !== text) { copyFileSync(cfg, `${cfg}.howler-prev`); writeFileSync(cfg, next); }
}

const KNOWN = new Set(['MODEL', 'SKIN', 'SPECTATOR_MODE', 'DRIVERNAME', 'TEAM', 'GUID', 'BALLAST', 'RESTRICTOR', 'FIXED_SETUP']);
const NO_BREAKS = /^[^\r\n]{0,60}$/;
const GUID = /^(\d{17}(;\d{17})*)?$/;
export const MAX_SLOTS = 100;

export function entryListPath(serverDir: string, preset: string): string {
  return join(dirname(serverCfgPath(serverDir, preset)), 'entry_list.ini');
}

export function parseEntryList(text: string): EntrySlot[] {
  const slots: EntrySlot[] = [];
  let cur: EntrySlot | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[CAR_\d+\]$/i.test(line)) {
      cur = { model: '', skin: '', driverName: '', team: '', guid: '', ballast: 0, restrictor: 0, fixedSetup: '', spectator: false, extras: [] };
      slots.push(cur);
      continue;
    }
    const kv = /^([^=;#]+)=(.*)$/.exec(line);
    if (!cur || !kv) continue;
    const key = kv[1]!.trim().toUpperCase(), val = kv[2]!.trim();
    switch (key) {
      case 'MODEL': cur.model = val; break;
      case 'SKIN': cur.skin = val; break;
      case 'DRIVERNAME': cur.driverName = val; break;
      case 'TEAM': cur.team = val; break;
      case 'GUID': cur.guid = val; break;
      case 'BALLAST': cur.ballast = Number(val) || 0; break;
      case 'RESTRICTOR': cur.restrictor = Number(val) || 0; break;
      case 'FIXED_SETUP': cur.fixedSetup = val; break;
      case 'SPECTATOR_MODE': cur.spectator = val === '1'; break;
      default: if (!KNOWN.has(key)) cur.extras.push([kv[1]!.trim(), val]);
    }
  }
  return slots;
}

export function serializeEntryList(slots: EntrySlot[], eol = '\r\n', bom = true): string {
  const out: string[] = [];
  slots.forEach((s, i) => {
    out.push(`[CAR_${i}]`, `MODEL=${s.model}`, `SKIN=${s.skin}`, `SPECTATOR_MODE=${s.spectator ? 1 : 0}`, `DRIVERNAME=${s.driverName}`, `TEAM=${s.team}`, `GUID=${s.guid}`, `BALLAST=${s.ballast}`, `RESTRICTOR=${s.restrictor}`);
    if (s.fixedSetup) out.push(`FIXED_SETUP=${s.fixedSetup}`);
    for (const [k, v] of s.extras) out.push(`${k}=${v}`);
    out.push('');
  });
  return (bom ? '﻿' : '') + out.join(eol) + eol;
}

/** Valida los huecos que llegan del panel; devuelve el primer problema o null. */
export function validateSlots(slots: EntrySlot[]): string | null {
  if (slots.length === 0) return 'Hace falta al menos un coche.';
  if (slots.length > MAX_SLOTS) return `Como mucho ${MAX_SLOTS} huecos.`;
  for (const [i, s] of slots.entries()) {
    const n = i + 1;
    if (!s.model || !SAFE_NAME.test(s.model)) return `Hueco ${n}: coche no válido.`;
    if (s.skin && !SAFE_NAME.test(s.skin)) return `Hueco ${n}: skin no válida.`;
    if (!NO_BREAKS.test(s.driverName) || !NO_BREAKS.test(s.team)) return `Hueco ${n}: el nombre o el equipo son demasiado largos o llevan saltos de línea.`;
    if (!GUID.test(s.guid)) return `Hueco ${n}: el Steam ID debe tener 17 cifras (varios, separados por «;»).`;
    if (!Number.isInteger(s.ballast) || s.ballast < 0 || s.ballast > 500) return `Hueco ${n}: el lastre va de 0 a 500 kg.`;
    if (!Number.isInteger(s.restrictor) || s.restrictor < 0 || s.restrictor > 400) return `Hueco ${n}: el restrictor va de 0 a 400 %.`;
    if (s.extras.some(([k, v]) => !/^[A-Za-z0-9_]{1,40}$/.test(k) || /[\r\n]/.test(v))) return `Hueco ${n}: hay una opción extra no válida.`;
    if (s.fixedSetup && (!/^[\w .()-]{1,80}(\.ini)?$/.test(s.fixedSetup))) return `Hueco ${n}: el setup fijo no es válido.`;
  }
  return null;
}

export function readEntryList(serverDir: string, preset: string): EntryListState {
  const file = entryListPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const cfg = serverCfgPath(serverDir, preset);
  const text = existsSync(cfg) ? readFileSync(cfg, 'utf8') : '';
  const m = /^MAX_CLIENTS\s*=\s*(\d+)/m.exec(text);
  const key = (k: string) => new RegExp(String.raw`^${k}[ \t]*=[ \t]*([^\r\n]*?)[ \t]*\r?$`, 'm').exec(text)?.[1] ?? '';
  return { slots: parseEntryList(readFileSync(file, 'utf8')), maxClients: m ? Number(m[1]) : null, ...parseServerTrack(key('TRACK'), key('CONFIG_TRACK')) };
}

/** Cambia (o añade) una clave de la sección [SERVER] conservando el resto del archivo. */
export function setServerCfgKey(text: string, key: string, value: string): string {
  const re = new RegExp(String.raw`^(${key}[ \t]*=)[^\r\n]*`, 'm');
  if (re.test(text)) return text.replace(re, `$1${value}`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text.replace(/^(\uFEFF?\[SERVER\][^\n]*\n)/m, `$1${key}=${value}${eol}`);
}

/** Guarda la lista y deja `CARS` y `MAX_CLIENTS` coherentes. Devuelve la lista guardada. */
export function saveEntryList(serverDir: string, preset: string, slots: EntrySlot[]): EntryListState {
  const problem = validateSlots(slots);
  if (problem) throw new Error(problem);
  const file = entryListPath(serverDir, preset);
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const prevSlots = old ? parseEntryList(old).length : 0;
  if (old) copyFileSync(file, `${file}.howler-prev`);
  writeFileSync(file, serializeEntryList(slots, old.includes('\n') && !old.includes('\r\n') ? '\n' : '\r\n', old === '' || old.startsWith('﻿')));

  const cfg = serverCfgPath(serverDir, preset);
  if (existsSync(cfg)) {
    const text = readFileSync(cfg, 'utf8');
    const cars = [...new Set(slots.map((s) => s.model))].join(';');
    const m = /^MAX_CLIENTS\s*=\s*(\d+)/m.exec(text);
    const prev = m ? Number(m[1]) : null;
    // Como CM: si todas las plazas estaban abiertas se siguen abriendo todas; si había menos clientes que plazas, se respeta (sin pasar de las plazas).
    const max = prev == null || prev >= prevSlots ? slots.length : Math.min(prev, slots.length);
    let next = setServerCfgKey(text, 'CARS', cars);
    next = setServerCfgKey(next, 'MAX_CLIENTS', String(max));
    if (next !== text) { copyFileSync(cfg, `${cfg}.howler-prev`); writeFileSync(cfg, next); }
  }
  return readEntryList(serverDir, preset);
}
