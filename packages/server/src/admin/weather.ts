import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serverCfgPath } from './server-config';

/**
 * Climas del servidor. Con el clima clásico (EnableWeatherFx: false) el servidor tiene una LISTA de climas en
 * el preset ([WEATHER_0], [WEATHER_1]...) y se salta entre ellos con /setweather <número>. El «sistema» de clima
 * (el de AC por defecto, Sol, Pure...) es la familia de carpetas de content/weather de la que salen esos climas.
 */

export interface WeatherChoice {
  /** Nombre de la carpeta en content/weather (lo que va en GRAPHICS=). */
  graphics: string;
  name: string;
}

export interface WeatherSystem {
  id: string;
  label: string;
  weathers: WeatherChoice[];
}

export interface WeatherEntry extends WeatherChoice {
  /** Posición en la lista del preset: lo que espera /setweather. */
  id: number;
  system: string;
  ambient: number;
  road: number;
}

const DEFAULT_NAMES: Record<string, string> = {
  '1_heavy_fog': 'Niebla densa', '2_light_fog': 'Niebla ligera', '3_clear': 'Despejado', '4_mid_clear': 'Poco nuboso',
  '5_light_clouds': 'Algunas nubes', '6_mid_clouds': 'Parcialmente nublado', '7_heavy_clouds': 'Muy nublado',
};

const SOL_NAMES: Record<string, string> = {
  no_clouds: 'Sin nubes', clear: 'Despejado', few_clouds: 'Pocas nubes', scattered_clouds: 'Nubes dispersas', windy: 'Ventoso',
  broken_clouds: 'Nuboso', overcast: 'Cubierto', mist: 'Neblina', fog: 'Niebla', haze: 'Calima', dust: 'Polvo', sand: 'Arena',
  smoke: 'Humo', light_drizzle: 'Llovizna ligera', drizzle: 'Llovizna', heavy_drizzle: 'Llovizna fuerte', light_rain: 'Lluvia ligera',
  rain: 'Lluvia', heavy_rain: 'Lluvia fuerte', light_thunderstorm: 'Tormenta ligera', thunderstorm: 'Tormenta',
  heavy_thunderstorm: 'Tormenta fuerte', squalls: 'Rachas de viento', tornado: 'Tornado', hurricane: 'Huracán', light_snow: 'Nieve ligera',
  snow: 'Nieve', heavy_snow: 'Nieve fuerte', light_sleet: 'Aguanieve ligera', sleet: 'Aguanieve', heavy_sleet: 'Aguanieve fuerte', hail: 'Granizo',
};

const SYSTEM_LABELS: Record<string, string> = { default: 'Por defecto de AC', sol: 'Sol', pure: 'Pure' };

const cap = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** A qué sistema pertenece una carpeta de clima, según su nombre. */
export function systemOf(graphics: string): string {
  if (/^\d+_/.test(graphics)) return 'default';
  const m = /^([a-z]+)[_-]/i.exec(graphics);
  return m ? m[1]!.toLowerCase() : 'default';
}

/** Nombre legible en español de una carpeta de clima. */
export function weatherName(graphics: string): string {
  if (DEFAULT_NAMES[graphics]) return DEFAULT_NAMES[graphics]!;
  const sol = /^sol_\d+_(.+)$/.exec(graphics);
  if (sol) return SOL_NAMES[sol[1]!] ?? cap(sol[1]!);
  return cap(graphics.replace(/^[a-z]+[_-]\d*_?/i, '') || graphics);
}

/** Sistemas de clima instalados en la instalación de AC (content/weather), con sus climas. */
export function listWeatherSystems(acRoot: string): WeatherSystem[] {
  const dir = join(acRoot, 'content', 'weather');
  if (!existsSync(dir)) return [];
  const bySystem = new Map<string, WeatherChoice[]>();
  for (const d of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
    const sys = systemOf(d.name);
    (bySystem.get(sys) ?? bySystem.set(sys, []).get(sys)!).push({ graphics: d.name, name: weatherName(d.name) });
  }
  const order = ['default', 'sol', 'pure'];
  return [...bySystem.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b))
    .map(([id, weathers]) => ({ id, label: SYSTEM_LABELS[id] ?? cap(id), weathers }));
}

const SECTION = /^\[(WEATHER_(\d+))\]\s*$/;

