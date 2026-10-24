// Crea un servidor nuevo para quien tiene Assetto Corsa pero ningún servidor: AssettoServer + enlaces al contenido del juego
// + un preset mínimo listo para arrancar. Solo toca la carpeta de destino (nunca la instalación de Assetto Corsa).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateServerDirs } from '../../server/src/admin/detect-server';

/** ¿Es esta carpeta una instalación de Assetto Corsa de la que se puede montar un servidor? (coches, circuitos y datos de sistema). */
export function checkAssettoCorsa(dir: string): { ok: boolean; problem: string | null } {
  if (!dir || !existsSync(dir)) return { ok: false, problem: 'La carpeta no existe.' };
  if (!existsSync(join(dir, 'content', 'cars')) || !existsSync(join(dir, 'content', 'tracks'))) return { ok: false, problem: 'Esa carpeta no parece Assetto Corsa: faltan content\\cars y content\\tracks.' };
  if (![join(dir, 'server', 'system', 'data'), join(dir, 'system', 'data')].some(existsSync)) return { ok: false, problem: 'Faltan los datos de sistema de Assetto Corsa (server\\system\\data).' };
  return { ok: true, problem: null };
}

/** Instalaciones de Assetto Corsa en las bibliotecas de Steam. */
export function findAssettoCorsa(steamRoots?: string[]): string[] {
  return candidateServerDirs(steamRoots).map((s) => join(s, '..')).filter((ac) => checkAssettoCorsa(ac).ok);
}

const dirs = (d: string) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);

export interface NewServerChoice { car: string; skin: string; track: string; layout: string; slots: number }

