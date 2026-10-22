import { SMART_KEYS, type SmartKey, type SmartMode, type SmartSettingDto } from '@howler/shared';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serverCfgPath } from './server-config';
import { readIgnoreFlagText } from './extra-cfg-flags';
import { allowMissingChecksums, readCarChecksums } from './car-checksums';
import { applyIgnoreFlag, hasTrackParams, serverTrackKey } from './server-diagnosis';
import { detectPure, readWeatherState, saveWeatherFx } from './weather';

/**
 * Ajustes del servidor que dependen del circuito, de los coches o del clima (tipos en `@howler/shared`). Con Auto Howler decide cada vez
 * que arranca el servidor mirando lo que hay instalado. Si nunca se ha elegido nada (`mode` sin definir) NO toca el archivo.
 */

const extraPath = (serverDir: string, preset: string) => join(dirname(serverCfgPath(serverDir, preset)), 'extra_cfg.yml');

interface Decision { value: boolean; reason: string; detail: string | null }

/** ¿Hay un script de WeatherFX de terceros (Pure o Sol) en la instalación de AC? */
function weatherScripts(acRoot: string): string[] {
  const found = detectPure(acRoot).variants.map((v) => v.name);
  try {
    const dir = join(acRoot, 'extension', 'weather');
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && /^sol/i.test(e.name)) found.push(e.name);
  } catch { /* sin carpeta extension/weather */ }
  return found;
}

/** Lo que Auto decidiría ahora para cada ajuste. */
export function autoDecisions(serverDir: string, preset: string): Record<SmartKey, Decision> {
  const scripts = weatherScripts(join(serverDir, '..'));
  const out = {} as Record<SmartKey, Decision>;
  out.weatherFx = scripts.length
    ? { value: true, reason: 'Auto: encendido, hay un script de clima de CSP instalado (Pure o Sol).', detail: scripts.join(', ') }
    : { value: false, reason: 'Auto: apagado, no hay ningún script de clima de CSP (Pure o Sol) instalado.', detail: null };

  const key = serverTrackKey(serverDir, preset);
  const has = key ? hasTrackParams(serverDir, key) : null;
  out.trackParams = has === false
    ? { value: true, reason: 'Auto: encendido, el circuito no tiene datos (zona horaria) en data_track_params.ini.', detail: key }
    : { value: false, reason: has === true ? 'Auto: apagado, el circuito ya tiene sus datos.' : 'Auto: apagado, no se pudo comprobar el circuito (AssettoServer descarga los datos al arrancar).', detail: key };

  let noAcd: string[] = [];
  try { noAcd = readCarChecksums(serverDir, preset).cars.filter((c) => !c.required && !c.missing).map((c) => c.model); } catch { /* sin lista de coches */ }
  out.carChecksums = noAcd.length
    ? { value: true, reason: 'Auto: encendido, hay coches en la lista sin data.acd en el servidor.', detail: noAcd.join(', ') }
    : { value: false, reason: 'Auto: apagado, todos los coches de la lista tienen su data.acd.', detail: null };
  return out;
}

/** Valores que tienen ahora los archivos del preset. */
export function currentValues(serverDir: string, preset: string): Record<SmartKey, boolean> {
  const extra = extraPath(serverDir, preset);
  const text = existsSync(extra) ? readFileSync(extra, 'utf8') : '';
  return {
    weatherFx: readWeatherState(serverDir, preset).fx,
    trackParams: readIgnoreFlagText(text, 'MissingTrackParams'),
    carChecksums: readIgnoreFlagText(text, 'MissingCarChecksums'),
  };
}

export function describeSmart(serverDir: string, preset: string, modes: Partial<Record<SmartKey, SmartMode>>): SmartSettingDto[] {
  const cur = currentValues(serverDir, preset);
  const auto = autoDecisions(serverDir, preset);
  return SMART_KEYS.map((key): SmartSettingDto => {
    const mode = modes[key] ?? null;
    const d = auto[key];
    const effective = mode === 'auto' ? d.value : mode === 'on' ? true : mode === 'off' ? false : cur[key];
    const reason = mode === 'auto' ? d.reason : mode === null ? 'Sin elegir: se respeta lo que ya tiene el archivo.' : mode === 'on' ? 'Encendido a mano.' : 'Apagado a mano.';
    return { key, mode, current: cur[key], effective, reason, detail: mode === 'auto' || mode === null ? d.detail : null };
  });
}

/** Escribe en los archivos los valores efectivos. Devuelve las claves que cambiaron. Hace falta reiniciar el servidor para que valgan. */
export function applySmart(serverDir: string, preset: string, modes: Partial<Record<SmartKey, SmartMode>>): SmartKey[] {
  const changed: SmartKey[] = [];
  for (const s of describeSmart(serverDir, preset, modes)) {
    if (s.mode === null || s.effective === s.current) continue;
    if (s.key === 'weatherFx') saveWeatherFx(serverDir, preset, s.effective);
    else if (s.key === 'trackParams') applyIgnoreFlag(serverDir, preset, 'MissingTrackParams', s.effective);
    else allowMissingChecksums(serverDir, preset, s.effective);
    changed.push(s.key);
  }
  return changed;
}
