/**
 * Protocolo UDP de plugins de Assetto Corsa (ACSP), el que habla AssettoServer
 * con EnableLegacyPluginInterface. Little-endian.
 *  - string  : 1 byte de longitud + bytes UTF-8
 *  - wstring : 1 byte de longitud (caracteres) + UTF-32LE
 * Un solo módulo con ambos sentidos para que el simulador y Howler no diverjan.
 */

export const ServerPacket = {
  NEW_SESSION: 50,
  NEW_CONNECTION: 51,
  CONNECTION_CLOSED: 52,
  CAR_UPDATE: 53,
  CAR_INFO: 54,
  END_SESSION: 55,
  VERSION: 56,
  CHAT: 57,
  CLIENT_LOADED: 58,
  SESSION_INFO: 59,
  ERROR: 60,
  LAP_COMPLETED: 73,
  CLIENT_EVENT: 130,
} as const;

export const CommandPacket = {
  REALTIME_POS_INTERVAL: 200,
  GET_CAR_INFO: 201,
  SEND_CHAT: 202,
  BROADCAST_CHAT: 203,
  GET_SESSION_INFO: 204,
  SET_SESSION_INFO: 205,
  KICK_USER: 206,
  NEXT_SESSION: 207,
  RESTART_SESSION: 208,
  ADMIN_COMMAND: 209,
} as const;

const CE_COLLISION_WITH_CAR = 10;
const CE_COLLISION_WITH_ENV = 11;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SessionInfo {
  protocolVersion: number;
  sessionIndex: number;
  currentSessionIndex: number;
  sessionCount: number;
  serverName: string;
  track: string;
  trackConfig: string;
  name: string;
  /** 1 práctica, 2 clasificación, 3 carrera. */
  type: number;
  durationMin: number;
  laps: number;
  waitTime: number;
  ambientTemp: number;
  roadTemp: number;
  weather: string;
  elapsedMs: number;
}

export interface LeaderboardEntry {
  carId: number;
  timeMs: number;
  laps: number;
  completed: boolean;
}

export type ServerEvent =
  | ({ kind: 'newSession' } & SessionInfo)
  | ({ kind: 'sessionInfo' } & SessionInfo)
  | { kind: 'newConnection' | 'connectionClosed'; driverName: string; guid: string; carId: number; carModel: string; carSkin: string }
  | { kind: 'carUpdate'; carId: number; pos: Vec3; velocity: Vec3; gear: number; rpm: number; splinePos: number }
  | { kind: 'carInfo'; carId: number; connected: boolean; carModel: string; carSkin: string; driverName: string; driverTeam: string; guid: string }
  | { kind: 'endSession'; filename: string }
  | { kind: 'version'; version: number }
  | { kind: 'chat'; carId: number; message: string }
  | { kind: 'clientLoaded'; carId: number }
  | { kind: 'lapCompleted'; carId: number; lapMs: number; cuts: number; leaderboard: LeaderboardEntry[]; grip: number }
  | { kind: 'collision'; carId: number; otherCarId: number | null; speed: number; worldPos: Vec3; relPos: Vec3 }
  | { kind: 'error'; message: string };

export type Command =
  | { kind: 'setPositionInterval'; ms: number }
  | { kind: 'getCarInfo'; carId: number }
  | { kind: 'sendChat'; carId: number; message: string }
  | { kind: 'broadcastChat'; message: string }
  | { kind: 'getSessionInfo'; sessionIndex: number }
  | { kind: 'kick'; carId: number }
  | { kind: 'nextSession' }
  | { kind: 'restartSession' }
  | { kind: 'admin'; command: string };

