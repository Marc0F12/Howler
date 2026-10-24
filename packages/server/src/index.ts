import { openExternal } from './core/open-url';
import { appendFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { AcspLink } from './acsp-link';
import { PluginLink } from './plugin-link';
import { loadConfig, saveConfig } from './config';
import { applySmart } from './admin/smart-settings';
import { Bus } from './core/bus';
import { startRecordAnnouncer } from './core/record-announcer';
import { startDiscordNotifier } from './core/discord';
import { resolveRules } from './core/lap-rules';
import { importSessionResults } from './core/results-import';
import { readSessionConditions } from './admin/server-config';
import { createContentReader, type ContentReader } from './core/ac-content';
import { createImageStore } from './core/championship-images';
import { createSoundStore } from './core/sounds';
import { createSkinSource } from './admin/entry-skins';
import { createAvatarService } from './core/steam-avatar';
import { sectorBoundaries } from './core/track-sectors';
import { Tracker } from './core/tracker';
import { openDatabase, SCHEMA_VERSION } from './db/database';
import { applyPendingRestore } from './core/backup';
import { startBackupScheduler } from './admin/backup-routes';
import { Repository } from './db/repository';
import { buildApp } from './http/app';
import { UpdateService } from './core/updates';
import { HOWLER_VERSION } from '@howler/shared';
import { setServerLang, st } from './core/lang';
import { MultiHowler } from './core/multihowler';
import { checkServerDir } from './admin/detect-server';
import { PluginCommander, commands } from './admin/plugin-commander';
import { Scheduler } from './admin/scheduler';
import { applyEventSetup } from './admin/event-setup';
import { AuthService } from './admin/auth';
import { readSessionPresets } from './admin/session-presets';
import { writeSessionPanel } from './admin/session-cfg';
import { ServerProcess } from './admin/server-process';

// La configuración se relee cuando el panel guarda un cambio; lo que ya está en marcha (puertos) necesita reiniciar Howler.
let config = loadConfig();
setServerLang(config.language);
const sectorsCache = new Map<string, ReturnType<typeof sectorBoundaries>>();
// Una restauración preparada desde el panel se aplica ahora, antes de abrir la base de datos.
if (applyPendingRestore(config.dataDir)) console.log('[howler] copia de seguridad restaurada (lo anterior está en data/antes-de-restaurar)');
const repo = new Repository(openDatabase(join(config.dataDir, 'howler.db')));
const bus = new Bus();

/** Carpetas `content` de AC: la instalación completa (hermana de server\) y la del propio servidor. */
const contentDirs = () =>
  config.serverDir ? [join(dirname(config.serverDir), 'content'), join(config.serverDir, 'content')] : [];

/** Un solo lector de contenido mientras no cambien las carpetas (así se aprovecha su caché de JSON); se renueva cada minuto por si se instala algo. */
let readerCache: { key: string; at: number; reader: ContentReader } | null = null;
const contentReader = (): ContentReader => {
  const dirs = contentDirs();
  const key = dirs.join('|');
  if (!readerCache || readerCache.key !== key || Date.now() - readerCache.at > 60_000) readerCache = { key, at: Date.now(), reader: createContentReader(dirs) };
  return readerCache.reader;
};

/** Carpetas de circuitos de AC: la instalación completa (hermana de server\) y content del propio servidor. */
const trackDirs = () =>
  config.serverDir ? [join(dirname(config.serverDir), 'content', 'tracks'), join(config.serverDir, 'content', 'tracks')] : [];

const debug = process.env.HOWLER_DEBUG === '1';
let updates = 0;
let lastSpline = 0;
if (debug) setInterval(() => { console.log(`[acsp] carUpdate: ${updates} en 5 s, spline=${lastSpline.toFixed(3)}`); updates = 0; }, 5000).unref();
const link = new AcspLink(config.acsp, (e) => {
  if (debug && e.kind === 'carUpdate') {
    updates++;
    lastSpline = e.splinePos;
    if (process.env.HOWLER_DUMP) appendFileSync(process.env.HOWLER_DUMP, `${performance.now().toFixed(2)},${e.carId},${e.pos.x},${e.pos.z},${e.splinePos},${e.velocity.x},${e.velocity.z}\n`);
  }
  if (debug && e.kind !== 'carUpdate') console.log('[acsp <-]', JSON.stringify(e));
  tracker.handle(e);
});
/** Reglas de vuelta válida de cada circuito, siempre con la configuración en vigor (se recarga al guardar). */
const rulesFor = (track: string, layout: string) => resolveRules(config.lapRules, track, layout).rules;
// Las penalizaciones automáticas de carrera salen siempre de la configuración vigente
repo.championships.setAutoPenalties(() => config.racePenalties);
// La skin de un inscrito sin skin asignada en el campeonato sale de la lista de coches del servidor (por su Steam ID, que no sale de aquí)
repo.championships.setSkinSource(createSkinSource(() => config.serverDir, () => config.server.preset, (id) => repo.driverSteamId(id)));
const tracker = new Tracker({
  repo,
  rulesFor,
  conditionsNow: () => readSessionConditions(config.serverDir, config.server.preset),
  bus,
  send: (c) => link.send(c),
  positionIntervalMs: config.acsp.positionIntervalMs,
  referenceOffsetM: config.acsp.referenceOffsetM,
  onSessionEnd: (session, filename) => {
    void importSessionResults({ repo, bus, serverDir: config.serverDir, session, filename, rulesFor });
  },
  sectorsFor: (track, layout) => {
    // Leer los .kn5 del circuito puede tardar segundos: el resultado no cambia mientras no cambien las carpetas ni la configuración.
    const dirs = trackDirs();
    const key = `${track}|${layout}|${dirs.join(',')}|${JSON.stringify(config.trackSectors)}`;
    const hit = sectorsCache.get(key);
    if (hit) return hit;
    const found = sectorBoundaries(track, layout, { trackDirs: dirs, overrides: config.trackSectors });
    console.log(`[howler] sectores de ${track}${layout ? '/' + layout : ''}: ${found.bounds.length + 1} (${found.source}); fronteras ${found.bounds.map((b) => b.toFixed(3)).join(', ')}`);
    sectorsCache.set(key, found);
    return found;
  },
});

// Panel: canal de órdenes del plugin y gestor del proceso del servidor de AC.
const commander = new PluginCommander({ port: config.acsp.pluginCommandPort });
const serverProcess = new ServerProcess({
  serverDir: config.serverDir,
  exe: config.server.exe,
  preset: config.server.preset,
  requestStop: () => commander.requestStop(),
  beforeStart: () => { if (config.serverDir) applySmart(config.serverDir, config.server.preset, config.smartSettings); },
});
serverProcess.on('state', () => bus.emit({ type: 'server' }));
serverProcess.on('log', (l) => { if (debug) console.log('[servidor]', l); });

// Eventos programados: a la hora marcada aplica un preset de sesión y arranca (o reinicia) el servidor.
const stopWithWarning = () => ({
  warnSeconds: tracker.status().online.length > 0 ? config.server.stopWarningSeconds : 0,
  announce: async (s: number) => { await commander.exec(commands.say(st('El servidor se parará en {n} segundos.', { n: s }))); },
});
const scheduler = new Scheduler({
  dataDir: config.dataDir,
  presets: () => readSessionPresets(config.dataDir).presets,
  apply: (ev, p) => {
    if (p) writeSessionPanel(config.serverDir, config.server.preset, { values: p.values, sessions: p.sessions });
    applyEventSetup(config.serverDir, config.server.preset, ev, (car) => contentReader().carSkins(car).map((s) => s.id));
  },
  notify: (kind, ev, minutes) => bus.emit({ type: 'schedule', kind, name: ev.name, minutes, track: ev.track?.track ?? '', layout: ev.track?.layout ?? '' }),
  serverState: () => serverProcess.snapshot().state,
  start: () => serverProcess.start(),
  restart: () => serverProcess.restart(stopWithWarning()),
  stop: () => serverProcess.stop(stopWithWarning()),
  playersOnline: () => tracker.status().online.length,
  say: async (m) => { await commander.exec(commands.say(m)); },
  log: (m) => console.log(m),
});
scheduler.start();
const auth = new AuthService({ dataDir: config.dataDir, remoteEnabled: () => config.admin.remote.enabled });

startDiscordNotifier({
  bus, settings: () => config.discord, serverState: () => serverProcess.snapshot().state,
  online: () => tracker.status().online, session: () => tracker.status().session,
  scopes: (id) => repo.recordScopes.forLap(id),
  championship: (id) => { const c = repo.championships.get(id); return c ? { name: c.name, rounds: c.roundList.length } : null; },
  carName: (id) => contentReader().carInfo(id)?.name ?? id,
  trackName: (t, l) => contentReader().trackInfo(t, l)?.name ?? t,
  server: () => ({ name: repo.multihowler.name, badge: repo.multihowler.badge }),
});

startRecordAnnouncer({
  bus, settings: () => config.recordAnnounce, scopes: (id) => repo.recordScopes.forLap(id),
  say: (m) => { void commander.exec(commands.say(m)).catch(() => undefined); },
  carName: (id) => contentReader().carInfo(id)?.name ?? id,
  trackName: (t, l) => contentReader().trackInfo(t, l)?.name ?? t,
});

const pluginLink = new PluginLink({ host: config.acsp.pluginHost, port: config.acsp.pluginPort }, (m) => tracker.handlePlugin(m));
await link.start();
await pluginLink.start();
tracker.sync();
setInterval(() => tracker.tick(), 2000).unref();
// El clima y las temperaturas cambian durante la sesión: se piden de nuevo cada 30 s para anotar el de cada vuelta.
setInterval(() => tracker.refreshSessionInfo(), 30_000).unref();
startBackupScheduler({ repo, dataDir: config.dataDir, howlerVersion: HOWLER_VERSION, getBackup: () => config.backup });

// Web pública (para los amigos): solo lectura, sin ninguna ruta del panel.
const avatars = createAvatarService({ dir: join(config.dataDir, 'avatars'), enabled: config.profiles.steamAvatars });
const images = createImageStore(join(config.dataDir, 'championship-images'));
const sounds = createSoundStore(join(config.dataDir, 'sounds'));
const updateService = new UpdateService({
  current: HOWLER_VERSION,
  settings: () => config.updates,
  saveDismissed: (version) => { saveConfig({ updates: { dismissed: version } }); config = loadConfig(); setServerLang(config.language); },
  lang: () => config.language,
  dir: join(config.dataDir, 'updates'),
  // El instalador se abre solo (Windows pedirá permiso) y Howler se cierra para que pueda sustituir los archivos.
  launch: async (file) => {
      const installer = spawn(file, ['--update'], { detached: true, stdio: 'ignore' }); // --update: actualiza sin preguntas y vuelve a abrir Howler
      // Si no se puede ejecutar (antivirus, permisos) no se cierra Howler: el error llega al panel.
      await new Promise<void>((resolve, reject) => { installer.once('error', reject); installer.once('spawn', () => resolve()); });
      installer.unref();
      setTimeout(() => void shutdown(), 1500);
    },
});
const multihowler = new MultiHowler(repo.multihowler, { shared: repo.sharedChampionships, traces: repo.mhTraces, onLapsChanged: () => bus.emit({ type: 'results' }) });
const app = await buildApp({ repo, tracker, bus, trackDirs: trackDirs(), contentDirs: contentDirs(), avatars, images, sounds, multihowler, getAppearance: () => config.appearance, getWorldMap: () => config.worldMap, rateLimit: config.http.rateLimit });
await app.listen({ host: config.http.host, port: config.http.port });

// Panel de control: otra instancia que solo escucha en 127.0.0.1, así nadie fuera de este PC puede abrirlo.
const adminPort = config.admin.port;
const adminApp = await buildApp({
  repo, tracker, bus, trackDirs: trackDirs(), contentDirs: contentDirs(), images, sounds, getAppearance: () => config.appearance, getWorldMap: () => config.worldMap,
  admin: {
    multihowler,
    updates: updateService,
    images,
    sounds,
    importsDir: join(config.dataDir, 'imports'),
    backup: {
      dataDir: config.dataDir, howlerVersion: HOWLER_VERSION, schemaVersion: SCHEMA_VERSION,
      getBackup: () => config.backup,
      saveBackup: (b) => { saveConfig({ backup: b }); config = loadConfig(); },
      requestExit: () => void shutdown(),
    },
    trackInContent: (t, l) => contentReader().trackInfo(t, l) != null,
    getConfig: () => config,
    saveConfig: (patch) => { saveConfig(patch); config = loadConfig(); setServerLang(config.language); },
    repo,
    saveAppearance: (a) => { saveConfig({ appearance: a }, undefined, ['appearance']); config = loadConfig(); },
    saveWorldMap: (cfg) => { saveConfig({ worldMap: cfg }, undefined, ['worldMap']); config = loadConfig(); },
    saveLapRules: (cfg) => { saveConfig({ lapRules: cfg }, undefined, ['lapRules']); config = loadConfig(); setServerLang(config.language); },
    onLapsChanged: () => bus.emit({ type: 'results' }),
    installedContent: () => contentReader().installed(),
    content: () => contentReader(),
    onChampionship: (kind, id) => bus.emit({ type: 'championship', kind, id }),
    process: serverProcess,
    commander,
    scheduler,
    auth,
    online: () => tracker.status().online,
    pluginAlive: () => tracker.status().exactSectors,
    allowedHosts: [`127.0.0.1:${adminPort}`, `localhost:${adminPort}`],
  },
});
// Con el acceso remoto activado el panel escucha en todas las interfaces, pero cada petición de fuera exige iniciar sesión (admin/auth.ts).
await adminApp.listen({ host: config.admin.remote.enabled ? '0.0.0.0' : '127.0.0.1', port: adminPort });
multihowler.start();
updateService.start();

console.log(`[howler] web pública en http://localhost:${config.http.port}`);
console.log(`[howler] panel de control ${config.admin.remote.enabled ? '(este PC y acceso remoto con cuenta)' : '(solo en este PC)'} en http://127.0.0.1:${adminPort}`);
if (process.platform !== 'win32') console.log(`[howler] si Howler corre en otro equipo (un VPS), abre el panel con un túnel SSH: ssh -L ${adminPort}:127.0.0.1:${adminPort} usuario@servidor  y entra en http://127.0.0.1:${adminPort}`);
console.log(`[howler] sectores exactos del plugin en udp://${config.acsp.pluginHost}:${config.acsp.pluginPort}`);
console.log(`[howler] escuchando al servidor de AC en udp://${config.acsp.listenHost}:${config.acsp.listenPort}`);

/** Proceso de la ventana del panel (Edge en modo aplicación), para cerrarla cuando Howler se apaga por otro motivo (por ejemplo al actualizar). */
let panelPid: number | undefined;

// Versión portátil (Howler.exe): el panel es la ventana de la aplicación (Edge en modo aplicación); al cerrarla, Howler se apaga.
if (process.env.HOWLER_OPEN_PANEL === '1') {
  const url = `http://127.0.0.1:${adminPort}/?app=1#/panel`;
  const edges = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((d) => join(d!, 'Microsoft/Edge/Application/msedge.exe'));
  const edge = edges.find((p) => existsSync(p));
  // Ventana propia de Howler (window/HowlerWindow.exe, con WebView2): se llama «Howler» en la barra de tareas. Si falta o no puede
  // arrancar (sin el motor WebView2), se usa la ventana de Edge en modo aplicación de siempre.
  const own = process.env.HOWLER_HOME ? join(process.env.HOWLER_HOME, 'window', 'HowlerWindow.exe') : '';
  const openEdgeWindow = () => {
    try {
      if (!edge) { openExternal(url); return; }
      const open = (attempt: number) => {
        const opened = Date.now();
        const win = spawn(edge, [`--app=${url}`, '--window-size=1320,900', `--user-data-dir=${join(config.dataDir, 'panel-window')}`, '--no-first-run'], { stdio: 'ignore' });
        panelPid = win.pid;
        win.on('exit', () => {
          panelPid = undefined;
          if (Date.now() - opened > 5000) { void shutdown(); return; }
          // Edge terminó al instante: cedió la ventana a otro proceso del mismo perfil. Si era uno moribundo (la ventana vieja tras una
          // actualización) no queda ninguna ventana, así que se reintenta una vez; si de verdad hay otra ventana viva, no se apaga nada.
          if (attempt === 1) setTimeout(() => open(2), 2500);
          else console.warn('[howler] Edge cedió la ventana del panel a otro proceso; si no ves el panel, abre http://127.0.0.1:' + adminPort + '/#/panel');
        });
      };
      open(1);
    } catch (e) { console.warn('[howler] no se pudo abrir la ventana del panel:', (e as Error).message); }
  };
  const openOwnWindow = (): boolean => {
    if (!own || !existsSync(own)) return false;
    const opened = Date.now();
    let fellBack = false;
    const fallBack = (why: string) => {
      if (fellBack) return;
      fellBack = true;
      panelPid = undefined;
      console.warn(`[howler] la ventana propia no pudo abrirse (${why}); se usa la de Edge`);
      openEdgeWindow();
    };
    try {
      const win = spawn(own, ['--url', url, '--data', join(config.dataDir, 'panel-window'), '--title', 'Howler'], { stdio: 'ignore' });
      panelPid = win.pid;
      win.on('error', (e) => fallBack(e.message));
      win.on('exit', (code) => {
        if (fellBack) return;
        panelPid = undefined;
        // 0 = la persona la cerró: Howler se apaga. Un fallo nada más abrirla (falta WebView2, el motor se cayó…) no debe dejar a Howler sin ventana.
        if (code === 0 || Date.now() - opened > 8000) { void shutdown(); return; }
        fallBack(`código ${code}`);
      });
      return true;
    } catch (e) { fallBack((e as Error).message); return true; }
  };
  if (!openOwnWindow()) openEdgeWindow();
}

// Arrancar el servidor de AC con Howler, si el usuario lo ha pedido en los ajustes.
if (config.server.startWithHowler) {
  const check = checkServerDir(config.serverDir, config.server.exe);
  if (check.ok) {
    try { serverProcess.start(); console.log('[howler] arrancando el servidor de AC…'); } catch (e) { console.warn('[howler] no se pudo arrancar el servidor:', (e as Error).message); }
  } else {
    console.warn('[howler] arranque automático del servidor activado, pero la carpeta del servidor no es válida:', check.problems.join(' '));
  }
}

/** Al cerrar Howler se para el servidor que Howler arrancó, avisando a los jugadores si hay alguien. */
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  const players = tracker.status().online.length > 0;
  await Promise.race([
    serverProcess.stop({
      warnSeconds: players ? config.server.stopWarningSeconds : 0,
      announce: async (s) => { await commander.exec(commands.say(st('El servidor se parará en {n} segundos.', { n: s }))); },
    }),
    new Promise((r) => setTimeout(r, 40_000)),
  ]);
  link.stop();
  pluginLink.stop();
  // La ventana del panel se cierra con Howler: si no, al actualizar queda una ventana vieja abierta junto a la nueva.
  if (panelPid && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(panelPid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
  // Nunca se queda colgado: si algo tarda en cerrar (una conexión abierta, etc.), a los 3 s se sale igualmente.
  await Promise.race([Promise.all([app.close(), adminApp.close()]), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
