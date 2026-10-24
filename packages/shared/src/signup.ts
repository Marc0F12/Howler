/** Inscripción pública a campeonatos: ajustes del organizador, formulario público y solicitudes (solo las ve el panel). */

export const SIGNUP_MAX_QUESTIONS = 5;
export const SIGNUP_MAX_PENDING = 300;

export interface SignupSettings {
  enabled: boolean;
  /** Pedir un correo (opcional para quien se inscribe; solo lo ve el organizador). */
  askEmail: boolean;
  askTeam: boolean;
  /** Dejar elegir coche entre los de las carreras del campeonato. */
  askCar: boolean;
  /** Preguntas extra (texto libre). */
  questions: string[];
  /** Texto que se enseña encima del formulario (normas, qué pasa después…). */
  info: string;
}

export const DEFAULT_SIGNUP_SETTINGS: SignupSettings = { enabled: false, askEmail: false, askTeam: false, askCar: false, questions: [], info: '' };

const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');

/** Ajustes guardados o recibidos, saneados (nunca falla). */
export function cleanSignupSettings(raw: unknown): SignupSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const questions = Array.isArray(r.questions) ? r.questions.map((q) => oneLine(q, 120)).filter(Boolean).slice(0, SIGNUP_MAX_QUESTIONS) : [];
  return {
    enabled: r.enabled === true, askEmail: r.askEmail === true, askTeam: r.askTeam === true, askCar: r.askCar === true,
    questions, info: typeof r.info === 'string' ? r.info.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 800) : '',
  };
}

/** Lo que enseña la web pública cuando hay inscripción abierta. */
export interface SignupFormDto {
  info: string;
  askEmail: boolean;
  askTeam: boolean;
  /** Ids de coche entre los que elegir (vacío = no se pregunta). */
  cars: string[];
  questions: string[];
}

/** Lo que manda quien se inscribe. `website` es un campo trampa para bots: tiene que llegar vacío. */
export interface SignupInput {
  name: string;
  /** Enlace a su perfil de Steam (o su SteamID64). */
  steam: string;
  team?: string;
  car?: string;
  email?: string;
  answers?: string[];
  website?: string;
}

export type SignupStatus = 'pending' | 'approved' | 'rejected';

export interface SignupRequestDto {
  id: number;
  name: string;
  /** Enlace normalizado al perfil de Steam. */
  steam: string;
  team: string;
  car: string;
  email: string;
  answers: { question: string; answer: string }[];
  status: SignupStatus;
  createdAt: string;
  driverId: number | null;
}

export interface SignupStateDto {
  settings: SignupSettings;
  requests: SignupRequestDto[];
  /** Coches entre los que se puede elegir (de las carreras del campeonato). */
  cars: string[];
}

/**
 * Perfil de Steam a partir de lo que pega la persona: enlace `/profiles/<id>`, `/id/<nombre>` o SteamID64.
 * Devuelve el enlace normalizado o null si no es nada de eso. Nunca se pide a Steam nada aquí.
 */
export function parseSteamRef(text: string): string | null {
  const t = text.trim();
  if (/^7656119\d{10}$/.test(t)) return `https://steamcommunity.com/profiles/${t}`;
  const m = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles\/(7656119\d{10})|id\/([A-Za-z0-9_-]{2,32}))\/?(?:[?#].*)?$/i.exec(t);
  if (!m) return null;
  return m[2] ? `https://steamcommunity.com/profiles/${m[2]}` : `https://steamcommunity.com/id/${m[3]}`;
}

/** Valida y limpia lo que llega del formulario público. Devuelve un mensaje de error (en español) si algo no vale. */
export function cleanSignupInput(raw: unknown, form: SignupFormDto): { ok: true; value: Required<Omit<SignupInput, 'website'>> & { steam: string } } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = oneLine(r.name, 40);
  if (name.length < 2) return { ok: false, error: 'Escribe tu nombre (al menos 2 letras).' };
  const steam = typeof r.steam === 'string' ? parseSteamRef(r.steam) : null;
  if (!steam) return { ok: false, error: 'Pega el enlace a tu perfil de Steam (steamcommunity.com/profiles/… o /id/…).' };
  const team = form.askTeam ? oneLine(r.team, 40) : '';
  const car = oneLine(r.car, 100);
  if (car && !form.cars.includes(car)) return { ok: false, error: 'Ese coche no está entre los permitidos.' };
  const email = form.askEmail ? oneLine(r.email, 120) : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Ese correo no parece válido.' };
  const given = Array.isArray(r.answers) ? r.answers : [];
  const answers = form.questions.map((_, i) => oneLine(given[i], 300));
  return { ok: true, value: { name, steam, team, car, email, answers } };
}
