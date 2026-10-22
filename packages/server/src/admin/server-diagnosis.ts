import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServerDiagnosisDto, ServerDiagnosisId } from '@howler/shared';
import { readIgnoreFlagText, setIgnoreFlagText, type IgnoreFlag } from './extra-cfg-flags';
import { serverCfgPath } from './server-config';

/**
 * Diagnóstico de por qué AssettoServer no arranca o se cae. Se basa en los mensajes REALES del código de AssettoServer
 * (v0.0.55-pre35, `ConfigurationException`), no en palabras sueltas: la consola dice «checksums» en líneas normales
 * («Initialized 2 track checksums»), así que buscar esa palabra daría falsos avisos.
 */

interface Rule { id: ServerDiagnosisId; re: RegExp; params?: (m: RegExpExecArray) => Record<string, string>; fix?: ServerDiagnosisDto['fix'] }

const RULES: Rule[] = [
  { id: 'track-params', re: /No track params found for (\S+?)\.? More info/i, params: (m) => ({ track: m[1]!.slice(m[1]!.lastIndexOf('/') + 1) }), fix: 'allow-track-params' },
  { id: 'bad-timezone', re: /Invalid time zone (\S+) for track (\S+?)\./i, params: (m) => ({ zone: m[1]!, track: m[2]! }) },
  { id: 'car-checksums', re: /No data\.acd found for (.+?)\.(?: This will|\s*$)/i, params: (m) => ({ cars: m[1]! }), fix: 'allow-car-checksums' },
  { id: 'admin-whitelist', re: /Admin whitelist is enabled but Steam auth is disabled/i },
  { id: 'udp-plugin', re: /(UDP_PLUGIN_ADDRESS[^\n]*|UDP_PLUGIN_LOCAL_PORT[^\n]*)/, params: (m) => ({ msg: m[1]!.trim() }) },
  { id: 'plugin-config', re: /Plugins are no longer configured via extra_cfg\.yml/i },
  { id: 'plugin', re: /No plugin found with name (\S+)/i, params: (m) => ({ plugin: m[1]! }) },
  { id: 'plugin', re: /(Could not load file or assembly[^\n]*|BadImageFormatException[^\n]*|MissingMethodException[^\n]*|TypeLoadException[^\n]*|ReflectionTypeLoadException[^\n]*)/i, params: (m) => ({ msg: m[1]!.trim() }) },
  { id: 'csp-version', re: /minimum required CSP version of ([\d.]+) \((\d+)\)/i, params: (m) => ({ version: m[1]!, build: m[2]! }) },
  { id: 'no-entries', re: /Entry list must contain one or more entries/i },
  { id: 'port-in-use', re: /(Only one usage of each socket address|address already in use|AddressAlreadyInUse|EADDRINUSE)/i },
  { id: 'missing-file', re: /No ai folder found\. Please put at least one AI spline fast_lane\.ai\(p\) into (.+)/i, params: (m) => ({ path: m[1]!.trim(), what: 'ai' }) },
  { id: 'missing-file', re: /(?:Could not find (?:file|a part of the path)|FileNotFoundException|DirectoryNotFoundException|Unable to find)[^'"\n]*['"]([^'"\n]+)['"]/i, params: (m) => ({ path: m[1]! }) },
  { id: 'bad-config', re: /(Could not find property \S+|Error setting property [^\n]+|YamlDotNet[^\n]*|YamlException[^\n]*)/i, params: (m) => ({ msg: m[1]!.trim() }) },
];

/** Línea del volcado de una excepción: `Espacio.Tipo: mensaje`. */
const EXCEPTION_LINE = /^(?:\[[^\]]*\]\s*)?([\w.]+(?:Exception|Error)):\s*(.+)$/;

/**
 * Causas probables de una caída, deducidas de la consola de ESA ejecución (más probable primero).
 * Solo se miran las líneas desde «Fatal exception occurred»: con el interruptor activo, AssettoServer escribe los mismos
 * textos como simple aviso y no son la causa de nada.
 */
