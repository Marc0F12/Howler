/**
 * Simulador de AssettoServer: habla el protocolo ACSP con Howler para probar tablas,
 * reglas y avisos sin arrancar Assetto Corsa ni tener a nadie conectado.
 *
 *   npm run sim -- --lap-seconds 20 --drivers 4
 */
import { createSocket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { loadAiLine, pointAt, type AiLine } from './ai-line';
import {
  decodeCommand,
  encodeServerEvent,
  type Command,
  type ServerEvent,
  type SessionInfo,
} from '@howler/shared';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};

const lapSeconds = Number(opt('lap-seconds', '25'));
// --ac <carpeta de Assetto Corsa> --track <id> [--layout <id>]: los coches recorren la línea real de ese circuito.
const acDir = opt('ac', '');
const trackId = opt('track', 'ks_vallelunga');
const layoutId = opt('layout', trackId === 'ks_vallelunga' ? 'club' : '');
// --names "A,B,C": nombres de los pilotos simulados (para capturas públicas sin nombres reales).
const driverCount = Math.min(Number(opt('drivers', '4')), 8);
const [targetHost, targetPort] = opt('target', '127.0.0.1:12000').split(':') as [string, string];
const listenPort = Number(opt('listen', '11000'));
const TICK_MS = 100;

const session: SessionInfo = {
  protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 1,
  serverName: 'Servidor simulado', track: trackId, trackConfig: layoutId, name: 'Practice',
  type: 1, durationMin: 0, laps: 0, waitTime: 0, ambientTemp: 20, roadTemp: 28, weather: '3_clear', elapsedMs: 0,
};

const ROSTER = [
  { name: 'Marc', guid: '76561190000000001', car: 'ks_mazda_mx5_nd', pace: 1.0 },
  { name: 'SapoFarlopero', guid: '76561190000000002', car: 'ks_mazda_mx5_nd', pace: 1.03 },
  { name: 'EstuardLittle', guid: '76561190000000003', car: 'ks_mazda_mx5_nd', pace: 0.99 },
  { name: 'Cuñado', guid: '76561190000000004', car: 'ks_abarth500_assetto_corse', pace: 1.08 },
  { name: 'Lucía', guid: '76561190000000005', car: 'ks_mazda_mx5_nd', pace: 1.01 },
  { name: 'Dani', guid: '76561190000000006', car: 'ks_abarth500_assetto_corse', pace: 1.05 },
  { name: 'Rafa', guid: '76561190000000007', car: 'ks_mazda_mx5_nd', pace: 1.06 },
  { name: 'Noa', guid: '76561190000000008', car: 'ks_abarth500_assetto_corse', pace: 1.02 },
].slice(0, driverCount).map((d, i) => ({ ...d, name: opt('names', '').split(',')[i]?.trim() || d.name }));

interface SimCar {
  id: number;
  def: (typeof ROSTER)[number];
  lapStart: number;
  lapMs: number;
  weights: number[];
  collided: boolean;
  cut: boolean;
  lapsDone: number;
  prevSpeed?: number;
  dv?: number;
  lastTick?: number;
}

// Telemetría de pedales, volante y fuerzas g (lo que mandan el plugin y el script de CSP): --plugin 127.0.0.1:12001 (el puerto del plugin de Howler), --no-telemetry la apaga.
const [pluginHost, pluginPortText] = opt('plugin', '127.0.0.1:12001').split(':') as [string, string];
const pluginPort = Number(pluginPortText);
const withTelemetry = !process.argv.includes('--no-telemetry');
const pluginSocket = createSocket('udp4');
const socket = createSocket('udp4');
const send = (e: ServerEvent) => socket.send(encodeServerEvent(e), Number(targetPort), targetHost);
const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), '[sim]', ...a);

const v0 = { x: 0, y: 0, z: 0 };
const cars: SimCar[] = ROSTER.map((def, id) => ({
  id, def, lapStart: Date.now() - Math.random() * lapSeconds * 600, lapMs: 0, weights: [], collided: false, cut: false, lapsDone: 0,
}));

function planLap(c: SimCar) {
  // Cada vuelta varía un poco, y cada sector su parte, para que haya morados y verdes de verdad.
  c.lapMs = Math.round(lapSeconds * 1000 * c.def.pace * (0.985 + Math.random() * 0.05));
  const w = [0.31, 0.36, 0.33].map((x) => x * (0.97 + Math.random() * 0.06));
  const total = w.reduce((a, b) => a + b, 0);
  c.weights = w.map((x) => x / total);
  c.collided = Math.random() < 0.15;
  c.cut = Math.random() < 0.1;
}

