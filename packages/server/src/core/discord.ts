import { st, stm } from './lang';
import {
  DISCORD_EVENTS, fillTemplate, formatLapTime,
  type DiscordEventDef, type DiscordEventId, type DiscordEventSetting, type LiveEvent, type OnlineDriver, type SessionSummary,
} from '@howler/shared';
import type { Bus } from './bus';
import type { LapRecordScopes } from '../db/record-scopes';

export interface DiscordSettings {
  webhookUrl: string;
  webhooks?: { id: string; name: string; url: string }[];
  serverName?: string;
  /** Dirección pública de la web de Howler, para poner un enlace en los avisos (opcional). */
  publicUrl: string;
  events: Partial<Record<DiscordEventId, DiscordEventSetting>>;
}

/** Solo se aceptan enlaces de webhooks de Discord: así el panel no puede usarse para llamar a otras direcciones. */
const WEBHOOK = /^https:\/\/(?:(?:ptb\.|canary\.)?discord(?:app)?\.com)\/api\/(?:v\d+\/)?webhooks\/\d{5,25}\/[\w-]{20,200}\/?$/;
export const isDiscordWebhook = (url: string) => WEBHOOK.test(url);

export interface DiscordMessage {
  embeds: { title: string; description?: string; color: number; url?: string; timestamp?: string; footer?: { text: string } }[];
}

export interface Webhook { id: string; name: string; url: string }
/** Todos los canales a los que avisar: el principal (`main`) y los añadidos. */
export function webhooksOf(s: Pick<DiscordSettings, 'webhookUrl' | 'webhooks'>): Webhook[] {
  return [...(s.webhookUrl ? [{ id: 'main', name: 'Principal', url: s.webhookUrl }] : []), ...(s.webhooks ?? []).filter((w) => w.url)];
}

const def = (id: DiscordEventId) => DISCORD_EVENTS.find((e) => e.id === id)!;
const isOn = (d: DiscordEventDef, s: DiscordSettings) => s.events[d.id]?.enabled ?? d.defaultEnabled;

/** El aviso ya con título, mensaje (el propio o el de Howler) y huecos rellenos. */
export function renderEvent(id: DiscordEventId, s: DiscordSettings, values: Record<string, string>): DiscordMessage {
  const d = def(id);
  const mine = s.events[id];
  const title = mine?.title?.trim() || stm(d.defaultTitle);
  const message = mine?.message?.trim() || stm(d.defaultMessage);
  return {
    embeds: [{
      title: fillTemplate(title, values).slice(0, 250),
      description: fillTemplate(message, values).slice(0, 2000),
      color: parseInt(d.color.slice(1), 16),
      ...(s.publicUrl ? { url: s.publicUrl } : {}),
      timestamp: new Date().toISOString(),
      ...(s.serverName ? { footer: { text: st('Servidor: {name}', { name: s.serverName }).slice(0, 100) } } : {}),
    }],
  };
}

/** Valores de ejemplo de un aviso, para «Probar este aviso». */
export const sampleValues = (id: DiscordEventId) => Object.fromEntries(def(id).placeholders.map((p) => [p.name, p.sample]));

export function testMessage(): DiscordMessage {
  return { embeds: [{ title: st('✅ Howler está conectado a este canal'), description: st('Si ves este mensaje, todo está bien. Aquí aparecerán los avisos que hayas activado.'), color: 0x9b59b6 }] };
}

type Fetch = typeof fetch;

/** Manda un mensaje al webhook. Devuelve null si fue bien o un texto de error en español. */
export async function sendDiscord(url: string, msg: DiscordMessage, doFetch: Fetch = fetch): Promise<string | null> {
  if (!isDiscordWebhook(url)) return 'Ese enlace no parece un webhook de Discord. Debe empezar por https://discord.com/api/webhooks/…';
  try {
    const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg), signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (res.ok) return null;
    if (res.status === 404 || res.status === 401) return st('Discord no reconoce ese webhook: puede que lo hayas borrado. Crea uno nuevo.');
    if (res.status === 429) return st('Discord pide esperar un poco. Prueba de nuevo en un minuto.');
    return st('Discord respondió con un error ({status}).', { status: res.status });
  } catch {
    return st('No he podido conectar con Discord. Revisa la conexión a internet.');
  }
}

