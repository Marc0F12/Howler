import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  ACCOUNT_NAME, ACCOUNT_ROLES, MAX_ACCOUNTS, MAX_PASSWORD, MIN_PASSWORD,
  type AccountDto, type AccountRole, type WhoAmIDto,
} from '@howler/shared';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/**
 * Cuentas del panel para el acceso remoto. En el propio PC de Howler el panel sigue sin contraseña (como siempre); desde otro
 * equipo, o a través de un túnel, hace falta iniciar sesión con una cuenta creada por el administrador en el panel local.
 */

interface StoredAccount { id: string; name: string; role: AccountRole; salt: string; hash: string; createdAt: string; lastLogin: string | null }

const FILE = 'accounts.json';
const SESSIONS_FILE = 'sessions.json';
const SESSION_MS = 12 * 3_600_000;
const COOKIE = 'howler_session';
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60_000;

/** Cabeceras que añade un proxy o un túnel: si aparecen, la petición NO viene de este PC aunque llegue desde 127.0.0.1. */
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'true-client-ip', 'via'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Lo que no se puede hacer desde fuera del PC, ni siquiera siendo administrador (cambia el programa, los archivos o las cuentas). */
export const LOCAL_ONLY = /^\/admin\/api\/(settings|update\/apply|backup|open-web|server\/connect|accounts|detect)(\/|$)/;

const READ = /^\/admin\/api\/(state|ping|me|laps|penalties(\/sessions)?|drivers|schedule|server\/(logs|diagnosis)|control\/time|weather|championships(\/\d+(\/candidates)?)?|race-penalties|lap-rules)$/;
const MOD_WRITE: [string, RegExp][] = [
  ['POST', /^\/admin\/api\/control\/[\w-]+$/],
  ['POST', /^\/admin\/api\/penalties$/],
  ['DELETE', /^\/admin\/api\/penalties\/\d+$/],
  ['POST', /^\/admin\/api\/laps\/\d+\/(void|valid|reset)$/],
  ['POST', /^\/admin\/api\/championships\/\d+\/(assign|adjustments)$/],
  ['DELETE', /^\/admin\/api\/championships\/\d+\/adjustments\/\d+$/],
];

export type Caller = { kind: 'local' } | { kind: 'remote'; account: { id: string; name: string; role: AccountRole } | null };

const pathOf = (url: string) => url.split('?')[0]!;

/** ¿Puede esta cuenta hacer esta petición? (el servidor lo comprueba siempre; el panel solo esconde lo que no se puede usar) */
export function roleAllows(role: AccountRole, method: string, url: string): boolean {
  const path = pathOf(url);
  if (LOCAL_ONLY.test(path)) return false;
  if (role === 'admin') return true;
  if (method === 'GET') return READ.test(path);
  return role === 'moderator' && MOD_WRITE.some(([m, re]) => m === method && re.test(path));
}

export class AuthService {
  private sessions = new Map<string, { id: string; expires: number }>();
  private fails = new Map<string, { n: number; until: number }>();

  constructor(private o: { dataDir: string; remoteEnabled: () => boolean; now?: () => number }) {
    this.loadSessions();
  }