/** Posición en spline para un instante dentro de la vuelta: velocidad constante dentro de cada tercio. */
function splineAt(c: SimCar, elapsed: number): number {
  const f = Math.min(elapsed / c.lapMs, 0.9999);
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    const w = c.weights[i]!;
    if (f <= acc + w) return (i + (f - acc) / w) / 3;
    acc += w;
  }
  return 0.9999;
}

let aiLine: AiLine | null = null;
if (acDir) {
  const file = `${acDir}/content/tracks/${trackId}${layoutId ? '/' + layoutId : ''}/ai/fast_lane.ai`;
  if (existsSync(file)) aiLine = loadAiLine(file);
  else console.warn(`[sim] no encuentro ${file}: los coches no se moverán por el mapa`);
}

/** Posición, velocidad y spline de un coche en un instante de su vuelta. */
function motion(c: SimCar, elapsed: number) {
  const splinePos = splineAt(c, elapsed);
  if (!aiLine) return { pos: v0, velocity: { x: 30, y: 0, z: 0 }, splinePos, speed: 30, signedTurn: 0, dirX: 1, dirZ: 0 };
  const p = pointAt(aiLine, splinePos);
  const mean = aiLine.total / (c.lapMs / 1000); // m/s medio de la vuelta
  // La velocidad baja en las curvas y sube en las rectas (según cuánto gira el trazado alrededor de ese punto); cada piloto lo hace algo distinto.
  const a = pointAt(aiLine, (splinePos + 0.99) % 1), b = pointAt(aiLine, (splinePos + 0.01) % 1);
  const signedTurn = Math.atan2(a.dirX * b.dirZ - a.dirZ * b.dirX, a.dirX * b.dirX + a.dirZ * b.dirZ);
  const turn = Math.abs(signedTurn);
  const grip = 1 - Math.min(0.62, turn * 2.4);
  const style = 1 + 0.05 * Math.sin(splinePos * Math.PI * 14 + c.id * 1.7);
  const speed = mean * 1.25 * grip * style;
  // Cada piloto toma una trazada algo distinta: se abre o se cierra unos metros respecto a la línea de la IA (más en las curvas).
  const lateral = (1.6 + 2.2 * Math.min(1, turn * 6)) * Math.sin(splinePos * Math.PI * 6 + c.id * 2.1) * (c.id % 2 === 0 ? 1 : -1);
  const x = p.x - p.dirZ * lateral, z = p.z + p.dirX * lateral;
  return { pos: { x, y: 15, z }, velocity: { x: p.dirX * speed, y: 0, z: p.dirZ * speed }, splinePos, speed, signedTurn, dirX: p.dirX, dirZ: p.dirZ };
}

/** Marcha y vueltas del motor a partir de la velocidad (km/h), para que las gráficas no salgan planas. */
function drivetrain(kmh: number) {
  const limits = [0, 45, 80, 115, 150, 185];
  let gear = 1;
  for (let i = 1; i < limits.length; i++) if (kmh >= limits[i]!) gear = i + 1;
  const lo = limits[gear - 1]!, hi = limits[gear] ?? 220;
  const rpm = 2600 + 4200 * Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
  return { gear: gear + 1, rpm: Math.round(rpm) }; // ACSP: 0 = marcha atrás, 1 = punto muerto, 2 = 1.ª
}

/**
 * Lo que mandaría el plugin de Howler y el script de CSP de cada jugador: pedales, volante, giro, fuerzas g, deslizamiento y neumáticos.
 * El acelerador y el freno salen de si el coche gana o pierde velocidad.
 */
