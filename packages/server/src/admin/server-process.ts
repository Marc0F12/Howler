import { st } from '../core/lang';
import { StringDecoder } from 'node:string_decoder';
import type { ServerDiagnosisDto } from '@howler/shared';
import { diagnoseLogs } from './server-diagnosis';
import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

export interface ServerSnapshot {
  state: ServerState;
  pid: number | null;
  startedAt: string | null;
  /** Cómo terminó la última vez: código de salida o motivo. */
  lastExit: { at: string; code: number | null; expected: boolean; diagnosis: ServerDiagnosisDto[] } | null;
  /** Enlace de invitación de Content Manager que imprime AssettoServer al arrancar (null si aún no ha salido). */
  inviteLink: string | null;
  /** Últimas líneas de la consola del servidor. */
  logs: string[];
}

export interface ServerProcessOptions {
  serverDir: string;
  /** Nombre del ejecutable dentro de serverDir. */
  exe: string;
  /** Preset de Content Manager; vacío = configuración de cfg/. */
  preset: string;
  /** Línea de la consola que indica que el servidor ya está listo. */
  readyPattern?: RegExp;
  /** Si no sale esa línea, se da por listo pasado este tiempo mientras el proceso siga vivo. */
  readyTimeoutMs?: number;
  /** Cuánto se espera a que el servidor pare por sí solo antes de matarlo. */
  stopGraceMs?: number;
  maxLogLines?: number;
  /** Para tests. */
  spawnFn?: typeof nodeSpawn;
  /** ¿Existe aún ese proceso? (para comprobar que la parada forzada funcionó; en pruebas se sustituye) */
  isAlive?: (pid: number) => boolean;
  /** Cuánto se espera a que el proceso muera tras matarlo a la fuerza (ms). */
  killWaitMs?: number;
  /** Pide al servidor que pare limpiamente (por el plugin). Devuelve false si no pudo. */
  requestStop?: () => Promise<boolean>;
  /** Se ejecuta justo antes de lanzar el servidor (p. ej. para aplicar los ajustes en Auto). Un fallo aquí no impide arrancar. */
  beforeStart?: () => void;
  /** Mata el proceso y sus hijos. */
  forceKill?: (pid: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** taskkill /T mata también a los procesos hijos, que en Windows no mueren solos con el padre. */
const defaultForceKill = (pid: number) =>
  new Promise<void>((resolve) => {
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ya no existe */ }
      resolve();
    }
  });

/**
 * Arranca, para y reinicia el servidor de AC como proceso hijo de Howler, guardando su consola.
 * Eventos: 'state' (ServerSnapshot) y 'log' (línea).
 */
/** Señal 0: no mata nada, solo comprueba si el proceso existe. */
const defaultIsAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

