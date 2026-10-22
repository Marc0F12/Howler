import { st, stm } from './lang';
import { formatLapTime, sanitizeTemp, type SessionConditions, type CarPositionDto, type Command, type LapRules, type TimingDto, type OnlineDriver, type ServerEvent, type SessionSummary, type StatusDto } from '@howler/shared';
import type { Repository } from '../db/repository';
import type { Bus } from './bus';
import { interpretSplits, type PluginMessage } from './exact-sectors';
import { judgeWithReview } from './lap-rules';
import { decodeWheelSpeed, encodeTrace, TraceRecorder, type ClientTel, type Telemetry } from './lap-trace';
import { SectorTimer, type CrossLine } from './sector-timer';
import { THIRDS } from './track-sectors';

interface Car {
  carId: number;
  driverId: number;
  guid: string;
  name: string;
  model: string;
  timer: SectorTimer;
  /** Posición y velocidad a lo largo de la vuelta en curso (para el fantasma y la velocidad máxima). */
  trace: TraceRecorder;
  /** Último mensaje de telemetría del plugin (acelerador, freno, volante, giro) y cuándo llegó. */
  tel: (Telemetry & { at: number }) | null;
  /** Lo último que mandó el script de CSP del cliente (si lo tiene). */
  ctel: (ClientTel & { at: number }) | null;
  /** Splits del plugin de la vuelta en curso (índice -> tiempo). */
  splits: Map<number, number>;
  /** Sectores exactos de una vuelta que el plugin avisó antes de que llegara el aviso de vuelta del servidor. */
  exactPending: { lapMs: number; sectors: number[] } | null;
  incidents: { kind: 'car' | 'env'; speed: number; relSpeed: number | null; otherDriverId: number | null }[];
  /** Última velocidad (m/s en el plano del mapa) y cuándo llegó: para medir la velocidad relativa en un choque entre coches. */
  vel: { x: number; z: number; at: number } | null;
  /** Última posición recibida (mundo X/Z) y velocidad en km/h, para el mapa en directo. */
  pos: { x: number; z: number; speedKmh: number } | null;
}

export interface TrackerDeps {
  repo: Repository;
  bus: Bus;
  /** Envía una orden al servidor de AC. */
  send: (c: Command) => void;
  now?: () => number;
  positionIntervalMs: number;
  /** Adelanto (m) del punto de medida de los cruces de línea; ver config.acsp.referenceOffsetM. */
  referenceOffsetM?: number;
  /** Se llama al terminar una sesión, con el archivo de resultados que indica el servidor. */
  onSessionEnd?: (session: SessionSummary, resultsFile: string) => void;
  /** Reglas de vuelta válida de un circuito; por defecto, solo cortes. */
  rulesFor?: (track: string, layout: string) => LapRules;
  /** Combustible, daños y desgaste del servidor ahora mismo (del preset); se anotan al empezar cada sesión. */
  conditionsNow?: () => SessionConditions | null;
  /** Fronteras de sector del circuito en juego; por defecto, tercios. */
  sectorsFor?: (track: string, layout: string) => { bounds: number[]; origin: number; lines?: CrossLine[] };
}

const MAX_CARS = 32;
const STALE_MS = 15_000;
const PLUGIN_STALE_MS = 15_000;
/** Cada cuánto se pregunta por la sesión: con el servidor vacío AC no manda nada y, sin esto, parecería caído. */
const POLL_MS = 5_000;

/**
 * Traduce los eventos del servidor en estado y vueltas guardadas.
 * No sabe nada de UDP ni de HTTP: recibe eventos y emite órdenes por `send`.
 */
export class Tracker {
  private cars = new Map<number, Car>();
  private session: SessionSummary | null = null;
  private sectorLayout: { bounds: number[]; origin: number; lines?: CrossLine[] } = { bounds: THIRDS, origin: 0 };
  private lastPacketAt = 0;
  private lastPluginAt = 0;
  private lastPollAt = 0;
  private wasConnected = false;
  private wasPluginAlive = false;
  private now: () => number;

