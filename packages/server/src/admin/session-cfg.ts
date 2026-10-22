import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SESSIONS, SESSION_IDS, SESSION_SECTION, SETTINGS, SETTINGS_BY_ID, validateSessions, validateSetting,
  type SessionId, type SessionPanelDto, type SessionPlan, type SessionsPlan, type SettingSpec, type SettingValue,
} from '@howler/shared';
import { serverCfgPath } from './server-config';

/**
 * Lectura y escritura del panel de sesión: casi todos los ajustes del `server_cfg.ini` del preset (y unos pocos del
 * `extra_cfg.yml`). Solo se toca lo que se cambia; se conservan saltos de línea, la marca BOM y todas las claves
 * desconocidas. Content Manager «apaga» una sección o una clave renombrándola a `__CM_<NOMBRE>_OFF`; aquí se hace igual.
 */

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const lines = (text: string) => text.split(/\r?\n/);

type SectionState = 'on' | 'off' | 'none';
interface Range { start: number; end: number }

const header = (name: string) => new RegExp(String.raw`^﻿?\[${name}\]\s*$`);

function findSection(ls: string[], name: string): Range | null {
  const re = header(name);
  const start = ls.findIndex((l) => re.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < ls.length && !/^﻿?\[.*\]\s*$/.test(ls[end]!)) end++;
  return { start, end };
}

const offName = (name: string) => `__CM_${name}_OFF`;

/** Sección encendida, apagada (`__CM_X_OFF`) o inexistente. */
function stateOf(ls: string[], name: string): SectionState {
  return findSection(ls, name) ? 'on' : findSection(ls, offName(name)) ? 'off' : 'none';
}

/** Rango de la sección donde viven los valores: la encendida y, si no, la apagada. */
const valuesRange = (ls: string[], name: string): Range | null => findSection(ls, name) ?? findSection(ls, offName(name));

function getKey(ls: string[], name: string, key: string): string | null {
  const r = valuesRange(ls, name);
  if (!r) return null;
  const re = new RegExp(String.raw`^${key}=(.*)$`);
  for (let i = r.start + 1; i < r.end; i++) { const m = re.exec(ls[i]!.trimEnd()); if (m) return m[1]!.trim(); }
  return null;
}

/** Clave apagada por Content Manager (`__CM_CLAVE_OFF=valor`): devuelve su valor. */
function getOffKey(ls: string[], name: string, key: string): string | null {
  return getKey(ls, name, offName(key));
}

/** Escribe una clave en la sección (creándola al final del archivo si no existe ni encendida ni apagada). */
function setKey(ls: string[], name: string, key: string, value: string): void {
  let r = valuesRange(ls, name);
  if (!r) {
    while (ls.length > 0 && ls[ls.length - 1]!.trim() === '') ls.pop();
    ls.push('', `[${name}]`, '');
    r = { start: ls.length - 2, end: ls.length };
  }
  const re = new RegExp(String.raw`^${key}=`);
  for (let i = r.start + 1; i < r.end; i++) if (re.test(ls[i]!)) { ls[i] = `${key}=${value}`; return; }
  ls.splice(r.start + 1, 0, `${key}=${value}`);
}

/** Apaga (renombra a `__CM_CLAVE_OFF`) o enciende una clave sin perder su valor. */
function toggleKey(ls: string[], name: string, key: string, on: boolean): void {
  const r = valuesRange(ls, name);
  if (!r) return;
  const from = new RegExp(String.raw`^${on ? offName(key) : key}=(.*)$`);
  const to = new RegExp(String.raw`^${on ? key : offName(key)}=`);
  for (let i = r.start + 1; i < r.end; i++) {
    const m = from.exec(ls[i]!);
    if (!m) continue;
    // Content Manager puede dejar las dos a la vez (TIME=0 y __CM_TIME_OFF=10): renombrar duplicaría la clave y AssettoServer no leería el archivo.
    const dup = ls.findIndex((l, j) => j > r.start && j < r.end && j !== i && to.test(l));
    if (dup >= 0) {
      if (!on) ls[dup] = `${offName(key)}=${m[1]}`; // al apagar, la copia apagada se queda con el valor más reciente
      ls.splice(i, 1);
    } else ls[i] = `${on ? key : offName(key)}=${m[1]}`;
    return;
  }
}

/** Enciende o apaga una sección entera. Si se enciende una que no existe, se crea vacía. */
function setSectionOn(ls: string[], name: string, on: boolean): void {
  const state = stateOf(ls, name);
  if (state === (on ? 'on' : 'off')) return;
  if (state === 'none') {
    if (!on) return;
    while (ls.length > 0 && ls[ls.length - 1]!.trim() === '') ls.pop();
    ls.push('', `[${name}]`, '');
    return;
  }
  const r = findSection(ls, on ? offName(name) : name)!;
  const bom = /^﻿/.test(ls[r.start]!) ? '﻿' : '';
  ls[r.start] = `${bom}[${on ? name : offName(name)}]`;
}

// ---- Valores ----

function parseValue(spec: SettingSpec, raw: string | null): SettingValue {
  if (raw === null || raw === '') return spec.def;
  switch (spec.kind) {
    case 'bool': return raw === '1' || raw.toLowerCase() === 'true';
    case 'text': return raw;
    default: { const n = Number(raw); return Number.isFinite(n) ? n : spec.def; }
  }
}

const iniText = (spec: SettingSpec, v: SettingValue): string => (spec.kind === 'bool' ? (v ? '1' : '0') : String(v));

