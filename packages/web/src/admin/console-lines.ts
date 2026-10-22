/** Clase de color de cada línea de la consola del servidor (los niveles de Serilog de AssettoServer y los avisos de Howler). */
export type LogLevel = 'dbg' | 'inf' | 'wrn' | 'err' | 'ftl' | 'howler' | 'rule' | 'plain';

export interface ParsedLine {
  level: LogLevel;
  /** Hora tal cual salió (`22:38:17`), si la línea la trae. */
  time: string | null;
  /** Etiqueta del nivel (`INF`, `WRN`...), si la línea la trae. */
  tag: string | null;
  text: string;
  /** Línea de continuación de un error (volcado de excepción): hereda el color del error anterior, más apagado. */
  cont: boolean;
}

const SERILOG = /^\[(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s+(VRB|DBG|INF|WRN|ERR|FTL)\]\s?(.*)$/;
// Rayas de relleno (─ ═ ━ o el carácter de sustitución si el texto llegó mal codificado)
const RULE = /^[─-╿=\-_*�\s]{12,}$/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const LEVELS: Record<string, LogLevel> = { VRB: 'dbg', DBG: 'dbg', INF: 'inf', WRN: 'wrn', ERR: 'err', FTL: 'ftl' };

/** Interpreta una línea; `prev` es el resultado de la anterior (para pegar el volcado de excepciones a su error). */
export function parseLogLine(raw: string, prev?: ParsedLine): ParsedLine {
  const line = raw.replace(ANSI, '');
  const m = SERILOG.exec(line);
  if (m) return { level: LEVELS[m[2]!]!, time: m[1]!, tag: m[2]!, text: m[3]!, cont: false };
  if (/^\[howler\]/i.test(line)) return { level: 'howler', time: null, tag: null, text: line.replace(/^\[howler\]\s*/i, ''), cont: false };
  if (RULE.test(line)) return { level: 'rule', time: null, tag: null, text: line, cont: false };
  const isErrorBody = /^\s*at\s+\S/.test(line) || /^[\w.]+(Exception|Error)\b/.test(line.trim());
  if (prev && (prev.level === 'err' || prev.level === 'ftl') && (isErrorBody || prev.cont)) return { level: prev.level, time: null, tag: null, text: line, cont: true };
  if (/^\s*at\s+\S/.test(line) || /^[\w.]+(Exception|Error)\b/.test(line.trim())) return { level: 'err', time: null, tag: null, text: line, cont: true };
  return { level: 'plain', time: null, tag: null, text: line, cont: false };
}

/** Líneas que merecen resaltarse como «todo bien» dentro del texto normal. */
export function isGoodNews(text: string): boolean {
  return /Server startup completed|Lobby registration successful/i.test(text);
}