/** Nombre del tipo de sesión en el idioma de los mensajes del servidor. */
const sessionTypeName = (type: number): string => (type === 1 ? st('Práctica') : type === 2 ? st('Clasificación') : type === 3 ? st('Carrera') : st('Sesión'));

export interface NotifierDeps {
  bus: Bus;
  settings: () => DiscordSettings;
  serverState: () => string;
  online: () => OnlineDriver[];
  session: () => SessionSummary | null;
  scopes: (lapId: number) => LapRecordScopes | null;
  championship: (id: number) => { name: string; rounds: number } | null;
  carName: (id: string) => string;
  trackName: (track: string, layout: string) => string;
  /** Nombre e insignia de este Howler, para los huecos {servidor} e {insignia}. */
  server?: () => { name: string; badge: string };
  doFetch?: Fetch;
}

/** Escucha los eventos de Howler y avisa al canal de Discord de lo que el organizador haya activado. Si falla, solo lo apunta en el log. */
export function startDiscordNotifier(d: NotifierDeps): () => void {
  let lastState = d.serverState();
  let known = new Map(d.online().map((o) => [o.driverId, o]));
  let lastSession = d.session()?.id ?? null;

  const emit = (id: DiscordEventId, values: Record<string, string>) => {
    const s = d.settings();
    const hooks = webhooksOf(s);
    if (!hooks.length || !isOn(def(id), s)) return;
    const srv = d.server?.();
    const msg = renderEvent(id, s, { ...(srv ? { servidor: srv.name, insignia: srv.badge } : {}), ...values });
    for (const h of hooks) void sendDiscord(h.url, msg, d.doFetch).then((err) => { if (err) console.log(`[discord] ${h.name}: ${err}`); });
  };

  return d.bus.on((e: LiveEvent) => {
    if (!webhooksOf(d.settings()).length) return;
    switch (e.type) {
      case 'lap': {
        if (!e.valid) return;
        const s = d.scopes(e.lapId);
        if (!s) return;
        // Si bate varios niveles activados, solo se avisa del más importante
        const cfg = d.settings();
        const tier = (['recordGlobal', 'recordCombo', 'recordSession'] as const).find((id) => isOn(def(id), cfg) && s[id === 'recordGlobal' ? 'global' : id === 'recordCombo' ? 'combo' : 'session'].beaten);
        if (!tier) return;
        const t = s[tier === 'recordGlobal' ? 'global' : tier === 'recordCombo' ? 'combo' : 'session'];
        emit(tier, {
          piloto: s.driverName, tiempo: formatLapTime(s.lapMs), coche: d.carName(s.car), circuito: d.trackName(s.track, s.layout),
          anterior: formatLapTime(t.prevMs), anteriorPiloto: t.prevDriver ?? '—', mejora: t.prevMs != null ? ((t.prevMs - s.lapMs) / 1000).toFixed(3) : '',
        });
        return;
      }
      case 'server': {
        const now = d.serverState();
        if (now !== lastState) {
          if (now === 'running') emit('serverUp', {});
          else if (now === 'stopped' && lastState !== 'starting') emit('serverDown', {});
        }
        lastState = now;
        return;
      }
      case 'status': {
        const now = new Map(d.online().map((o) => [o.driverId, o]));
        for (const [id, o] of now) if (!known.has(id)) emit('driverJoin', { piloto: o.name, coche: d.carName(o.car), conectados: String(now.size) });
        for (const [id, o] of known) if (!now.has(id)) emit('driverLeave', { piloto: o.name, conectados: String(now.size) });
        known = now;
        return;
      }
      case 'session': {
        const s = d.session();
        if (s && s.id !== lastSession) emit('sessionStart', { tipo: sessionTypeName(s.type), circuito: d.trackName(s.track, s.layout), nombre: s.name });
        lastSession = s?.id ?? null;
        return;
      }
      case 'schedule': {
        const track = e.track ? d.trackName(e.track, e.layout) : '';
        emit(e.kind === 'soon' ? 'eventSoon' : 'eventStart', { evento: e.name, minutos: String(e.minutes), circuito: track });
        return;
      }
      case 'championship': {
        const c = d.championship(e.id);
        if (c) emit(e.kind === 'started' ? 'championshipStarted' : 'championshipFinished', { campeonato: c.name, carreras: String(c.rounds) });
        return;
      }
    }
  });
}