  constructor(private d: TrackerDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Vuelve a pedir los datos de la sesión (temperaturas y clima cambian durante la sesión y el servidor solo los manda al empezar). */
  refreshSessionInfo() {
    this.d.send({ kind: 'getSessionInfo', sessionIndex: -1 });
  }

  /** Pide al servidor lo que Howler se perdió si arrancó después que él. */
  sync() {
    this.d.send({ kind: 'setPositionInterval', ms: this.d.positionIntervalMs });
    this.d.send({ kind: 'getSessionInfo', sessionIndex: -1 });
    for (let i = 0; i < MAX_CARS; i++) this.d.send({ kind: 'getCarInfo', carId: i });
  }

  handle(e: ServerEvent) {
    this.lastPacketAt = this.now();
    this.refreshConnection();
    switch (e.kind) {
      case 'newSession':
        this.noteTemps(e);
        this.startSession(e);
        // El servidor puede olvidar el intervalo al cambiar de sesión.
        this.d.send({ kind: 'setPositionInterval', ms: this.d.positionIntervalMs });
        break;
      case 'sessionInfo':
        this.noteTemps(e);
        if (!this.session || this.session.track !== (e.track.split('/').pop() || e.track) || this.session.layout !== e.trackConfig) this.startSession(e);
        break;
      case 'endSession':
        if (this.session) {
          this.d.repo.endSession(this.session.id);
          this.d.onSessionEnd?.(this.session, e.filename);
        }
        break;
      case 'newConnection':
        this.addCar(e.carId, e.guid, e.driverName, e.carModel);
        break;
      case 'carInfo':
        if (e.connected) this.addCar(e.carId, e.guid, e.driverName, e.carModel);
        break;
      case 'connectionClosed':
        this.cars.delete(e.carId);
        this.d.bus.emit({ type: 'status' });
        break;
      case 'carUpdate': {
        const car = this.cars.get(e.carId);
        if (!car) break;
        car.timer.update(e.splinePos, this.now(), this.referencePoint(e));
        car.vel = { x: e.velocity.x, z: e.velocity.z, at: this.now() };
        car.trace.push(this.now(), e.pos.x, e.pos.z, e.velocity.x, e.velocity.z, e.gear, e.rpm, car.tel && this.now() - car.tel.at <= 300 ? car.tel : null, car.ctel && this.now() - car.ctel.at <= 600 ? car.ctel : null);
        car.pos = { x: e.pos.x, z: e.pos.z, speedKmh: Math.hypot(e.velocity.x, e.velocity.z) * 3.6 };
        break;
      }
      case 'collision':
        this.onCollision(e);
        break;
      case 'lapCompleted':
        this.onLap(e);
        break;
    }
  }

  /** Mensaje del plugin HowlerPlugin: sectores exactos medidos por el juego de cada piloto. */
  handlePlugin(m: PluginMessage) {
    const wasAlive = this.pluginAlive();
    this.lastPluginAt = this.now();
    if (!wasAlive) this.d.bus.emit({ type: 'status' });
    if (m.t === 'hello') return;

    const car = this.cars.get(m.car);
    if (!car || car.guid !== m.guid) return; // coche desconocido o ya cambió de piloto
    if (m.t === 'tel') {
      car.tel = { gas: m.gas / 255, brake: m.brk, steer: Math.max(-1, Math.min(1, (m.steer - 127) / 127)), yaw: m.yaw, ...(m.tyre ? { wheels: m.tyre.map(decodeWheelSpeed) } : {}), at: this.now() };
      return;
    }
    if (m.t === 'ctel') {
      car.ctel = { brake: m.brake, ax: m.ax, az: m.az, flags: m.flags, slip: m.slip, pres: m.pres, temp: m.temp, at: this.now() };
      return;
    }
    if (m.t === 'split') {
      // Un índice repetido o menor significa que empezó otra vuelta sin que llegara el cierre de la anterior.
      if ([...car.splits.keys()].some((k) => k >= m.i)) car.splits.clear();
      car.splits.set(m.i, m.ms);
      return;
    }
    this.onExactLap(car, m.ms);
  }

  private onExactLap(car: Car, lapMs: number) {
    const raw = [...car.splits.entries()];
    const sectors = interpretSplits(car.splits, lapMs, this.sectorLayout.bounds.length + 1);
    car.splits = new Map();
    if (!sectors) {
      if (process.env.HOWLER_DEBUG === '1') console.log('[plugin] splits no interpretables', JSON.stringify({ lapMs, raw }));
      return;
    }
    const session = this.session;
    const stored = session ? this.d.repo.lapsByTime(session.id, car.driverId, lapMs).find((l) => !l.exact) : undefined;
    if (stored) {
      this.d.repo.setExactSectors(stored.id, sectors);
      this.d.bus.emit({ type: 'results' });
    } else {
      car.exactPending = { lapMs, sectors }; // el aviso de vuelta del servidor aún no llegó
    }
  }

  private pluginAlive() {
    return this.lastPluginAt > 0 && this.now() - this.lastPluginAt < PLUGIN_STALE_MS;
  }

  /** Llamar periódicamente: detecta cuando el servidor o el plugin dejan de dar señales. */
  tick() {
    if (this.now() - this.lastPollAt >= POLL_MS) {
      this.lastPollAt = this.now();
      this.d.send({ kind: 'getSessionInfo', sessionIndex: -1 });
    }
    this.refreshConnection();
    const alive = this.pluginAlive();
    if (alive !== this.wasPluginAlive) {
      this.wasPluginAlive = alive;
      this.d.bus.emit({ type: 'status' });
    }
  }

  private connected() {
    return this.now() - this.lastPacketAt < STALE_MS && this.lastPacketAt > 0;
  }

  private refreshConnection() {
    const c = this.connected();
    if (c !== this.wasConnected) {
      this.wasConnected = c;
      if (!c) {
        // El servidor desapareció sin avisar (apagado a la fuerza): nadie sigue en pista y la sesión terminó.
        // Al volver, AC manda de nuevo la sesión y las conexiones.
        this.cars.clear();
        if (this.session) this.d.repo.endSession(this.session.id);
        this.session = null;
      } else {
        // Vuelve la señal: se vuelve a preguntar por la sesión y por cada coche (si no, los que ya estaban conectados no se reconocerían hasta reconectar).
        this.sync();
      }
      this.d.bus.emit({ type: 'status' });
    }
  }

  status(): StatusDto {
    const online: OnlineDriver[] = [...this.cars.values()].map((c) => ({
      carId: c.carId, driverId: c.driverId, name: c.name, car: c.model,
    }));
    return { acConnected: this.connected(), exactSectors: this.pluginAlive(), session: this.session, online };
  }

  /**
   * La sesión que enseña el Inicio: la que está en curso si hay alguien conectado o ya tiene vueltas; si no
   * (servidor parado o recién reiniciado y vacío), la última en la que se corrió.
   */
  focusSession() {
    const cur = this.session;
    if (cur && (this.cars.size > 0 || this.d.repo.sessionHasLaps(cur.id))) return cur;
    return this.d.repo.latestSessionWithLaps() ?? cur;
  }

  /** Clasificación de la sesión que se enseña (los conectados solo cuentan si es la sesión en curso). */
  timing(): TimingDto {
    const s = this.focusSession();
    return this.d.repo.sessionTiming(s, s && s.id === this.session?.id ? this.status().online : []);
  }

  /** Posición de los coches que están en pista (para el mapa en directo). */
  positions(): CarPositionDto[] {
    return [...this.cars.values()]
      .filter((c) => c.pos)
      .map((c) => ({ carId: c.carId, driverId: c.driverId, x: c.pos!.x, z: c.pos!.z, speedKmh: Math.round(c.pos!.speedKmh) }));
  }

  /** Últimas temperaturas que mandó el servidor (aire y pista, °C): se anotan en cada vuelta que se da desde entonces. */
  private temps: { air: number | null; track: number | null } = { air: null, track: null };
  /** Último clima que dijo el servidor (carpeta de clima o tipo de CSP): se anota en cada vuelta. */
  private weather: string | null = null;
  private noteTemps(e: { ambientTemp: number; roadTemp: number; weather?: string }) {
    this.weather = e.weather?.trim() ? e.weather.trim().slice(0, 80) : this.weather;
    // 0 y 0 es lo que manda un servidor que no informa del clima: no se toma por una medida
    this.temps = e.ambientTemp === 0 && e.roadTemp === 0 ? { air: null, track: null } : { air: sanitizeTemp(e.ambientTemp), track: sanitizeTemp(e.roadTemp) };
  }

  private startSession(e: { track: string; trackConfig: string; name: string; type: number }) {
    if (this.session) this.d.repo.endSession(this.session.id);
    // AssettoServer manda rutas CSP tipo "csp/3465/../D/../leroy_gandia": solo importa el último tramo.
    const track = e.track.split('/').pop() || e.track;
    this.session = this.d.repo.createSession({ track, layout: e.trackConfig, name: e.name, type: e.type, conditions: this.d.conditionsNow?.() ?? null });
    this.sectorLayout = this.d.sectorsFor?.(track, e.trackConfig) ?? { bounds: THIRDS, origin: 0 };
    for (const c of this.cars.values()) {
      c.timer = this.newTimer();
      c.trace.reset();
      c.incidents = [];
      c.splits = new Map();
      c.exactPending = null;
    }
    this.d.bus.emit({ type: 'session' });
  }

  /** Punto del coche con el que se detectan los cruces: la posición del paquete adelantada en el sentido de la marcha. */
  private referencePoint(e: Extract<ServerEvent, { kind: 'carUpdate' }>) {
    const speed = Math.hypot(e.velocity.x, e.velocity.z);
    const k = speed > 1 ? (this.d.referenceOffsetM ?? 0) / speed : 0;
    return { x: e.pos.x + e.velocity.x * k, z: e.pos.z + e.velocity.z * k };
  }

  private newTimer() {
    const { bounds, origin, lines } = this.sectorLayout;
    const debug = process.env.HOWLER_DEBUG === '1' ? (m: string) => console.log('[sectores] vuelta sin sectores:', m) : undefined;
    return new SectorTimer(bounds, origin, lines ?? null, debug);
  }

  private addCar(carId: number, guid: string, name: string, model: string) {
    if (!guid) return;
    const driverId = this.d.repo.upsertDriver(guid, name);
    const prev = this.cars.get(carId);
    if (prev && prev.driverId === driverId) {
      prev.name = name;
      prev.model = model;
    } else {
      this.cars.set(carId, { carId, driverId, guid, name, model, timer: this.newTimer(), trace: new TraceRecorder(), vel: null, tel: null, ctel: null, incidents: [], splits: new Map(), exactPending: null, pos: null });
    }
    this.d.bus.emit({ type: 'status' });
  }

  private onCollision(e: Extract<ServerEvent, { kind: 'collision' }>) {
    const car = this.cars.get(e.carId);
    if (!car) return;
    const other = e.otherCarId == null ? null : (this.cars.get(e.otherCarId)?.driverId ?? null);
    // Entre coches, la velocidad que manda el juego puede ser la del propio coche: se mide también la RELATIVA con las
    // últimas velocidades conocidas de los dos (si son recientes). Dos coches que van juntos a 120 km/h y se rozan no chocan a 120.
    const otherCar = e.otherCarId == null ? null : this.cars.get(e.otherCarId);
    const fresh = (v: Car['vel']) => v != null && this.now() - v.at <= 500;
    const relSpeed = car.vel && otherCar?.vel && fresh(car.vel) && fresh(otherCar.vel)
      ? Math.hypot(car.vel.x - otherCar.vel.x, car.vel.z - otherCar.vel.z) * 3.6
      : null;
    car.incidents.push({ kind: e.otherCarId == null ? 'env' : 'car', speed: e.speed, relSpeed, otherDriverId: other });
  }

  private onLap(e: Extract<ServerEvent, { kind: 'lapCompleted' }>) {
    const car = this.cars.get(e.carId);
    const session = this.session;
    const sectors = car?.timer.takeLap(e.lapMs);
    if (!car || !session) return;
    const incidents = car.incidents;
    car.incidents = [];
    const rules = this.d.rulesFor?.(session.track, session.layout);
    // Si el plugin ya mandó los sectores exactos de esta vuelta, se guardan directamente.
    const exact = car.exactPending?.lapMs === e.lapMs ? car.exactPending.sectors : null;
    car.exactPending = null;
    const cut = car.trace.cut(this.now(), e.lapMs);
    const trace = cut.trace;
    let outLap = cut.outLap;
    if (outLap) {
      // Si Howler se reinició a mitad de sesión, esta primera vuelta que ve es una vuelta normal de pista: con un tiempo
      // razonable (como mucho un 15 % peor que el mejor de la combinación) no se trata como salida de boxes.
      const ref = this.d.repo.comboBestMs(session.track, session.layout, car.model);
      if (ref != null && e.lapMs <= ref * 1.15) outLap = false;
    }
    // Válida, nula (la anulan las reglas) o pendiente de revisión (salida de boxes que las reglas no anulan).
    const verdict = judgeWithReview({ lapMs: e.lapMs, cuts: e.cuts, incidents }, rules, outLap);
    const lapId = this.d.repo.insertLap(
      {
        sessionId: session.id,
        driverId: car.driverId,
        track: session.track,
        layout: session.layout,
        car: car.model,
        lapMs: e.lapMs,
        sectorsMs: exact ?? sectors ?? [],
        sectorsExact: exact != null,
        cuts: e.cuts,
        grip: e.grip,
        valid: verdict.valid,
        invalidReason: verdict.reason,
        maxSpeedKmh: trace?.maxSpeedKmh ?? null,
        outLap,
        pending: verdict.pending,
        tempAir: this.temps.air,
        tempTrack: this.temps.track,
        weather: this.weather,
      },
      incidents,
    );
    // La traza solo se guarda para vueltas válidas (no para nulas ni pendientes); de cada combinación se conserva la mejor de cada piloto.
    // (y solo si es la mejor de ese piloto con ese coche: las demás se borrarían al instante)
    if (trace && verdict.valid && this.d.repo.isPersonalBest(lapId)) {
      this.d.repo.saveTrace(lapId, trace.samples.t.length, encodeTrace(trace.samples));
      this.d.repo.pruneTraces(session.track, session.layout, car.model);
    }
    if (!verdict.valid && !verdict.pending && rules?.notifyDriver) {
      this.d.send({ kind: 'sendChat', carId: car.carId, message: `${st('Howler: vuelta {time} anulada.', { time: formatLapTime(e.lapMs) })} ${verdict.reason ? stm(verdict.reason) : ''}`.trim() });
    }
    this.d.bus.emit({ type: 'lap', lapId, valid: verdict.valid, sessionId: session.id, driverId: car.driverId, track: session.track, layout: session.layout, car: car.model });
  }
}
