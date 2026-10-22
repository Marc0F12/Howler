import { describe, expect, it } from 'vitest';
import { decodeCommand, decodeServerPacket, encodeCommand, encodeServerEvent, type ServerEvent } from './acsp';
import { formatDelta, formatLapTime } from './time';

const v = { x: 1.5, y: -2, z: 3 };

describe('ACSP codec', () => {
  const events: ServerEvent[] = [
    { kind: 'newConnection', driverName: 'Cuñado 🐒', guid: '76561190000000004', carId: 3, carModel: 'bmw_z4_gt3', carSkin: 'red' },
    { kind: 'carUpdate', carId: 2, pos: v, velocity: v, gear: 4, rpm: 7200, splinePos: 0.25 },
    { kind: 'lapCompleted', carId: 1, lapMs: 83456, cuts: 2, grip: 0.5, leaderboard: [{ carId: 1, timeMs: 83456, laps: 3, completed: false }] },
    { kind: 'collision', carId: 1, otherCarId: 2, speed: 30.5, worldPos: v, relPos: v },
    { kind: 'collision', carId: 1, otherCarId: null, speed: 12.25, worldPos: v, relPos: v },
    {
      kind: 'newSession', protocolVersion: 4, sessionIndex: 0, currentSessionIndex: 0, sessionCount: 2, serverName: 'Academia',
      track: 'ks_vallelunga', trackConfig: 'club', name: 'Race', type: 3, durationMin: 10, laps: 5, waitTime: 60,
      ambientTemp: 20, roadTemp: 30, weather: '3_clear', elapsedMs: 1234,
    },
    { kind: 'carInfo', carId: 0, connected: true, carModel: 'm', carSkin: 's', driverName: 'Marc', driverTeam: '', guid: '1' },
  ];

  it.each(events)('ida y vuelta: $kind', (e) => {
    const out = decodeServerPacket(encodeServerEvent(e));
    expect(out).toMatchObject(e as any);
  });

  it('ignora basura y paquetes truncados', () => {
    expect(decodeServerPacket(Buffer.from([250]))).toBeNull();
    expect(decodeServerPacket(encodeServerEvent(events[2]!).subarray(0, 4))).toBeNull();
  });

  it('órdenes: ida y vuelta', () => {
    for (const c of [
      { kind: 'kick', carId: 5 },
      { kind: 'broadcastChat', message: 'Ñandú ¡Howl!' },
      { kind: 'getSessionInfo', sessionIndex: -1 },
      { kind: 'setPositionInterval', ms: 100 },
    ] as const) expect(decodeCommand(encodeCommand(c))).toEqual(c);
  });
});

describe('formato de tiempos', () => {
  it('vuelta', () => {
    expect(formatLapTime(83456)).toBe('1:23.456');
    expect(formatLapTime(59999)).toBe('59.999');
    expect(formatLapTime(60005)).toBe('1:00.005');
    expect(formatLapTime(null)).toBe('—');
  });
  it('diferencia', () => {
    expect(formatDelta(312)).toBe('+0.312');
    expect(formatDelta(-1050)).toBe('−1.050');
  });
});
