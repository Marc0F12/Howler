/** MultiHowler: tipos que ve el panel. Nunca llevan la identidad interna, tokens ni Steam ID. */

export type MhPeerStatus = 'requested' | 'pending' | 'approved' | 'denied' | 'revoked';

export interface MhPeerDto {
  id: number;
  badge: string;
  badgeBg: string;
  badgeFg: string;
  /** 'outgoing': yo pedí vincularme; 'incoming': me lo pidieron a mí. */
  direction: 'outgoing' | 'incoming';
  name: string;
  /** Dirección del otro Howler (solo si la puse yo). */
  url: string | null;
  status: MhPeerStatus;
  /** Lo que YO doy / recibo en este vínculo. */
  give: boolean;
  receive: boolean;
  /** Lo que ELLOS declaran dar / recibir. */
  theyGive: boolean;
  theyReceive: boolean;
  shareChampionships: boolean;
  /** Compartir las trayectorias de las mejores vueltas (comparador y fantasmas); los dos lados deben activarlo. */
  shareTraces: boolean;
  hidden: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Vueltas nuevas recibidas en la última sincronización. */
  lastNewLaps: number;
  /** Vueltas que tengo guardadas de ese Howler (como origen). */
  lapsFrom: number;
}

export interface MhStateDto {
  name: string;
  /** Insignia de este Howler (hasta 6 caracteres, admite emojis). */
  badge: string;
  /** Colores de la insignia (#rrggbb); vacío = automático. */
  badgeBg: string;
  badgeFg: string;
  /** Clave para que otros pidan vincularse (formato HWL-XXXX-XXXX-XXXX-XXXX). */
  key: string;
  /** Dirección pública de mi web, para dársela a otros. */
  address: string;
  peers: MhPeerDto[];
}

/** Un piloto en el gestor del panel (sin Steam ID). */
export interface ManagedDriverDto {
  id: number;
  name: string;
  hidden: boolean;
  /** El nombre se cambió a mano: ya no lo pisa el que traiga el juego. */
  renamed: boolean;
  laps: number;
  /** Vueltas dadas en este servidor / vueltas recibidas de otros Howlers. */
  ownLaps: number;
  peerLaps: number;
  /** Creado por una importación (stracker). */
  imported: boolean;
  lastSeen: string;
}

/** Un servidor de origen de los datos (para el filtro de la web). */
export interface ServerDto {
  badge: string;
  badgeBg: string;
  badgeFg: string;
  /** `local` = este servidor; el resto, un resumen opaco de la identidad del otro Howler. */
  key: string;
  name: string;
  laps: number;
  local: boolean;
}

/** Máximo de caracteres visibles de la insignia (un emoji cuenta como uno). */
export const MAX_BADGE = 6;

const graphemes = (s: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment) : Array.from(s);

/** Máximo de símbolos Unicode (un emoji compuesto, como una familia, son varios) y de longitud en bruto: evita insignias gigantes. */
const MAX_BADGE_CODEPOINTS = 24;
const MAX_BADGE_UNITS = 48;
/** Caracteres de control, invisibles y de cambio de dirección del texto (el de «invertir» sirve para suplantar nombres). Se deja el unidor de emojis (U+200D) y el selector de emoji (U+FE0F). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]/g;

/**
 * Insignia limpia: admite mayúsculas, minúsculas, números, símbolos y emojis tal como se escriben. Quita lo invisible o de control,
 * y exige entre 1 y `MAX_BADGE` caracteres visibles. Lanza con un mensaje en español si no vale.
 */
export function cleanBadge(raw: string): string {
  const t = raw.replace(FORBIDDEN, '').trim().normalize('NFC');
  const g = graphemes(t);
  if (g.length === 0 || /^[\s\u200d\ufe0f]*$/.test(t)) throw new Error('La insignia no puede estar vacía.');
  if (g.length > MAX_BADGE) throw new Error(`La insignia admite como mucho ${MAX_BADGE} caracteres (un emoji cuenta como uno).`);
  if (Array.from(t).length > MAX_BADGE_CODEPOINTS || t.length > MAX_BADGE_UNITS) throw new Error('La insignia lleva demasiados símbolos combinados: prueba con algo más sencillo.');
  return t;
}

/** Insignia por defecto a partir del nombre: sus primeras letras en mayúsculas. */
export function defaultBadge(name: string): string {
  const g = graphemes(name.replace(FORBIDDEN, '').replace(/\s+/g, '').toUpperCase()).slice(0, MAX_BADGE).join('');
  return g || 'HOWLER';
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Color de insignia válido (#rrggbb) o vacío (= automático). Lo inválido se convierte en vacío. */
export const cleanBadgeColor = (c: string | null | undefined): string => (c && HEX.test(c) ? c.toLowerCase() : '');

const lum = (hex: string) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
};
/** Contraste entre dos colores (1 a 21); 4.5 o más se lee bien. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
/** Negro o blanco, el que mejor se lee sobre ese fondo. */
export const readableOn = (bg: string): string => (contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff');