/** Un coche y un circuito que existan de verdad: se prefieren los de serie de Assetto Corsa, y si no, los primeros que haya. */
export function pickDefaults(acDir: string): NewServerChoice {
  const cars = join(acDir, 'content', 'cars'), tracks = join(acDir, 'content', 'tracks');
  const car = ['ks_mazda_mx5_nd', 'ks_mazda_miata', 'abarth500'].find((c) => existsSync(join(cars, c, 'skins'))) ?? dirs(cars).find((c) => dirs(join(cars, c, 'skins')).length > 0);
  if (!car) throw new Error('No encuentro ningún coche en la instalación de Assetto Corsa.');
  const skin = dirs(join(cars, car, 'skins'))[0]!;
  const track = ['ks_vallelunga', 'ks_silverstone', 'magione'].find((t) => existsSync(join(tracks, t))) ?? dirs(tracks)[0];
  if (!track) throw new Error('No encuentro ningún circuito en la instalación de Assetto Corsa.');
  // Circuitos con varios trazados: carpetas dentro de `ui` con su ui_track.json; sin ellas, el circuito es único.
  const ui = join(tracks, track, 'ui');
  const layout = dirs(ui).find((l) => existsSync(join(ui, l, 'ui_track.json'))) ?? '';
  let boxes = 0;
  try {
    const raw = readFileSync(join(ui, layout, 'ui_track.json'), 'utf8').replace(/^﻿/, '');
    boxes = Number(/"pitboxes"\s*:\s*"?(\d+)/i.exec(raw)?.[1] ?? 0);
  } catch { /* sin ficha del circuito */ }
  return { car, skin, track, layout, slots: Math.max(1, Math.min(8, boxes || 8)) };
}

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

export function serverCfg(c: NewServerChoice, ports: { udp: number; tcp: number; http: number; acsp: number; acspServer: number }, name: string): string {
  return crlf(`[SERVER]
NAME=${name}
CARS=${c.car}
CONFIG_TRACK=${c.layout}
TRACK=${c.track}
SUN_ANGLE=-4
PASSWORD=
ADMIN_PASSWORD=
UDP_PORT=${ports.udp}
TCP_PORT=${ports.tcp}
HTTP_PORT=${ports.http}
MAX_BALLAST_KG=0
QUALIFY_MAX_WAIT_PERC=120
PICKUP_MODE_ENABLED=1
LOOP_MODE=1
SLEEP_TIME=1
CLIENT_SEND_INTERVAL_HZ=60
RACE_OVER_TIME=60
KICK_QUORUM=85
VOTING_QUORUM=80
VOTE_DURATION=15
BLACKLIST_MODE=1
FUEL_RATE=1
DAMAGE_MULTIPLIER=100
TYRE_WEAR_RATE=1
ALLOWED_TYRES_OUT=2
ABS_ALLOWED=1
TC_ALLOWED=1
START_RULE=0
STABILITY_ALLOWED=0
AUTOCLUTCH_ALLOWED=0
TYRE_BLANKETS_ALLOWED=1
FORCE_VIRTUAL_MIRROR=1
REGISTER_TO_LOBBY=0
MAX_CLIENTS=${c.slots}
NUM_THREADS=2
UDP_PLUGIN_LOCAL_PORT=${ports.acspServer}
UDP_PLUGIN_ADDRESS=127.0.0.1:${ports.acsp}
AUTH_PLUGIN_ADDRESS=
RACE_GAS_PENALTY_DISABLED=0
RACE_EXTRA_LAP=0
REVERSED_GRID_RACE_POSITIONS=0
RESULT_SCREEN_TIME=60
LOCKED_ENTRY_LIST=0
ENTRY_LIST=1
TIME_OF_DAY_MULT=1
MAX_CONTACTS_PER_KM=-1

[WEATHER_0]
GRAPHICS=3_clear
BASE_TEMPERATURE_AMBIENT=20
BASE_TEMPERATURE_ROAD=6
VARIATION_AMBIENT=1
VARIATION_ROAD=1
WIND_BASE_SPEED_MIN=0
WIND_BASE_SPEED_MAX=5
WIND_BASE_DIRECTION=0
WIND_VARIATION_DIRECTION=20

[DATA]
DESCRIPTION=
EXSERVEREXE=
EXSERVERBAT=
EXSERVERHIDEWIN=0
WEBLINK=

[PRACTICE]
NAME=Practice
TIME=60
IS_OPEN=1

[QUALIFY]
NAME=Qualify
TIME=10
IS_OPEN=1

[RACE]
NAME=Race
TIME=0
IS_OPEN=1
WAIT_TIME=15
LAPS=10
`);
}

export function entryList(c: NewServerChoice): string {
  return crlf(Array.from({ length: c.slots }, (_, i) => `[CAR_${i}]
MODEL=${c.car}
SKIN=${c.skin}
SPECTATOR_MODE=0
DRIVERNAME=
TEAM=
GUID=
BALLAST=0
RESTRICTOR=0
`).join('\n'));
}

export const EXTRA_CFG = crlf(`EnablePlugins:
  - HowlerPlugin
EnableLegacyPluginInterface: true
EnableClientMessages: true
EnableWeatherFx: false
IgnoreConfigurationErrors:
  MissingTrackParams: true
`);

export interface NewServerOptions {
  /** Instalación de Assetto Corsa (carpeta con `content` y `server`). */
  acDir: string;
  /** Carpeta nueva donde se monta el servidor (no puede tener ya archivos). */
  target: string;
  /** AssettoServer ya descomprimido. */
  assettoDir: string;
  name?: string;
  ports?: { udp?: number; tcp?: number; http?: number; acsp?: number; acspServer?: number };
}
export interface NewServerResult { serverDir: string; preset: string; choice: NewServerChoice }

/** Une `link` con `dest` sin copiar (enlace de directorio de Windows: no pide administrador). */
function junction(dest: string, link: string) {
  symlinkSync(dest, link, 'junction');
}

export function createNewServer(o: NewServerOptions): NewServerResult {
  if (!existsSync(join(o.acDir, 'content', 'cars'))) throw new Error('La carpeta de Assetto Corsa no es válida: falta content\\cars.');
  if (!['AssettoServer.exe', 'AssettoServer'].some((e) => existsSync(join(o.assettoDir, e)))) throw new Error('Falta AssettoServer para crear el servidor.');
  if (existsSync(o.target) && readdirSync(o.target).length > 0) throw new Error('La carpeta del servidor nuevo ya tiene archivos: elige una vacía.');
  const system = [join(o.acDir, 'server', 'system'), join(o.acDir, 'system')].find((d) => existsSync(join(d, 'data')));
  if (!system) throw new Error('No encuentro los datos de sistema de Assetto Corsa (server\\system\\data).');

  const choice = pickDefaults(o.acDir);
  const ports = { udp: 9600, tcp: 9600, http: 8081, acsp: 12000, acspServer: 11000, ...o.ports };
  mkdirSync(o.target, { recursive: true });
  cpSync(o.assettoDir, o.target, { recursive: true });
  junction(join(o.acDir, 'content'), join(o.target, 'content'));
  junction(system, join(o.target, 'system'));

  const preset = join(o.target, 'presets', 'SERVER_00');
  mkdirSync(preset, { recursive: true });
  writeFileSync(join(preset, 'server_cfg.ini'), serverCfg(choice, ports, o.name ?? 'Servidor de Howler'));
  writeFileSync(join(preset, 'entry_list.ini'), entryList(choice));
  writeFileSync(join(preset, 'extra_cfg.yml'), EXTRA_CFG);
  // AssettoServer también busca la configuración en `cfg\`: se deja la misma.
  mkdirSync(join(o.target, 'cfg'), { recursive: true });
  for (const f of ['server_cfg.ini', 'entry_list.ini', 'extra_cfg.yml']) writeFileSync(join(o.target, 'cfg', f), readFileSync(join(preset, f)));
  if (!statSync(o.target).isDirectory()) throw new Error('No se pudo crear la carpeta del servidor.');
  return { serverDir: o.target, preset: 'SERVER_00', choice };
}