/** Lista de climas del preset, en el orden en que el servidor los numera. */
export function parseWeatherList(cfg: string): WeatherEntry[] {
  const out: WeatherEntry[] = [];
  let cur: { n: number; props: Record<string, string> } | null = null;
  const flush = () => {
    if (!cur) return;
    const graphics = cur.props.GRAPHICS ?? '';
    out.push({ id: 0, graphics, name: weatherName(graphics), system: systemOf(graphics), ambient: Number(cur.props.BASE_TEMPERATURE_AMBIENT ?? 20), road: Number(cur.props.BASE_TEMPERATURE_ROAD ?? 6) });
    cur = null;
  };
  for (const raw of cfg.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = SECTION.exec(line);
    if (m) { flush(); cur = { n: Number(m[2]), props: {} }; continue; }
    if (line.startsWith('[')) { flush(); continue; }
    if (cur) {
      const kv = /^([A-Z_]+)=(.*)$/.exec(line);
      if (kv) cur.props[kv[1]!] = kv[2]!;
    }
  }
  flush();
  // El servidor numera por orden de aparición, aunque los números de sección no sean consecutivos.
  return out.map((e, i) => ({ ...e, id: i }));
}

/** Bloque [WEATHER_n] con los valores por defecto razonables. */
function block(n: number, e: { graphics: string; ambient: number; road: number }, eol: string): string {
  return [
    `[WEATHER_${n}]`,
    `GRAPHICS=${e.graphics}`,
    `BASE_TEMPERATURE_AMBIENT=${e.ambient}`,
    `BASE_TEMPERATURE_ROAD=${e.road}`,
    'VARIATION_AMBIENT=1',
    'VARIATION_ROAD=1',
    'WIND_BASE_SPEED_MIN=0',
    'WIND_BASE_SPEED_MAX=11.4',
    'WIND_BASE_DIRECTION=0',
    'WIND_VARIATION_DIRECTION=20',
    '',
  ].join(eol);
}

/**
 * Sustituye la lista de climas del server_cfg.ini por `graphics` (en ese orden). Los climas que ya estaban conservan
 * sus temperaturas y viento; los nuevos llevan valores por defecto. Todo lo demás del archivo no se toca.
 */
export function writeWeatherList(cfg: string, graphics: string[]): string {
  if (!graphics.length) throw new Error('Tiene que haber al menos un clima en la lista.');
  const bom = cfg.startsWith('﻿') ? '﻿' : '';
  const body = bom ? cfg.slice(1) : cfg;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';

  // Se separan las secciones del archivo; se guardan los bloques de clima actuales para reutilizar sus valores.
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  const old = new Map<string, string[]>();
  let skipping = false;
  let current: string[] | null = null;
  for (const l of lines) {
    if (/^\[WEATHER_\d+\]\s*$/.test(l.trim())) { skipping = true; current = [l]; continue; }
    if (skipping && l.trim().startsWith('[')) skipping = false;
    if (skipping) {
      current!.push(l);
      const g = /^GRAPHICS=(.+)$/.exec(l.trim());
      if (g) old.set(g[1]!.trim(), current!);
      continue;
    }
    kept.push(l);
  }
  while (kept.length && kept[kept.length - 1]!.trim() === '') kept.pop();

  const blocks = graphics.map((g, n) => {
    const prev = old.get(g);
    if (prev) {
      const props = prev.filter((x) => x.trim() && !/^\[/.test(x.trim()));
      return [`[WEATHER_${n}]`, ...props, ''].join(eol);
    }
    return block(n, { graphics: g, ambient: 20, road: 6 }, eol);
  });
  return bom + kept.join(eol) + eol + eol + blocks.join(eol).replace(/(\r?\n)+$/, '') + eol;
}

/** ¿Está activo el clima de CSP (WeatherFX) en el preset? Por defecto, true en AssettoServer. */
export function weatherFxEnabled(extraCfg: string): boolean {
  const m = /^EnableWeatherFx:\s*(true|false)\b/m.exec(extraCfg);
  return m ? m[1] === 'true' : true;
}

/** Cambia `EnableWeatherFx` en el texto de extra_cfg.yml conservando todo lo demás (saltos de línea y BOM incluidos). */
export function setWeatherFxText(extraCfg: string, enabled: boolean): string {
  const value = enabled ? 'true' : 'false';
  if (/^EnableWeatherFx:\s*\S+/m.test(extraCfg)) return extraCfg.replace(/^(EnableWeatherFx:\s*)\S+/m, `$1${value}`);
  const eol = extraCfg.includes('\r\n') ? '\r\n' : '\n';
  return `${extraCfg}${extraCfg === '' || extraCfg.endsWith('\n') ? '' : eol}EnableWeatherFx: ${value}${eol}`;
}

/** Una variante de Pure instalada (Pure 3.59 trae «Pure Gamma» y «Pure LCS»). */
export interface PureVariant { folder: string; name: string; version: string | null }

/**
 * Busca Pure en la instalación de AC. Pure es un script de WeatherFX de CSP: se instala en `extension/weather/<carpeta>`
 * (3.59: `pure` = «Pure Gamma» y `Pure LCS`, con su `manifest.ini`), no en `content/weather`. Solo informa: el servidor no lo necesita,
 * cada jugador lo elige en su Content Manager.
 */
export function detectPure(acRoot: string): { found: boolean; where: string | null; variants: PureVariant[] } {
  const dir = join(acRoot, 'extension', 'weather');
  const variants: PureVariant[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^pure/i.test(e.name)) continue;
      let name = e.name;
      let version: string | null = null;
      try {
        const ini = readFileSync(join(dir, e.name, 'manifest.ini'), 'utf8');
        name = /^\s*NAME\s*=\s*(.+?)\s*$/im.exec(ini)?.[1] ?? name;
        version = /^\s*VERSION\s*=\s*(.+?)\s*$/im.exec(ini)?.[1] ?? null;
      } catch { /* sin manifiesto: se enseña la carpeta */ }
      variants.push({ folder: e.name, name, version });
    }
  } catch { /* sin carpeta extension/weather */ }
  return variants.length ? { found: true, where: dir, variants } : { found: false, where: null, variants: [] };
}

