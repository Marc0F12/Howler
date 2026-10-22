import type { SessionId, SettingGroup } from '@howler/shared';

/** Icono de cada grupo del panel de sesión (nombres del set de `brand/icons`). */
export const GROUP_ICON: Record<SettingGroup, string> = {
  conditions: 'grip', assists: 'abs', tyres: 'tyre', race: 'race', general: 'settings', votes: 'vote', ai: 'server', network: 'connections',
};

export const SESSION_ICON: Record<SessionId, string> = { practice: 'practice', qualify: 'qualifying', race: 'race' };

/** Icono de cada ajuste (por su id en `shared/session-spec.ts`). Los que no estén aquí usan el de su grupo. */
export const SETTING_ICON: Record<string, string> = {
  fuelRate: 'fuel', damageMultiplier: 'damage', tyreWearRate: 'tyre',
  dynamicTrack: 'grip', gripStart: 'grip', gripRandomness: 'grip', gripLapGain: 'grip', gripTransfer: 'grip',
  abs: 'abs', tc: 'traction-control', stability: 'stability', autoclutch: 'clutch',
  blankets: 'tyre-heat', tyresOut: 'track-limits', legalTyres: 'tyre',
  startRule: 'start-lights', gasPenaltyOff: 'throttle', extraLap: 'extra-lap', reverseGrid: 'reverse-grid', pitStart: 'pits', pitEnd: 'pits', maxContacts: 'damage',
  sunAngle: 'sunrise', timeMult: 'stopwatch', qualifyWait: 'stopwatch', raceOver: 'finish', resultScreen: 'podium', maxBallast: 'ballast',
  virtualMirror: 'mirror', loopMode: 'loop', pickup: 'pickup',
  kickQuorum: 'kick', voteQuorum: 'vote', voteDuration: 'stopwatch',
  carReset: 'car-reset', sessionVote: 'vote', kickVote: 'kick', kickMinPlayers: 'players-on-track', globalDrs: 'speed', unlimitedP2P: 'power', forceLights: 'night', rainGrip: 'rain',
  sendHz: 'connections', threads: 'server', lobby: 'connections',
};
