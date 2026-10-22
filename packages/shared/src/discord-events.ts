// Avisos de Discord: cada uno se puede activar o apagar y tiene título y mensaje propios, con huecos {nombre}.
// Para añadir un aviso nuevo basta una entrada aquí y emitirlo desde `core/discord.ts`: el panel lo dibuja solo.

export type DiscordEventId =
  | 'serverUp' | 'serverDown' | 'driverJoin' | 'driverLeave' | 'sessionStart'
  | 'recordCombo' | 'recordGlobal' | 'recordSession'
  | 'championshipStarted' | 'championshipFinished'
  | 'eventSoon' | 'eventStart';

export interface DiscordEventDef {
  id: DiscordEventId;
  /** Grupo en el panel. */
  group: 'Servidor' | 'Pilotos' | 'Récords' | 'Campeonatos';
  label: string;
  hint: string;
  defaultEnabled: boolean;
  defaultTitle: string;
  defaultMessage: string;
  /** Color de la barra lateral del aviso (#rrggbb). */
  color: string;
  /** Huecos que admiten el título y el mensaje, con un valor de ejemplo para «Probar este aviso». */
  placeholders: { name: string; /** El mismo hueco en inglés: valen los dos al escribir el texto. */ alias: string; /** Rótulo del botón que lo inserta: [español, inglés]. */ label: [string, string]; sample: string; hint: string }[];
}

const REC: DiscordEventDef['placeholders'] = [
  { name: 'piloto', alias: 'driver', label: ['Piloto', 'Driver'], sample: 'Ana', hint: 'quien hizo la vuelta' },
  { name: 'tiempo', alias: 'time', label: ['Tiempo', 'Time'], sample: '1:30.000', hint: 'su tiempo' },
  { name: 'coche', alias: 'car', label: ['Coche', 'Car'], sample: 'Mazda MX-5', hint: 'el coche' },
  { name: 'circuito', alias: 'track', label: ['Circuito', 'Track'], sample: 'Imola', hint: 'el circuito' },
  { name: 'anterior', alias: 'previous', label: ['Tiempo anterior', 'Previous time'], sample: '1:31.234', hint: 'el tiempo que se batió' },
  { name: 'anteriorPiloto', alias: 'previousDriver', label: ['Piloto anterior', 'Previous driver'], sample: 'Beto', hint: 'quien lo tenía antes' },
  { name: 'mejora', alias: 'gain', label: ['Mejora', 'Gain'], sample: '1.234', hint: 'segundos de mejora' },
];

/** Huecos disponibles en TODOS los avisos: no se añaden solos al mensaje, el organizador los pone donde quiera. */
const SERVER_PLACEHOLDERS: DiscordEventDef['placeholders'] = [
  { name: 'servidor', alias: 'server', label: ['Servidor', 'Server'], sample: 'Servidor de Marc', hint: 'el nombre de este Howler (el de MultiHowler)' },
  { name: 'insignia', alias: 'badge', label: ['Insignia', 'Badge'], sample: '🐒WM', hint: 'la insignia de este Howler (hasta 6 caracteres, con emojis si quieres)' },
];

