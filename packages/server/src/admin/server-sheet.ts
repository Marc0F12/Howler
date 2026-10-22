import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanBbcode, sheetProblems, type ServerSheetDto } from '@howler/shared';
import { serverCfgPath } from './server-config';

/**
 * Ficha del servidor: el título (`NAME` de [SERVER] en el server_cfg.ini del preset) y la descripción
 * (`ServerDescription` del extra_cfg.yml) que Content Manager enseña al elegir el servidor. Se conservan saltos de línea y BOM, y se guarda `.howler-prev` de cada archivo tocado.
 */

// ---- server_cfg.ini: NAME de [SERVER] (las demás secciones también tienen NAME) ----

/** Rango [inicio, fin) de las líneas de la sección [SERVER]; null si no existe. */
function serverSection(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => /^﻿?\[SERVER\]\s*$/i.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  return [start, end];
}

export function readTitleText(ini: string): string {
  const lines = ini.split(/\r?\n/);
  const sec = serverSection(lines);
  if (!sec) return '';
  for (let i = sec[0] + 1; i < sec[1]; i++) { const m = /^NAME=(.*)$/.exec(lines[i]!); if (m) return m[1]!.trim(); }
  return '';
}

export function setTitleText(ini: string, title: string): string {
  if (/[\r\n]/.test(title)) throw new Error('El título tiene que ir en una sola línea.');
  const eol = ini.includes('\r\n') ? '\r\n' : '\n';
  const lines = ini.split(/\r?\n/);
  const sec = serverSection(lines);
  if (!sec) throw new Error('El server_cfg.ini no tiene la sección [SERVER].');
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    if (/^NAME=/.test(lines[i]!)) { lines[i] = `NAME=${title}`; return lines.join(eol); }
  }
  lines.splice(sec[0] + 1, 0, `NAME=${title}`);
  return lines.join(eol);
}

/** Valor de una clave dentro de una sección del server_cfg.ini (null si no existe la sección o la clave). */
function sectionValue(lines: string[], section: string, key: string): string | null {
  const start = lines.findIndex((l) => new RegExp(String.raw`^﻿?\[${section}\]\s*$`, 'i').test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]!); i++) {
    const m = new RegExp(String.raw`^${key}=(.*)$`).exec(lines[i]!);
    if (m) return m[1]!.trim();
  }
  return null;
}

/** Sesiones del preset (las que existen en el archivo) y si el servidor tiene contraseña. */
export function readSessionsText(ini: string): Pick<ServerSheetDto, 'sessions' | 'hasPassword'> {
  const lines = ini.split(/\r?\n/);
  const sessions: ServerSheetDto['sessions'] = [];
  for (const [kind, name] of [['practice', 'PRACTICE'], ['qualify', 'QUALIFY'], ['race', 'RACE']] as const) {
    const time = sectionValue(lines, name, 'TIME');
    if (time === null && sectionValue(lines, name, 'LAPS') === null) continue;
    sessions.push({ kind, minutes: Number(time) || 0, laps: kind === 'race' ? Number(sectionValue(lines, name, 'LAPS')) || 0 : 0 });
  }
  return { sessions, hasPassword: (sectionValue(lines, 'SERVER', 'PASSWORD') ?? '') !== '' };
}

// ---- extra_cfg.yml: ServerDescription y EnableServerDetails ----

/** Líneas que ocupa el valor de una clave de primer nivel: la suya y las siguientes con sangría (o vacías entre medias). */
function keyRange(lines: string[], key: string): [number, number] | null {
  const head = lines.findIndex((l) => new RegExp(String.raw`^${key}:`).test(l));
  if (head < 0) return null;
  let end = head + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]!) || lines[end]!.trim() === '')) end++;
  // Las líneas vacías del final pertenecen al siguiente bloque, no a este valor.
  while (end > head + 1 && lines[end - 1]!.trim() === '') end--;
  return [head, end];
}