  /** Las sesiones sobreviven a reiniciar Howler: se guardan solo con el hash del token (el token real nunca se escribe). */
  private loadSessions() {
    try {
      const raw = JSON.parse(readFileSync(join(this.o.dataDir, SESSIONS_FILE), 'utf8')) as { sessions?: { h?: unknown; id?: unknown; expires?: unknown }[] };
      for (const s of Array.isArray(raw.sessions) ? raw.sessions : []) {
        if (typeof s.h === 'string' && typeof s.id === 'string' && typeof s.expires === 'number' && s.expires > this.now()) this.sessions.set(s.h, { id: s.id, expires: s.expires });
      }
    } catch { /* sin sesiones guardadas */ }
  }
  private saveSessions() {
    try {
      const file = join(this.o.dataDir, SESSIONS_FILE);
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ sessions: [...this.sessions].map(([h, s]) => ({ h, ...s })) }), { mode: 0o600 });
      renameSync(tmp, file);
    } catch { /* no se pudo guardar: la sesión sigue valiendo hasta que se reinicie Howler */ }
  }

  private now() { return (this.o.now ?? Date.now)(); }
  get remoteEnabled() { return this.o.remoteEnabled(); }

  // ---- Almacén ----
  private read(): StoredAccount[] {
    try {
      const raw = JSON.parse(readFileSync(join(this.o.dataDir, FILE), 'utf8')) as { accounts?: unknown };
      return (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a): a is StoredAccount => {
        const q = a as Partial<StoredAccount>;
        return !!q && typeof q.id === 'string' && typeof q.name === 'string' && ACCOUNT_ROLES.includes(q.role as AccountRole) && typeof q.salt === 'string' && typeof q.hash === 'string';
      });
    } catch { return []; }
  }
  private write(accounts: StoredAccount[]) {
    const file = join(this.o.dataDir, FILE);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ accounts }, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
  }

  private dto(a: StoredAccount): AccountDto { return { id: a.id, name: a.name, role: a.role, createdAt: a.createdAt, lastLogin: a.lastLogin }; }
  list(): AccountDto[] { return this.read().map((a) => this.dto(a)); }
  count(): number { return this.read().length; }

  private static checkName(name: unknown): string {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!ACCOUNT_NAME.test(n)) throw new Error('El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.');
    return n;
  }
  private static checkPassword(p: unknown): string {
    if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw new Error(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
    if (p.length > MAX_PASSWORD) throw new Error('La contraseña es demasiado larga.');
    return p;
  }
  private static checkRole(r: unknown): AccountRole {
    if (!ACCOUNT_ROLES.includes(r as AccountRole)) throw new Error('Rol no válido.');
    return r as AccountRole;
  }
  private async hash(password: string, salt: Buffer) { return (await scrypt(password, salt, 64)).toString('hex'); }

  async create(input: { name: unknown; password: unknown; role: unknown }): Promise<AccountDto> {
    const name = AuthService.checkName(input.name), password = AuthService.checkPassword(input.password), role = AuthService.checkRole(input.role);
    const cur = this.read();
    if (cur.length >= MAX_ACCOUNTS) throw new Error(`Ya hay ${MAX_ACCOUNTS} cuentas: borra alguna antes de crear otra.`);
    if (cur.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error('Ya existe una cuenta con ese usuario.');
    const salt = randomBytes(16);
    const acc: StoredAccount = { id: `u${randomBytes(6).toString('hex')}`, name, role, salt: salt.toString('hex'), hash: await this.hash(password, salt), createdAt: new Date(this.now()).toISOString(), lastLogin: null };
    this.write([...cur, acc]);
    return this.dto(acc);
  }

  async update(id: string, patch: { name?: unknown; password?: unknown; role?: unknown }): Promise<AccountDto> {
    const cur = this.read();
    const old = cur.find((a) => a.id === id);
    if (!old) throw new Error('No existe esa cuenta.');
    const next = { ...old };
    if (patch.name !== undefined) {
      next.name = AuthService.checkName(patch.name);
      if (cur.some((a) => a.id !== id && a.name.toLowerCase() === next.name.toLowerCase())) throw new Error('Ya existe una cuenta con ese usuario.');
    }
    if (patch.role !== undefined) next.role = AuthService.checkRole(patch.role);
    if (patch.password !== undefined && patch.password !== '') {
      const salt = randomBytes(16);
      next.salt = salt.toString('hex');
      next.hash = await this.hash(AuthService.checkPassword(patch.password), salt);
    }
    this.write(cur.map((a) => (a.id === id ? next : a)));
    this.dropSessions(id); // cambiar la contraseña o el rol cierra las sesiones abiertas de esa cuenta
    return this.dto(next);
  }

  remove(id: string) {
    const cur = this.read();
    if (!cur.some((a) => a.id === id)) throw new Error('No existe esa cuenta.');
    this.write(cur.filter((a) => a.id !== id));
    this.dropSessions(id);
  }

  private dropSessions(id: string) {
    for (const [k, s] of this.sessions) if (s.id === id) this.sessions.delete(k);
    this.saveSessions();
  }

  // ---- Inicio de sesión ----
  private locked(keys: string[]): number {
    const t = this.now();
    return Math.max(0, ...keys.map((k) => { const f = this.fails.get(k); return f && f.until > t ? Math.ceil((f.until - t) / 1000) : 0; }));
  }
  private fail(keys: string[]) {
    const t = this.now();
    for (const k of keys) {
      const f = this.fails.get(k);
      const expired = !!f && f.until !== 0 && f.until <= t; // un bloqueo ya cumplido empieza de cero
      const n = (f && !expired ? f.n : 0) + 1;
      this.fails.set(k, { n, until: n >= LOCK_AFTER ? t + LOCK_MS : 0 });
    }
    if (this.fails.size > 2000) this.fails.clear();
  }

  /** Comprueba usuario y contraseña. Devuelve el token de sesión; lanza con un mensaje claro si no vale. Mismo mensaje para «no existe» y «contraseña mala». */
  async login(name: unknown, password: unknown, ip: string): Promise<{ token: string; account: AccountDto }> {
    const n = typeof name === 'string' ? name.trim().toLowerCase().slice(0, 64) : '';
    const keys = [`ip:${ip}`, `name:${n}`];
    const wait = this.locked(keys);
    if (wait > 0) throw new Error(`Demasiados intentos. Espera ${Math.ceil(wait / 60)} min y vuelve a probar.`);
    const acc = this.read().find((a) => a.name.toLowerCase() === n);
    const salt = acc ? Buffer.from(acc.salt, 'hex') : Buffer.alloc(16);
    const given = await scrypt(typeof password === 'string' ? password.slice(0, MAX_PASSWORD) : '', salt, 64); // se calcula siempre: no se nota si el usuario existe
    const ok = !!acc && timingSafeEqual(given, Buffer.from(acc.hash, 'hex'));
    if (!acc || !ok) { this.fail(keys); throw new Error('Usuario o contraseña incorrectos.'); }
    for (const k of keys) this.fails.delete(k);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(createHash('sha256').update(token).digest('hex'), { id: acc.id, expires: this.now() + SESSION_MS });
    this.saveSessions();
    const stamp = new Date(this.now()).toISOString();
    this.write(this.read().map((a) => (a.id === acc.id ? { ...a, lastLogin: stamp } : a)));
    return { token, account: { ...this.dto(acc), lastLogin: stamp } };
  }

  logout(token: string | null) {
    if (token && this.sessions.delete(createHash('sha256').update(token).digest('hex'))) this.saveSessions();
  }

  // ---- Quién hace la petición ----
  static cookieToken(header: unknown): string | null {
    for (const part of String(header ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=') || null;
    }
    return null;
  }

  isRemote(req: { ip?: string; socket: { remoteAddress?: string }; headers: Record<string, unknown> }): boolean {
    const addr = req.socket.remoteAddress ?? req.ip ?? '';
    return !LOOPBACK.has(addr) || PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
  }

  /** Quién es, si es de fuera: la cuenta con sesión vigente (se renueva con el uso), o null. */
  caller(req: { ip?: string; socket: { remoteAddress?: string }; headers: Record<string, unknown> }): Caller {
    if (!this.isRemote(req)) return { kind: 'local' };
    const token = AuthService.cookieToken(req.headers.cookie);
    if (!token) return { kind: 'remote', account: null };
    const key = createHash('sha256').update(token).digest('hex');
    const s = this.sessions.get(key);
    const t = this.now();
    if (!s || s.expires <= t) { this.sessions.delete(key); return { kind: 'remote', account: null }; }
    const acc = this.read().find((a) => a.id === s.id);
    if (!acc) { this.sessions.delete(key); return { kind: 'remote', account: null }; }
    s.expires = t + SESSION_MS;
    return { kind: 'remote', account: { id: acc.id, name: acc.name, role: acc.role } };
  }

  whoAmI(c: Caller): WhoAmIDto {
    if (c.kind === 'local') return { admin: true, login: false, role: 'admin', name: null, local: true };
    if (!c.account) return { admin: false, login: this.remoteEnabled, role: null, name: null, local: false };
    return { admin: true, login: false, role: c.account.role, name: c.account.name, local: false };
  }

  /** Valor de la cabecera Set-Cookie. */
  static cookie(token: string, secure: boolean): string {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }
  static clearCookie(secure: boolean): string { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`; }
}