class Reader {
  private o = 0;
  constructor(private b: Buffer) {}
  u8() { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  vec3(): Vec3 { return { x: this.f32(), y: this.f32(), z: this.f32() }; }
  str() { const n = this.u8(); const v = this.b.toString('utf8', this.o, this.o + n); this.o += n; return v; }
  wstr() { const n = this.u8(); const v = decodeUtf32(this.b, this.o, n); this.o += n * 4; return v; }
  /**
   * Texto en UTF-8 o UTF-32 según lo que haya. Kunos y AssettoServer no coinciden en qué campos
   * son anchos (el modelo de coche en CAR_INFO llega en UTF-32), así que se detecta por los ceros.
   */
  anyStr() {
    const n = this.b.readUInt8(this.o);
    let wide = n > 0 && this.o + 1 + n * 4 <= this.b.length;
    for (let i = 0; wide && i < n; i++) {
      const at = this.o + 1 + i * 4;
      wide = this.b[at] !== 0 && this.b[at + 1] === 0 && this.b[at + 2] === 0 && this.b[at + 3] === 0;
    }
    return wide ? this.wstr() : this.str();
  }
}

function decodeUtf32(b: Buffer, offset: number, chars: number): string {
  let s = '';
  for (let i = 0; i < chars; i++) s += String.fromCodePoint(b.readUInt32LE(offset + i * 4));
  return s;
}

class Writer {
  private parts: Buffer[] = [];
  private push(n: number, fn: (b: Buffer) => void) { const b = Buffer.alloc(n); fn(b); this.parts.push(b); return this; }
  u8(v: number) { return this.push(1, (b) => b.writeUInt8(v)); }
  u16(v: number) { return this.push(2, (b) => b.writeUInt16LE(v)); }
  i16(v: number) { return this.push(2, (b) => b.writeInt16LE(v)); }
  u32(v: number) { return this.push(4, (b) => b.writeUInt32LE(v)); }
  i32(v: number) { return this.push(4, (b) => b.writeInt32LE(v)); }
  f32(v: number) { return this.push(4, (b) => b.writeFloatLE(v)); }
  vec3(v: Vec3) { return this.f32(v.x).f32(v.y).f32(v.z); }
  str(s: string) { const d = Buffer.from(s, 'utf8'); return this.u8(d.length).raw(d); }
  wstr(s: string) {
    const cps = Array.from(s);
    this.u8(cps.length);
    for (const c of cps) this.u32(c.codePointAt(0)!);
    return this;
  }
  raw(b: Buffer) { this.parts.push(b); return this; }
  done() { return Buffer.concat(this.parts); }
}

function readSession(r: Reader): SessionInfo {
  return {
    protocolVersion: r.u8(),
    sessionIndex: r.u8(),
    currentSessionIndex: r.u8(),
    sessionCount: r.u8(),
    serverName: r.wstr(),
    track: r.str(),
    trackConfig: r.str(),
    name: r.str(),
    type: r.u8(),
    durationMin: r.u16(),
    laps: r.u16(),
    waitTime: r.u16(),
    ambientTemp: r.u8(),
    roadTemp: r.u8(),
    weather: r.str(),
    elapsedMs: r.i32(),
  };
}

function writeSession(w: Writer, s: SessionInfo) {
  w.u8(s.protocolVersion).u8(s.sessionIndex).u8(s.currentSessionIndex).u8(s.sessionCount)
    .wstr(s.serverName).str(s.track).str(s.trackConfig).str(s.name)
    .u8(s.type).u16(s.durationMin).u16(s.laps).u16(s.waitTime)
    .u8(s.ambientTemp).u8(s.roadTemp).str(s.weather).i32(s.elapsedMs);
}

/** Decodifica un datagrama servidor -> plugin. Devuelve null si no se reconoce o está truncado. */
export function decodeServerPacket(buf: Buffer): ServerEvent | null {
  if (buf.length < 1) return null;
  try {
    const r = new Reader(buf);
    const id = r.u8();
    switch (id) {
      case ServerPacket.NEW_SESSION: return { kind: 'newSession', ...readSession(r) };
      case ServerPacket.SESSION_INFO: return { kind: 'sessionInfo', ...readSession(r) };
      case ServerPacket.NEW_CONNECTION:
      case ServerPacket.CONNECTION_CLOSED:
        return {
          kind: id === ServerPacket.NEW_CONNECTION ? 'newConnection' : 'connectionClosed',
          driverName: r.wstr(), guid: r.wstr(), carId: r.u8(), carModel: r.anyStr(), carSkin: r.anyStr(),
        };
      case ServerPacket.CAR_UPDATE:
        return { kind: 'carUpdate', carId: r.u8(), pos: r.vec3(), velocity: r.vec3(), gear: r.u8(), rpm: r.u16(), splinePos: r.f32() };
      case ServerPacket.CAR_INFO:
        return { kind: 'carInfo', carId: r.u8(), connected: r.u8() !== 0, carModel: r.anyStr(), carSkin: r.anyStr(), driverName: r.wstr(), driverTeam: r.wstr(), guid: r.wstr() };
      case ServerPacket.END_SESSION: return { kind: 'endSession', filename: r.str() };
      case ServerPacket.VERSION: return { kind: 'version', version: r.u8() };
      case ServerPacket.CHAT: return { kind: 'chat', carId: r.u8(), message: r.wstr() };
      case ServerPacket.CLIENT_LOADED: return { kind: 'clientLoaded', carId: r.u8() };
      case ServerPacket.ERROR: return { kind: 'error', message: r.wstr() };
      case ServerPacket.LAP_COMPLETED: {
        const carId = r.u8();
        const lapMs = r.u32();
        const cuts = r.u8();
        const n = r.u8();
        const leaderboard: LeaderboardEntry[] = [];
        for (let i = 0; i < n; i++) leaderboard.push({ carId: r.u8(), timeMs: r.u32(), laps: r.u16(), completed: r.u8() !== 0 });
        return { kind: 'lapCompleted', carId, lapMs, cuts, leaderboard, grip: r.f32() };
      }
      case ServerPacket.CLIENT_EVENT: {
        const type = r.u8();
        if (type !== CE_COLLISION_WITH_CAR && type !== CE_COLLISION_WITH_ENV) return null;
        const carId = r.u8();
        const otherCarId = type === CE_COLLISION_WITH_CAR ? r.u8() : null;
        return { kind: 'collision', carId, otherCarId, speed: r.f32(), worldPos: r.vec3(), relPos: r.vec3() };
      }
      default: return null;
    }
  } catch {
    return null;
  }
}

/** Codifica un evento servidor -> plugin (lo usa el simulador y los tests). */
export function encodeServerEvent(e: ServerEvent): Buffer {
  const w = new Writer();
  switch (e.kind) {
    case 'newSession': w.u8(ServerPacket.NEW_SESSION); writeSession(w, e); break;
    case 'sessionInfo': w.u8(ServerPacket.SESSION_INFO); writeSession(w, e); break;
    case 'newConnection':
    case 'connectionClosed':
      w.u8(e.kind === 'newConnection' ? ServerPacket.NEW_CONNECTION : ServerPacket.CONNECTION_CLOSED)
        .wstr(e.driverName).wstr(e.guid).u8(e.carId).str(e.carModel).str(e.carSkin);
      break;
    case 'carUpdate':
      w.u8(ServerPacket.CAR_UPDATE).u8(e.carId).vec3(e.pos).vec3(e.velocity).u8(e.gear).u16(e.rpm).f32(e.splinePos);
      break;
    case 'carInfo':
      w.u8(ServerPacket.CAR_INFO).u8(e.carId).u8(e.connected ? 1 : 0).wstr(e.carModel).wstr(e.carSkin)
        .wstr(e.driverName).wstr(e.driverTeam).wstr(e.guid);
      break;
    case 'endSession': w.u8(ServerPacket.END_SESSION).str(e.filename); break;
    case 'version': w.u8(ServerPacket.VERSION).u8(e.version); break;
    case 'chat': w.u8(ServerPacket.CHAT).u8(e.carId).wstr(e.message); break;
    case 'clientLoaded': w.u8(ServerPacket.CLIENT_LOADED).u8(e.carId); break;
    case 'error': w.u8(ServerPacket.ERROR).wstr(e.message); break;
    case 'lapCompleted':
      w.u8(ServerPacket.LAP_COMPLETED).u8(e.carId).u32(e.lapMs).u8(e.cuts).u8(e.leaderboard.length);
      for (const l of e.leaderboard) w.u8(l.carId).u32(l.timeMs).u16(l.laps).u8(l.completed ? 1 : 0);
      w.f32(e.grip);
      break;
    case 'collision':
      w.u8(ServerPacket.CLIENT_EVENT).u8(e.otherCarId == null ? CE_COLLISION_WITH_ENV : CE_COLLISION_WITH_CAR).u8(e.carId);
      if (e.otherCarId != null) w.u8(e.otherCarId);
      w.f32(e.speed).vec3(e.worldPos).vec3(e.relPos);
      break;
  }
  return w.done();
}

/** Codifica una orden plugin -> servidor. */
export function encodeCommand(c: Command): Buffer {
  const w = new Writer();
  switch (c.kind) {
    case 'setPositionInterval': w.u8(CommandPacket.REALTIME_POS_INTERVAL).u16(c.ms); break;
    case 'getCarInfo': w.u8(CommandPacket.GET_CAR_INFO).u8(c.carId); break;
    case 'sendChat': w.u8(CommandPacket.SEND_CHAT).u8(c.carId).wstr(c.message); break;
    case 'broadcastChat': w.u8(CommandPacket.BROADCAST_CHAT).wstr(c.message); break;
    case 'getSessionInfo': w.u8(CommandPacket.GET_SESSION_INFO).i16(c.sessionIndex); break;
    case 'kick': w.u8(CommandPacket.KICK_USER).u8(c.carId); break;
    case 'nextSession': w.u8(CommandPacket.NEXT_SESSION); break;
    case 'restartSession': w.u8(CommandPacket.RESTART_SESSION); break;
    case 'admin': w.u8(CommandPacket.ADMIN_COMMAND).wstr(c.command); break;
  }
  return w.done();
}

/** Decodifica una orden plugin -> servidor (lo usa el simulador). */
export function decodeCommand(buf: Buffer): Command | null {
  if (buf.length < 1) return null;
  try {
    const r = new Reader(buf);
    switch (r.u8()) {
      case CommandPacket.REALTIME_POS_INTERVAL: return { kind: 'setPositionInterval', ms: r.u16() };
      case CommandPacket.GET_CAR_INFO: return { kind: 'getCarInfo', carId: r.u8() };
      case CommandPacket.SEND_CHAT: return { kind: 'sendChat', carId: r.u8(), message: r.wstr() };
      case CommandPacket.BROADCAST_CHAT: return { kind: 'broadcastChat', message: r.wstr() };
      case CommandPacket.GET_SESSION_INFO: return { kind: 'getSessionInfo', sessionIndex: r.i16() };
      case CommandPacket.KICK_USER: return { kind: 'kick', carId: r.u8() };
      case CommandPacket.NEXT_SESSION: return { kind: 'nextSession' };
      case CommandPacket.RESTART_SESSION: return { kind: 'restartSession' };
      case CommandPacket.ADMIN_COMMAND: return { kind: 'admin', command: r.wstr() };
      default: return null;
    }
  } catch {
    return null;
  }
}