const RAW_EVENTS: DiscordEventDef[] = [
  { id: 'serverUp', group: 'Servidor', label: 'Servidor encendido', hint: 'Cuando el servidor arranca desde Howler.', defaultEnabled: true, color: '#2ecc71', placeholders: [],
    defaultTitle: '🟢 Servidor encendido', defaultMessage: '¡Ya podéis conectaros!' },
  { id: 'serverDown', group: 'Servidor', label: 'Servidor apagado', hint: 'Cuando el servidor se para.', defaultEnabled: true, color: '#e74c3c', placeholders: [],
    defaultTitle: '🔴 Servidor apagado', defaultMessage: 'El servidor se ha parado.' },
  { id: 'eventSoon', group: 'Servidor', label: 'Evento programado: se acerca', hint: 'Unos minutos antes de que empiece un evento de Servidor → Programación (los que tienen el aviso de Discord activado).', defaultEnabled: true, color: '#f1c40f',
    placeholders: [{ name: 'evento', alias: 'event', label: ['Evento', 'Event'], sample: 'Liga del jueves', hint: 'el nombre del evento' }, { name: 'minutos', alias: 'minutes', label: ['Minutos', 'Minutes'], sample: '10', hint: 'minutos que faltan' }, { name: 'circuito', alias: 'track', label: ['Circuito', 'Track'], sample: 'Imola', hint: 'el circuito, si el evento lo cambia' }],
    defaultTitle: '⏰ {evento} empieza en {minutos} min', defaultMessage: 'Preparad el coche: el servidor se prepara solo. {circuito}' },
  { id: 'eventStart', group: 'Servidor', label: 'Evento programado: empieza', hint: 'Cuando Howler arranca el servidor por un evento programado.', defaultEnabled: true, color: '#1abc9c',
    placeholders: [{ name: 'evento', alias: 'event', label: ['Evento', 'Event'], sample: 'Liga del jueves', hint: 'el nombre del evento' }, { name: 'circuito', alias: 'track', label: ['Circuito', 'Track'], sample: 'Imola', hint: 'el circuito, si el evento lo cambia' }],
    defaultTitle: '🚦 ¡Empieza {evento}!', defaultMessage: 'El servidor está arrancando. {circuito}' },
  { id: 'sessionStart', group: 'Servidor', label: 'Nueva sesión', hint: 'Cuando empieza una práctica, clasificación o carrera.', defaultEnabled: false, color: '#3498db',
    placeholders: [{ name: 'tipo', alias: 'type', label: ['Tipo', 'Type'], sample: 'Carrera', hint: 'práctica, clasificación o carrera' }, { name: 'circuito', alias: 'track', label: ['Circuito', 'Track'], sample: 'Imola', hint: 'el circuito' }, { name: 'nombre', alias: 'name', label: ['Nombre', 'Name'], sample: 'Race', hint: 'nombre de la sesión' }],
    defaultTitle: '🏁 Empieza una sesión: {tipo}', defaultMessage: 'Circuito: **{circuito}**' },
  { id: 'driverJoin', group: 'Pilotos', label: 'Alguien entra', hint: 'Cuando un piloto se conecta al servidor.', defaultEnabled: false, color: '#1abc9c',
    placeholders: [{ name: 'piloto', alias: 'driver', label: ['Piloto', 'Driver'], sample: 'Ana', hint: 'quien entra' }, { name: 'coche', alias: 'car', label: ['Coche', 'Car'], sample: 'Mazda MX-5', hint: 'su coche' }, { name: 'conectados', alias: 'online', label: ['Conectados', 'Online'], sample: '3', hint: 'pilotos conectados ahora' }],
    defaultTitle: '👋 {piloto} se ha conectado', defaultMessage: 'Con {coche}. Conectados: {conectados}.' },
  { id: 'driverLeave', group: 'Pilotos', label: 'Alguien sale', hint: 'Cuando un piloto se desconecta.', defaultEnabled: false, color: '#95a5a6',
    placeholders: [{ name: 'piloto', alias: 'driver', label: ['Piloto', 'Driver'], sample: 'Ana', hint: 'quien sale' }, { name: 'conectados', alias: 'online', label: ['Conectados', 'Online'], sample: '2', hint: 'pilotos que quedan' }],
    defaultTitle: '🚪 {piloto} se ha desconectado', defaultMessage: 'Quedan {conectados} conectados.' },
  { id: 'recordCombo', group: 'Récords', label: 'Récord de circuito y coche', hint: 'Cuando se bate el récord de una combinación de circuito y coche.', defaultEnabled: true, color: '#9b59b6', placeholders: REC,
    defaultTitle: '🏆 Nuevo récord en {circuito}', defaultMessage: '**{piloto}** · {coche}\nTiempo: **{tiempo}**\nAntes: {anterior} ({anteriorPiloto}) · mejora de {mejora} s' },
  { id: 'recordGlobal', group: 'Récords', label: 'Récord absoluto del circuito', hint: 'Cuando se bate el mejor tiempo del circuito con cualquier coche.', defaultEnabled: false, color: '#f1c40f', placeholders: REC,
    defaultTitle: '👑 Récord absoluto de {circuito}', defaultMessage: '**{piloto}** · {coche}\nTiempo: **{tiempo}**\nAntes: {anterior} ({anteriorPiloto}) · mejora de {mejora} s' },
  { id: 'recordSession', group: 'Récords', label: 'Mejor vuelta de la sesión', hint: 'Cuando alguien hace la vuelta más rápida de la sesión en curso.', defaultEnabled: false, color: '#e67e22', placeholders: REC,
    defaultTitle: '⏱️ Mejor vuelta de la sesión', defaultMessage: '**{piloto}** · {coche} · {tiempo}\nEn {circuito}' },
  { id: 'championshipStarted', group: 'Campeonatos', label: 'Nuevo campeonato', hint: 'Cuando se activa un campeonato.', defaultEnabled: false, color: '#e91e63',
    placeholders: [{ name: 'campeonato', alias: 'championship', label: ['Campeonato', 'Championship'], sample: 'Copa Howler', hint: 'su nombre' }, { name: 'carreras', alias: 'rounds', label: ['Carreras', 'Rounds'], sample: '6', hint: 'número de carreras' }],
    defaultTitle: '🏆 ¡Arranca el campeonato {campeonato}!', defaultMessage: '{carreras} carreras. Mira el calendario en la web.' },
  { id: 'championshipFinished', group: 'Campeonatos', label: 'Campeonato terminado', hint: 'Cuando un campeonato se da por terminado.', defaultEnabled: false, color: '#ff9800',
    placeholders: [{ name: 'campeonato', alias: 'championship', label: ['Campeonato', 'Championship'], sample: 'Copa Howler', hint: 'su nombre' }],
    defaultTitle: '🏁 Campeonato terminado: {campeonato}', defaultMessage: 'Ya puedes ver la clasificación final en la web.' },
];

export const DISCORD_EVENTS: DiscordEventDef[] = RAW_EVENTS.map((e) => ({ ...e, placeholders: [...e.placeholders, ...SERVER_PLACEHOLDERS] }));

export const DISCORD_EVENT_IDS = DISCORD_EVENTS.map((e) => e.id);

const ownValue = (v: Record<string, string>, k: string): string | undefined => (Object.hasOwn(v, k) ? v[k] : undefined);

/** Rellena los huecos {nombre}; los desconocidos se dejan tal cual. */
export function fillTemplate(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => ownValue(v, k) ?? ownValue(v, Object.hasOwn(ALIASES, k) ? ALIASES[k]! : '') ?? m);
}

/** Lo que el organizador ha guardado de un aviso (vacío o ausente = el de Howler). */
export interface DiscordEventSetting { enabled?: boolean; title?: string; message?: string }

/** Nombre en inglés de cada hueco → su nombre canónico (el de los valores). Así `{badge}` y `{insignia}` son lo mismo. */
const ALIASES: Record<string, string> = Object.fromEntries(DISCORD_EVENTS.flatMap((e) => e.placeholders.map((p) => [p.alias, p.name] as const)));