export interface WeatherState {
  /** true = clima de CSP (tipos libres con /setcspweather); false = clásico (lista del preset con /setweather). */
  fx: boolean;
  systems: WeatherSystem[];
  list: WeatherEntry[];
  pure: { found: boolean; where: string | null; variants: PureVariant[] };
}

export function readWeatherState(serverDir: string, preset: string): WeatherState {
  const cfgFile = serverCfgPath(serverDir, preset);
  if (!existsSync(cfgFile)) throw new Error(`No existe ${cfgFile}.`);
  const extra = join(dirname(cfgFile), 'extra_cfg.yml');
  return {
    fx: existsSync(extra) ? weatherFxEnabled(readFileSync(extra, 'utf8')) : true,
    systems: listWeatherSystems(join(serverDir, '..')),
    list: parseWeatherList(readFileSync(cfgFile, 'utf8')),
    pure: detectPure(join(serverDir, '..')),
  };
}

/** Cambia la lista de climas del preset. Solo se admiten carpetas que existen en content/weather. */
export function saveWeatherList(serverDir: string, preset: string, graphics: string[]): WeatherEntry[] {
  const known = new Set(listWeatherSystems(join(serverDir, '..')).flatMap((s) => s.weathers.map((w) => w.graphics)));
  const unknown = graphics.filter((g) => !known.has(g));
  if (unknown.length) throw new Error(`Clima no instalado en tu Assetto Corsa: ${unknown.join(', ')}.`);
  if (new Set(graphics).size !== graphics.length) throw new Error('Hay climas repetidos en la lista.');
  const file = serverCfgPath(serverDir, preset);
  const text = readFileSync(file, 'utf8');
  const next = writeWeatherList(text, graphics);
  copyFileSync(file, `${file}.howler-prev`);
  writeFileSync(file, next);
  return parseWeatherList(next);
}

/** Activa o desactiva el clima de CSP (WeatherFX, el que usan Pure, Sol y el de por defecto) en el extra_cfg.yml del preset. Hace falta reiniciar el servidor. */
export function saveWeatherFx(serverDir: string, preset: string, enabled: boolean): void {
  const extra = join(dirname(serverCfgPath(serverDir, preset)), 'extra_cfg.yml');
  if (!existsSync(extra)) throw new Error(`No existe ${extra}.`);
  const text = readFileSync(extra, 'utf8');
  const next = setWeatherFxText(text, enabled);
  if (next === text) return;
  copyFileSync(extra, `${extra}.howler-prev`);
  writeFileSync(extra, next);
}