function telemetry(c: SimCar, m: ReturnType<typeof motion>, dt: number) {
  const prev = c.prevSpeed ?? m.speed;
  c.prevSpeed = m.speed;
  // Aceleración suavizada (si no, el pedal parpadea con cada muestra): media móvil sobre la anterior.
  const dvRaw = dt > 0 ? (m.speed - prev) / dt : 0; // m/s²
  const dv = (c.dv = 0.7 * (c.dv ?? dvRaw) + 0.3 * dvRaw);
  const brake = dv < -0.9 ? Math.min(1, (-dv - 0.9) / 5) : 0;
  const gas = brake > 0 ? 0 : Math.min(1, 0.12 + Math.max(0, dv) * 0.55); // rodando: algo de gas
  const yaw = Math.atan2(m.dirZ, m.dirX);
  const steer = Math.max(0, Math.min(254, Math.round(127 + Math.max(-1, Math.min(1, m.signedTurn * 14)) * 127)));
  const gLong = dv / 9.81;
  const gLat = (m.speed * m.signedTurn * 10) / 9.81 * 0.9;
  const lapFrac = c.lapsDone * 0.04;
  const hot = 74 + Math.min(16, lapFrac * 100) + (brake > 0.6 ? 4 : 0);
  const send2 = (obj: unknown) => pluginSocket.send(Buffer.from(JSON.stringify(obj)), pluginPort, pluginHost);
  send2({ v: 1, t: 'tel', car: c.id, guid: c.def.guid, gas: Math.round(gas * 255), steer, brk: brake > 0.05 ? 1 : 0, yaw });
  send2({
    v: 1, t: 'ctel', car: c.id, guid: c.def.guid, brake, gas, ax: gLat, ay: 1, az: gLong,
    flags: (brake > 0.8 ? 1 : 0) | (gas > 0.95 && m.speed < 22 ? 2 : 0),
    slip: [0, 1, 2, 3].map((k) => -brake * 0.1 - (brake > 0.9 && k < 2 ? 0.05 : 0) + (gas > 0.9 && k > 1 ? 0.04 : 0)),
    load: [3200, 3200, 3600, 3600].map((l) => Math.round(l * (1 + gLong * 0.2) + gLat * 600)),
    pres: [26.1, 26.1, 25.4, 25.4].map((x) => x + lapFrac),
    temp: [hot + 2, hot - 1, hot + 4, hot + 1],
  });
}

function sendConnection(c: SimCar, kind: 'newConnection' | 'connectionClosed' = 'newConnection') {
  send({ kind, driverName: c.def.name, guid: c.def.guid, carId: c.id, carModel: c.def.car, carSkin: 'default' });
}

function onCommand(cmd: Command) {
  switch (cmd.kind) {
    case 'getSessionInfo': send({ kind: 'sessionInfo', ...session }); break;
    case 'getCarInfo': {
      const c = cars[cmd.carId];
      send(c
        ? { kind: 'carInfo', carId: c.id, connected: true, carModel: c.def.car, carSkin: 'default', driverName: c.def.name, driverTeam: '', guid: c.def.guid }
        : { kind: 'carInfo', carId: cmd.carId, connected: false, carModel: '', carSkin: '', driverName: '', driverTeam: '', guid: '' });
      break;
    }
    case 'restartSession':
    case 'nextSession':
      send({ kind: 'endSession', filename: 'sim_results.json' });
      send({ kind: 'newSession', ...session });
      log('sesión reiniciada');
      break;
    default: log('orden recibida:', JSON.stringify(cmd));
  }
}

socket.on('message', (msg) => {
  const cmd = decodeCommand(msg);
  if (cmd) onCommand(cmd);
});

function tick() {
  const now = Date.now();
  for (const c of cars) {
    if (!c.lapMs) planLap(c);
    let elapsed = now - c.lapStart;
    if (elapsed >= c.lapMs) {
      c.lapsDone++;
      if (c.collided) {
        const other = Math.random() < 0.5 ? (c.id + 1) % cars.length : null;
        send({ kind: 'collision', carId: c.id, otherCarId: other === c.id ? null : other, speed: 8 + Math.random() * 60, worldPos: v0, relPos: v0 });
      }
      send({
        kind: 'lapCompleted', carId: c.id, lapMs: c.lapMs, cuts: c.cut ? 1 : 0, grip: 0.98,
        leaderboard: cars.map((o) => ({ carId: o.id, timeMs: o.lapMs, laps: o.lapsDone, completed: false })),
      });
      log(`${c.def.name} ${(c.lapMs / 1000).toFixed(3)}s${c.cut ? ' (corte)' : ''}${c.collided ? ' (choque)' : ''}`);
      c.lapStart += c.lapMs;
      elapsed = now - c.lapStart;
      planLap(c);
    }
    const m = motion(c, elapsed);
    const dt = (now - (c.lastTick ?? now)) / 1000;
    c.lastTick = now;
    if (withTelemetry) telemetry(c, m, dt);
    send({ kind: 'carUpdate', carId: c.id, ...drivetrain(m.speed * 3.6), pos: m.pos, velocity: m.velocity, splinePos: m.splinePos });
  }
}

socket.bind(listenPort, '127.0.0.1', () => {
  log(`escuchando órdenes en udp://127.0.0.1:${listenPort}, enviando a ${targetHost}:${targetPort}`);
  log(`${driverCount} pilotos, vueltas de ~${lapSeconds}s en ${session.track}/${session.trackConfig}`);
  send({ kind: 'version', version: 4 });
  send({ kind: 'newSession', ...session });
  cars.forEach((c) => sendConnection(c));
  setInterval(tick, TICK_MS);
});

process.on('SIGINT', () => {
  cars.forEach((c) => sendConnection(c, 'connectionClosed'));
  setTimeout(() => process.exit(0), 100);
});