export class ServerProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: ServerState = 'stopped';
  private startedAt: Date | null = null;
  private lastExit: ServerSnapshot['lastExit'] = null;
  private logs: string[] = [];
  private readyTimer: NodeJS.Timeout | null = null;
  private expectedExit = false;
  private partial = '';

  constructor(private o: ServerProcessOptions) {
    super();
  }

  snapshot(): ServerSnapshot {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastExit: this.lastExit,
      inviteLink: this.inviteLink(),
      logs: [...this.logs],
    };
  }

  /** El `Invite link: https://acstuff.club/...` de la consola de AssettoServer (solo https y solo ese dominio). */
  private inviteLink(): string | null {
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const m = /Invite link:\s*(https:\/\/acstuff\.club\/\S+)/i.exec(this.logs[i]!);
      if (m) return m[1]!;
    }
    return null;
  }

  /** Cambia la configuración para el siguiente arranque (no afecta a un servidor ya en marcha). */
  configure(patch: Partial<Pick<ServerProcessOptions, 'serverDir' | 'exe' | 'preset'>>) {
    this.o = { ...this.o, ...patch };
  }

  start(): void {
    if (this.state !== 'stopped') throw new Error(`El servidor ya está ${this.state === 'running' ? 'en marcha' : 'arrancando o parándose'}.`);
    const exePath = join(this.o.serverDir, this.o.exe);
    if (!this.o.serverDir || !existsSync(exePath)) throw new Error(`No encuentro ${exePath}. Revisa la carpeta del servidor en los ajustes.`);

    try { this.o.beforeStart?.(); } catch { /* no impide arrancar */ }
    const args = this.o.preset ? ['--preset', this.o.preset] : [];
    const spawnFn = this.o.spawnFn ?? nodeSpawn;
    const child = spawnFn(exePath, args, { cwd: this.o.serverDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.expectedExit = false;
    this.partial = '';
    this.startedAt = (this.o.now ?? (() => new Date()))();
    this.logs = [];
    this.setState('starting');

    // Un decodificador por flujo: un carácter de varios bytes (las rayas de «─») puede llegar partido entre dos trozos.
    for (const stream of [child.stdout, child.stderr]) {
      const dec = new StringDecoder('utf8');
      stream?.on('data', (b: Buffer) => this.ingest(dec.write(b)));
    }
    child.once('error', (e) => {
      this.log(`[howler] ${st('no se pudo arrancar el servidor: {msg}', { msg: e.message })}`);
      // Si el proceso ni siquiera llegó a existir no habrá evento 'exit': se da por terminado ahora.
      if (child.pid === undefined) this.onExit(null);
    });
    child.once('exit', (code) => this.onExit(code));

    this.readyTimer = setTimeout(() => { if (this.state === 'starting') this.setState('running'); }, this.o.readyTimeoutMs ?? 30_000);
    this.readyTimer.unref?.();
  }

  /**
   * Para el servidor: aviso opcional a los jugadores, parada limpia por el plugin y, si no basta, se mata el proceso.
   * `announce` se llama una vez con los segundos de espera (para mandar el mensaje al chat).
   */
  async stop(opts: { warnSeconds?: number; announce?: (seconds: number) => Promise<void> | void } = {}): Promise<void> {
    if (this.state === 'stopped' || !this.child) return;
    if (this.state === 'stopping') return this.waitStopped();
    const sleep = this.o.sleep ?? defaultSleep;
    const child = this.child;
    this.expectedExit = true;
    this.setState('stopping');

    const warn = opts.warnSeconds ?? 0;
    if (warn > 0) {
      try { await opts.announce?.(warn); } catch { /* el aviso es opcional */ }
      await sleep(warn * 1000);
    }

    let asked = false;
    try { asked = (await this.o.requestStop?.()) ?? false; } catch { asked = false; }
    if (!asked) this.log(`[howler] ${st('el plugin no respondió a la parada limpia; se fuerza el cierre.')}`);

    const grace = this.o.stopGraceMs ?? 15_000;
    if (!asked || !(await this.waitExit(child, grace))) {
      if (child.pid) await (this.o.forceKill ?? defaultForceKill)(child.pid);
      await this.waitExit(child, this.o.killWaitMs ?? 5_000);
    }
    if (this.child === child && child.exitCode == null && child.signalCode == null && child.pid !== undefined && (this.o.isAlive ?? defaultIsAlive)(child.pid)) {
      // No se pudo parar (por ejemplo, taskkill sin permisos): no se da por parado, para no arrancar otro encima.
      this.expectedExit = false;
      this.log(`[howler] ${st('no se pudo parar el servidor; sigue en marcha.')}`);
      this.setState('running');
      throw new Error(st('No se pudo parar el servidor.'));
    }
    if (this.child) this.onExit(child.exitCode); // por si el evento 'exit' no llegó a emitirse
  }

  async restart(opts: Parameters<ServerProcess['stop']>[0] = {}): Promise<void> {
    await this.stop(opts);
    this.start();
  }

  private waitStopped(): Promise<void> {
    return new Promise((res) => this.once('state', () => (this.state === 'stopped' ? res() : undefined)));
  }

  private waitExit(child: ChildProcess, ms: number): Promise<boolean> {
    if (child.exitCode !== null || this.state === 'stopped') return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => { child.off('exit', done); resolve(false); }, ms);
      const done = () => { clearTimeout(t); resolve(true); };
      child.once('exit', done);
    });
  }

  private ingest(text: string) {
    const lines = (this.partial + text).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const l of lines) if (l.length) this.log(l);
  }

  private log(line: string) {
    this.logs.push(line);
    const max = this.o.maxLogLines ?? 1000;
    if (this.logs.length > max) this.logs.splice(0, this.logs.length - max);
    this.emit('log', line);
    if (this.state === 'starting' && (this.o.readyPattern ?? /Server startup completed/).test(line)) this.setState('running');
  }

  private onExit(code: number | null) {
    if (!this.child) return; // ya se procesó la salida (puede llamarse desde el evento y desde stop())
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.partial) { this.log(this.partial); this.partial = ''; }
    const crashed = !this.expectedExit && this.state !== 'stopped';
    // Si se cayó, se deduce la causa probable del texto de la consola (ver server-diagnosis.ts).
    const diagnosis = crashed ? diagnoseLogs(this.logs) : [];
    this.lastExit = { at: (this.o.now ?? (() => new Date()))().toISOString(), code, expected: !crashed, diagnosis };
    if (crashed) this.log(`[howler] ${st('el servidor se cerró solo (código {code}). Revisa las últimas líneas de arriba.', { code: code ?? '?' })}`);
    this.child = null;
    this.startedAt = null;
    this.setState('stopped');
  }

  private setState(s: ServerState) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', this.snapshot());
  }
}
