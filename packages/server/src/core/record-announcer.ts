import { stm } from './lang';
import { fillTemplate, formatLapTime, type LiveEvent } from '@howler/shared';
import type { Bus } from './bus';
import type { LapRecordScopes } from '../db/record-scopes';

/** Qué récords se anuncian en el chat del servidor; todo apagado = no se avisa de nada. */
export interface AnnounceSettings {
  session: boolean; combo: boolean; global: boolean;
  /** Plantillas propias; vacía o ausente = la de Howler. */
  messages?: Partial<Record<'session' | 'combo' | 'global', string>>;
}

/** Textos por defecto, con los mismos huecos que puede usar el organizador. */
export const DEFAULT_MESSAGES = {
  global: 'Howler: ¡RÉCORD ABSOLUTO de {circuito}! {piloto} {tiempo} ({coche})',
  combo: 'Howler: ¡Récord de {circuito} con {coche}! {piloto} {tiempo}',
  session: 'Howler: nueva mejor vuelta de la sesión: {piloto} {tiempo} ({coche})',
};

/** El mensaje de chat para esta vuelta, o null si no bate ningún récord de los activados. Si bate varios, se anuncia el más importante. */
export function announcementFor(s: LapRecordScopes, on: AnnounceSettings, names: { car: string; track: string }): string | null {
  const tier = on.global && s.global.beaten ? 'global' : on.combo && s.combo.beaten ? 'combo' : on.session && s.session.beaten ? 'session' : null;
  if (!tier) return null;
  const prev = s[tier].prevMs;
  const tpl = on.messages?.[tier]?.trim() || stm(DEFAULT_MESSAGES[tier]);
  return fillTemplate(tpl, {
    piloto: s.driverName, tiempo: formatLapTime(s.lapMs), coche: names.car, circuito: names.track,
    anterior: formatLapTime(prev), mejora: prev != null ? ((prev - s.lapMs) / 1000).toFixed(3) : '',
  });
}

export interface AnnouncerDeps {
  bus: Bus;
  settings: () => AnnounceSettings;
  scopes: (lapId: number) => LapRecordScopes | null;
  say: (msg: string) => void;
  carName: (id: string) => string;
  trackName: (track: string, layout: string) => string;
}

/** Escucha las vueltas nuevas y avisa por el chat del servidor según lo elegido en el panel. */
export function startRecordAnnouncer(d: AnnouncerDeps): () => void {
  return d.bus.on((e: LiveEvent) => {
    if (e.type !== 'lap' || !e.valid) return;
    const on = d.settings();
    if (!on.session && !on.combo && !on.global) return;
    const s = d.scopes(e.lapId);
    if (!s) return;
    const msg = announcementFor(s, on, { car: d.carName(s.car), track: d.trackName(s.track, s.layout) });
    if (msg) d.say(msg);
  });
}
