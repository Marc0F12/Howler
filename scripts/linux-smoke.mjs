#!/usr/bin/env node
/**
 * Prueba de humo de Howler de punta a punta: arranca Howler con una configuración de prueba, le conecta el simulador de AssettoServer,
 * consulta la web y el panel y, en Linux/macOS, arranca y para un «servidor de AC» falso (un script) desde el panel.
 * No toca nada fuera de una carpeta temporal. Sale con código 1 si algo falla.
 *
 *   node scripts/linux-smoke.mjs
 *
 * Existe para poder comprobar el soporte de Linux en las máquinas de GitHub Actions, sin tener Linux a mano.
 */
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const WEB = 18420, ADMIN = 18421;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), 'howler-smoke-'));
const serverDir = join(tmp, 'server');
mkdirSync(join(serverDir, 'cfg'), { recursive: true });
writeFileSync(join(serverDir, 'cfg', 'server_cfg.ini'), '[SERVER]\nNAME=Prueba\nFUEL_RATE=100\nDAMAGE_MULTIPLIER=100\nTYRE_WEAR_RATE=100\n\n[PRACTICE]\nNAME=Practice\nTIME=10\nIS_OPEN=1\n\n[RACE]\nNAME=Race\nTIME=0\nLAPS=5\nIS_OPEN=1\nWAIT_TIME=5\n');
// «Servidor de AC» falso: un script que escribe líneas, aguanta y muere con SIGTERM.
const fake = join(serverDir, 'AssettoServer');
writeFileSync(fake, '#!/bin/sh\necho "[00:00:00 INF] Server startup completed"\ntrap "exit 0" TERM INT\nwhile true; do sleep 1; done\n');
if (!WIN) chmodSync(fake, 0o755);

const config = {
  serverDir, dataDir: join(tmp, 'data'),
  http: { host: '127.0.0.1', port: WEB }, admin: { port: ADMIN },
  acsp: { listenPort: 12100, serverPort: 11100, pluginPort: 12101, pluginCommandPort: 12102 },
  server: { exe: 'AssettoServer', preset: '', stopWarningSeconds: 0 },
  profiles: { steamAvatars: false }, updates: { check: false }, backup: { auto: false },
};
const configPath = join(tmp, 'howler.config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

const logs = [];
const procs = [];
function run(cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, shell: WIN, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => logs.push(String(d)));
  p.stderr.on('data', (d) => logs.push(String(d)));
  procs.push(p);
  return p;
}
function killAll() {
  for (const p of procs) {
    try { if (WIN) execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-p.pid, 'SIGKILL'); } catch { /* ya terminó */ }
  }
}

const get = async (port, path, admin = false) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: admin ? { 'X-Howler-Admin': '1' } : {}, signal: AbortSignal.timeout(10_000) });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
};
const post = async (path, body = {}) => {
  const r = await fetch(`http://127.0.0.1:${ADMIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Howler-Admin': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
};
async function until(fn, ms, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* aún no */ } await sleep(step); }
  return null;
}

let failed = false;
try {
  console.log(`Sistema: ${process.platform} · Node ${process.version} · carpeta ${tmp}`);
  run('npm', ['start'], { HOWLER_CONFIG: configPath });
  const up = await until(async () => (await get(WEB, '/api/status')).ok, 90_000, 1000);
  check('Howler arranca y la web responde', !!up);
  if (!up) throw new Error('Howler no arrancó');

  check('el panel responde en su puerto', (await get(ADMIN, '/admin/api/ping', true)).json?.admin === true);
  check('la web pública NO trae las rutas del panel', (await get(WEB, '/admin/api/ping', true)).status === 404);

  const panel = await get(ADMIN, '/admin/api/session-panel', true);
  check('el panel de sesión lee el server_cfg.ini', panel.ok && panel.json?.values?.fuelRate === 100 && panel.json?.sessions?.race?.laps === 5);
  const saved = await post('/admin/api/session-panel', { values: { fuelRate: 50, blankets: true } });
  check('el panel de sesión escribe y vuelve a leer', saved.ok && saved.json?.panel?.values?.fuelRate === 50 && saved.json?.panel?.values?.blankets === true);
  check('deja la copia .howler-prev', existsSync(join(serverDir, 'cfg', 'server_cfg.ini.howler-prev')));
  check('un valor no válido se rechaza sin tocar nada', !(await post('/admin/api/session-panel', { values: { abs: 9 } })).ok);

  const st = await get(ADMIN, '/admin/api/state', true);
  check('el estado del panel reconoce el binario «AssettoServer»', st.ok && st.json?.check?.exe === 'AssettoServer', JSON.stringify(st.json?.check?.exe));
  check('«Abrir la web» no tira Howler en un sistema sin escritorio', (await post('/admin/api/open-web')).ok);

  if (!WIN) {
    const started = await post('/admin/api/server/start');
    check('arrancar el servidor desde el panel', started.ok, started.json?.error ?? '');
    const running = await until(async () => { const s = (await get(ADMIN, '/admin/api/state', true)).json; return s?.server?.state === 'running' || s?.server?.state === 'starting' ? s : null; }, 20_000);
    check('el servidor figura como en marcha', !!running, running?.server?.state);
    let pgrep = false;
    try { execFileSync('pgrep', ['-x', 'AssettoServer'], { stdio: 'ignore' }); pgrep = true; } catch { /* no hay */ }
    check('pgrep ve el proceso del servidor', pgrep);
    const stopped = await post('/admin/api/server/stop');
    check('parar el servidor desde el panel', stopped.ok, stopped.json?.error ?? '');
    const down = await until(async () => (await get(ADMIN, '/admin/api/state', true)).json?.server?.state === 'stopped', 60_000, 1000);
    check('el servidor figura como parado', !!down);
    let gone = true;
    try { execFileSync('pgrep', ['-x', 'AssettoServer'], { stdio: 'ignore' }); gone = false; } catch { /* ya no está */ }
    check('el proceso del servidor desapareció de verdad', gone);
  } else {
    console.log('(En Windows se omite arrancar el «servidor» falso: es un script de shell.)');
  }

  run('npm', ['run', 'sim', '--', '--lap-seconds', '4', '--drivers', '2', '--target', '127.0.0.1:12100', '--listen', '11100']);
  const laps = await until(async () => { const l = (await get(WEB, '/api/laps/recent')).json; return Array.isArray(l) && l.length >= 1 ? l : null; }, 60_000, 1000);
  check('con el simulador conectado Howler registra vueltas', !!laps, laps ? `${laps.length} vueltas` : '');
  const combos = (await get(WEB, '/api/combos')).json;
  check('la web lista combinaciones circuito+coche', Array.isArray(combos) && combos.length >= 1);
} catch (e) {
  failed = true;
  console.log(`ERROR: ${e.message}`);
} finally {
  killAll();
  await sleep(500);
  if (results.some((r) => !r.ok) || failed) {
    console.log('\n--- salida de Howler (últimas líneas) ---');
    console.log(logs.join('').split('\n').slice(-60).join('\n'));
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* en Windows puede estar en uso */ }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} comprobaciones bien`);
process.exit(failed || bad > 0 ? 1 : 0);
