import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { serverCfgPath } from './server-config';

/**
 * Contraseña para entrar al servidor: la clave `PASSWORD` de la sección [SERVER] del server_cfg.ini del preset (vacía = sin contraseña).
 * Se conservan saltos de línea y BOM, y se guarda `.howler-prev`. El servidor la lee al arrancar.
 */

export const MAX_PASSWORD = 64;

/** Rango [inicio, fin) de las líneas de la sección [SERVER]; null si no existe. */
function serverSection(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => /^﻿?\[SERVER\]\s*$/i.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  return [start, end];
}

export function readPasswordText(ini: string): string {
  const lines = ini.split(/\r?\n/);
  const sec = serverSection(lines);
  if (!sec) return '';
  for (let i = sec[0] + 1; i < sec[1]; i++) { const m = /^PASSWORD=(.*)$/.exec(lines[i]!); if (m) return m[1]!.trim(); }
  return '';
}

/** Mensaje de por qué no vale una contraseña, o null si vale. Vacía vale (quita la contraseña). */
export function passwordProblem(password: string): string | null {
  if (password.length > MAX_PASSWORD) return `La contraseña es demasiado larga (máximo 64 caracteres).`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'La contraseña no puede llevar saltos de línea ni caracteres de control.';
  if (password !== password.trim()) return 'La contraseña no puede empezar ni acabar con espacios.';
  return null;
}

export function setPasswordText(ini: string, password: string): string {
  const eol = ini.includes('\r\n') ? '\r\n' : '\n';
  const lines = ini.split(/\r?\n/);
  const sec = serverSection(lines);
  if (!sec) throw new Error('El server_cfg.ini no tiene la sección [SERVER].');
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    if (/^PASSWORD=/.test(lines[i]!)) { lines[i] = `PASSWORD=${password}`; return lines.join(eol); }
  }
  lines.splice(sec[0] + 1, 0, `PASSWORD=${password}`);
  return lines.join(eol);
}

export interface ServerPasswordDto { password: string; hasPassword: boolean }

export function readServerPassword(serverDir: string, preset: string): ServerPasswordDto {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const password = readPasswordText(readFileSync(file, 'utf8'));
  return { password, hasPassword: password !== '' };
}

export function writeServerPassword(serverDir: string, preset: string, password: string): ServerPasswordDto {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) throw new Error(`No existe ${file}.`);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const next = setPasswordText(readFileSync(file, 'utf8'), password);
  copyFileSync(file, `${file}.howler-prev`);
  writeFileSync(file, next);
  return readServerPassword(serverDir, preset);
}