export function diagnoseLogs(lines: string[]): ServerDiagnosisDto[] {
  const fatalAt = lines.findIndex((l) => /\bFTL\b|Fatal exception occurred/i.test(l));
  // Sin línea «fatal» (p. ej. se cerró sin avisar) se descartan al menos las que el propio servidor marca como información o aviso.
  const scope = fatalAt >= 0 ? lines.slice(fatalAt) : lines.filter((l) => !/^\[[\d:.]+\s+(?:VRB|DBG|INF|WRN)\]/.test(l));
  const text = scope.join('\n');
  const out: ServerDiagnosisDto[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    for (const line of scope) {
      const m = r.re.exec(line);
      if (!m) continue;
      const params = r.params?.(m) ?? {};
      const key = `${r.id}|${JSON.stringify(params)}`;
      if (seen.has(key)) break;
      seen.add(key);
      out.push({ id: r.id, params, fix: r.fix ?? null });
      break;
    }
  }
  if (out.length === 0 && (fatalAt >= 0 || /Exception/.test(text))) {
    const ex = scope.map((l) => EXCEPTION_LINE.exec(l.trim())).find(Boolean);
    out.push({ id: 'unknown', params: ex ? { type: ex[1]!, msg: ex[2]!.slice(0, 300) } : {}, fix: null });
  }
  return out;
}

// ─── Comprobación previa (antes de arrancar) ──────────────────────────────────────────────

const extraCfgPath = (serverDir: string, preset: string) => join(dirname(serverCfgPath(serverDir, preset)), 'extra_cfg.yml');

/** Última parte del `TRACK` del preset: es la clave con la que AssettoServer busca el circuito en `cfg/data_track_params.ini`. */
export function serverTrackKey(serverDir: string, preset: string): string | null {
  const file = serverCfgPath(serverDir, preset);
  if (!existsSync(file)) return null;
  const raw = /^TRACK\s*=\s*(.*?)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1];
  if (!raw) return null;
  return raw.slice(raw.lastIndexOf('/') + 1);
}

/** ¿Tiene `cfg/data_track_params.ini` una sección con ese nombre (exacto) y huso horario? Null si el archivo no existe aún (AssettoServer lo descarga solo). */
export function hasTrackParams(serverDir: string, key: string): boolean | null {
  const file = join(serverDir, 'cfg', 'data_track_params.ini');
  if (!existsSync(file)) return null;
  const parts = readFileSync(file, 'utf8').split(/^\s*\[([^\]\r\n]+)\]/m);
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] === key) return /^\s*TIMEZONE\s*=\s*\S+/im.test(parts[i + 1] ?? '');
  }
  return false;
}

/** Problemas que se pueden ver ANTES de arrancar y harían caer el servidor. */
export function preflightDiagnosis(serverDir: string, preset: string): ServerDiagnosisDto[] {
  const out: ServerDiagnosisDto[] = [];
  const key = serverTrackKey(serverDir, preset);
  const extra = extraCfgPath(serverDir, preset);
  const allowed = existsSync(extra) && readIgnoreFlagText(readFileSync(extra, 'utf8'), 'MissingTrackParams');
  if (key && !allowed && hasTrackParams(serverDir, key) === false) out.push({ id: 'track-params', params: { track: key }, fix: 'allow-track-params' });
  return out;
}

/** Activa un interruptor de `IgnoreConfigurationErrors` del extra_cfg.yml del preset (con copia `.howler-prev`). Devuelve si cambió algo. */
export function applyIgnoreFlag(serverDir: string, preset: string, key: IgnoreFlag, on = true): boolean {
  const extra = extraCfgPath(serverDir, preset);
  if (!existsSync(extra)) throw new Error(`No existe ${extra}.`);
  const text = readFileSync(extra, 'utf8');
  const next = setIgnoreFlagText(text, key, on);
  if (next === text) return false;
  copyFileSync(extra, `${extra}.howler-prev`);
  writeFileSync(extra, next);
  return true;
}