/** Valor de una clave de primer nivel del `extra_cfg.yml` (`Clave: valor  # comentario`). */
function getYaml(text: string, key: string): string | null {
  const m = new RegExp(String.raw`^${key}:[ \t]*([^\r\n#]*?)[ \t]*(?:#.*)?$`, 'm').exec(text);
  return m ? m[1]!.replace(/^["']|["']$/g, '') : null;
}

function setYaml(text: string, key: string, value: string): string {
  const re = new RegExp(String.raw`^(${key}:[ \t]*)[^\r\n#]*?([ \t]*(?:#.*)?)$`, 'm');
  if (re.test(text)) return text.replace(re, (_m, a: string, b: string) => `${a}${value}${b}`);
  const eol = eolOf(text);
  return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${key}: ${value}${eol}`;
}

// ---- Sesiones ----

function readPlan(ls: string[], id: SessionId): SessionPlan {
  const name = SESSION_SECTION[id];
  const base = DEFAULT_SESSIONS[id];
  const state = stateOf(ls, name);
  const num = (k: string): number | null => { const v = getKey(ls, name, k) ?? getOffKey(ls, name, k); return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  const time = getKey(ls, name, 'TIME'), laps = getKey(ls, name, 'LAPS');
  const lapsN = laps !== null ? Number(laps) : 0;
  // Carrera por vueltas: hay vueltas y no hay un TIME activo (CM lo apaga como __CM_TIME_OFF).
  const mode: 'time' | 'laps' = id === 'race' && lapsN > 0 && (time === null || Number(time) === 0) ? 'laps' : 'time';
  return {
    enabled: state === 'on',
    mode,
    minutes: num('TIME') ?? base.minutes,
    laps: num('LAPS') ?? base.laps,
    isOpen: num('IS_OPEN') ?? base.isOpen,
    waitSeconds: id === 'race' ? num('WAIT_TIME') ?? base.waitSeconds : 0,
  };
}

function applyPlan(ls: string[], id: SessionId, p: SessionPlan): void {
  const name = SESSION_SECTION[id];
  setSectionOn(ls, name, p.enabled);
  if (stateOf(ls, name) === 'none') return; // apagada y sin sección: nada que guardar
  if (!getKey(ls, name, 'NAME')) setKey(ls, name, 'NAME', name.charAt(0) + name.slice(1).toLowerCase());
  setKey(ls, name, 'IS_OPEN', String(p.isOpen));
  if (id === 'race') {
    setKey(ls, name, 'WAIT_TIME', String(p.waitSeconds));
    if (p.mode === 'laps') {
      setKey(ls, name, 'LAPS', String(p.laps));
      toggleKey(ls, name, 'TIME', false);
    } else {
      setKey(ls, name, 'TIME', String(p.minutes));
      toggleKey(ls, name, 'LAPS', false);
    }
  } else {
    setKey(ls, name, 'TIME', String(p.minutes));
  }
}

// ---- API ----

const extraPath = (serverDir: string, preset: string) => join(dirname(serverCfgPath(serverDir, preset)), 'extra_cfg.yml');

export function readSessionPanel(serverDir: string, preset: string): SessionPanelDto {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const ls = lines(readFileSync(file, 'utf8'));
  const extraFile = extraPath(serverDir, preset);
  const extra = existsSync(extraFile) ? readFileSync(extraFile, 'utf8') : null;
  const values: Record<string, SettingValue> = {};
  for (const spec of SETTINGS) {
    if (spec.file === 'extra') values[spec.id] = extra === null ? spec.def : parseValue(spec, getYaml(extra, spec.key));
    else if (spec.key === '#section') values[spec.id] = stateOf(ls, spec.section) === 'on';
    else values[spec.id] = parseValue(spec, getKey(ls, spec.section, spec.key));
  }
  const sessions = Object.fromEntries(SESSION_IDS.map((id) => [id, readPlan(ls, id)])) as SessionsPlan;
  return { values, sessions, extraMissing: extra === null };
}

export interface SessionPanelPatch { values?: Record<string, unknown>; sessions?: unknown }

/** Valida TODO antes de escribir. Guarda copias `.howler-prev` y devuelve lo que queda escrito. */
export function writeSessionPanel(serverDir: string, preset: string, patch: SessionPanelPatch): SessionPanelDto {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const checked: [SettingSpec, SettingValue][] = [];
  for (const [id, v] of Object.entries(patch.values ?? {})) {
    const spec = SETTINGS_BY_ID.get(id);
    if (!spec) throw new Error(`Ajuste desconocido: ${id}.`);
    checked.push([spec, validateSetting(spec, v)]);
  }
  const plan = patch.sessions === undefined ? null : validateSessions(patch.sessions);

  const text = readFileSync(file, 'utf8');
  const eol = eolOf(text);
  const ls = lines(text);
  let extra: string | null = null;
  const extraFile = extraPath(serverDir, preset);
  if (checked.some(([s]) => s.file === 'extra')) {
    if (!existsSync(extraFile)) throw new Error(`No existe ${extraFile}.`);
    extra = readFileSync(extraFile, 'utf8');
  }
  for (const [spec, v] of checked) {
    if (spec.file === 'extra') extra = setYaml(extra!, spec.key, String(v));
    else if (spec.key === '#section') setSectionOn(ls, spec.section, v === true);
    else setKey(ls, spec.section, spec.key, iniText(spec, v));
  }
  if (plan) for (const id of SESSION_IDS) applyPlan(ls, id, plan[id]);

  const next = ls.join(eol);
  if (next !== text) { copyFileSync(file, `${file}.howler-prev`); writeFileSync(file, next); }
  if (extra !== null && extra !== readFileSync(extraFile, 'utf8')) { copyFileSync(extraFile, `${extraFile}.howler-prev`); writeFileSync(extraFile, extra); }
  return readSessionPanel(serverDir, preset);
}