/** Valor de `ServerDescription` en un extra_cfg.yml (texto plano, entre comillas simples o dobles, o bloque `|` / `>`). */
export function readDescriptionText(extra: string): string {
  const lines = extra.replace(/^﻿/, '').split(/\r?\n/);
  const r = keyRange(lines, 'ServerDescription');
  if (!r) return '';
  const first = lines[r[0]]!.replace(/^ServerDescription:\s*/, '').replace(/\s+#.*$/, '');
  const rest = lines.slice(r[0] + 1, r[1]);
  const block = /^([|>])[+-]?\d*$/.exec(first.trim());
  if (block) {
    const indent = Math.min(...rest.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length), Infinity);
    const body = rest.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
    return (block[1] === '|' ? body.join('\n') : body.join(' ')).replace(/\n+$/, '');
  }
  const joined = [first, ...rest.map((l) => l.trim())].join(' ').trim();
  if (joined.startsWith('"')) { try { return JSON.parse(joined) as string; } catch { return joined.slice(1, -1); } }
  if (joined.startsWith("'") && joined.endsWith("'") && joined.length >= 2) return joined.slice(1, -1).replace(/''/g, "'");
  return joined;
}

/** Escribe `ServerDescription` como texto entre comillas dobles (JSON es YAML válido: \n, \" y \\ se entienden). */
export function setDescriptionText(extra: string, description: string): string {
  const eol = extra.includes('\r\n') ? '\r\n' : '\n';
  const line = `ServerDescription: ${JSON.stringify(description)}`;
  const lines = extra.split(/\r?\n/);
  const r = keyRange(lines, 'ServerDescription');
  if (r) { lines.splice(r[0], r[1] - r[0], line); return lines.join(eol); }
  return `${extra}${extra === '' || extra.endsWith('\n') ? '' : eol}${line}${eol}`;
}

export function detailsEnabledText(extra: string): boolean {
  const m = /^EnableServerDetails:\s*(true|false)\b/m.exec(extra);
  return m ? m[1] === 'true' : true;
}

export function setDetailsEnabledText(extra: string, on: boolean): string {
  if (/^EnableServerDetails:\s*\S+/m.test(extra)) return extra.replace(/^(EnableServerDetails:\s*)\S+/m, `$1${on}`);
  const eol = extra.includes('\r\n') ? '\r\n' : '\n';
  return `${extra}${extra === '' || extra.endsWith('\n') ? '' : eol}EnableServerDetails: ${on}${eol}`;
}

function paths(serverDir: string, preset: string) {
  const cfg = serverCfgPath(serverDir, preset);
  return { cfg, extra: join(dirname(cfg), 'extra_cfg.yml') };
}

export function readServerSheet(serverDir: string, preset: string): ServerSheetDto {
  const p = paths(serverDir, preset);
  if (!existsSync(p.cfg)) throw new Error(`No existe ${p.cfg}.`);
  const extra = existsSync(p.extra) ? readFileSync(p.extra, 'utf8') : '';
  const ini = readFileSync(p.cfg, 'utf8');
  return { title: readTitleText(ini), ...readSessionsText(ini), description: readDescriptionText(extra), detailsEnabled: detailsEnabledText(extra), missing: existsSync(p.extra) ? null : p.extra };
}

/** Guarda título y descripción (limpiando el BBCode). Valida antes de escribir; enciende EnableServerDetails (sin él CM no enseña la descripción). */
export function saveServerSheet(serverDir: string, preset: string, title: string, description: string): ServerSheetDto {
  const p = paths(serverDir, preset);
  if (!existsSync(p.cfg)) throw new Error(`No existe ${p.cfg}.`);
  if (!existsSync(p.extra)) throw new Error(`No existe ${p.extra}.`);
  const clean = cleanBbcode(description);
  const problems = sheetProblems(title, clean);
  if (problems.length) throw new Error(problems[0]);
  const ini = readFileSync(p.cfg, 'utf8');
  const extra = readFileSync(p.extra, 'utf8');
  const nextIni = setTitleText(ini, title.trim());
  const nextExtra = setDetailsEnabledText(setDescriptionText(extra, clean), true);
  if (nextIni !== ini) { copyFileSync(p.cfg, `${p.cfg}.howler-prev`); writeFileSync(p.cfg, nextIni); }
  if (nextExtra !== extra) { copyFileSync(p.extra, `${p.extra}.howler-prev`); writeFileSync(p.extra, nextExtra); }
  return readServerSheet(serverDir, preset);
}
