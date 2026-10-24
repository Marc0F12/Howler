import type { DatabaseSync } from 'node:sqlite';
import { cleanSignupSettings, SIGNUP_MAX_PENDING, type SignupFormDto, type SignupRequestDto, type SignupSettings, type SignupStatus } from '@howler/shared';
import { csvField } from './lap-export';

type Row = Record<string, any>;

/** Inscripción pública a campeonatos: ajustes del organizador, solicitudes y su aprobación. Solo campeonatos propios. */
export class Signups {
  constructor(private db: DatabaseSync) {}

  private champ(cid: number): Row | undefined {
    return this.db.prepare('SELECT id, status, origin, signup FROM championships WHERE id = ?').get(cid) as Row | undefined;
  }

  settings(cid: number): SignupSettings {
    const raw = this.champ(cid)?.signup;
    try { return cleanSignupSettings(typeof raw === 'string' && raw ? JSON.parse(raw) : null); } catch { return cleanSignupSettings(null); }
  }

  setSettings(cid: number, settings: SignupSettings): boolean {
    const c = this.champ(cid);
    if (!c) return false;
    if (c.origin != null) throw new Error('Es una copia de un campeonato de otro Howler: solo lectura.');
    this.db.prepare('UPDATE championships SET signup = ? WHERE id = ?').run(JSON.stringify(cleanSignupSettings(settings)), cid);
    return true;
  }

  /** Coches entre los que se puede elegir: los de las carreras del campeonato. */
  carsOf(cid: number): string[] {
    const set = new Set<string>();
    for (const r of this.db.prepare('SELECT cars FROM championship_rounds WHERE championship_id = ?').all(cid) as Row[]) {
      try { for (const c of JSON.parse(r.cars) as unknown[]) if (typeof c === 'string' && c) set.add(c); } catch { /* ignorar */ }
    }
    return [...set];
  }

  /** Formulario público: solo con la inscripción abierta, el campeonato activo y propio. */
  formFor(cid: number): SignupFormDto | null {
    const c = this.champ(cid);
    if (!c || c.origin != null || c.status !== 'active') return null;
    const s = this.settings(cid);
    if (!s.enabled) return null;
    return { info: s.info, askEmail: s.askEmail, askTeam: s.askTeam, cars: s.askCar ? this.carsOf(cid) : [], questions: s.questions };
  }

  /** Guarda una solicitud ya validada. Un mismo perfil de Steam solo puede tener una solicitud viva por campeonato. */
  submit(cid: number, v: { name: string; steam: string; team: string; car: string; email: string; answers: string[] }, questions: string[]): 'created' | 'duplicate' | 'full' {
    this.prune();
    const dup = this.db.prepare("SELECT 1 FROM championship_signups WHERE championship_id = ? AND lower(steam) = lower(?) AND status IN ('pending','approved')").get(cid, v.steam);
    if (dup) return 'duplicate';
    const pending = (this.db.prepare("SELECT COUNT(*) AS n FROM championship_signups WHERE championship_id = ? AND status = 'pending'").get(cid) as Row).n as number;
    if (pending >= SIGNUP_MAX_PENDING) return 'full';
    const answers = questions.map((question, i) => ({ question, answer: v.answers[i] ?? '' }));
    this.db.prepare('INSERT INTO championship_signups (championship_id, created_at, name, steam, team, car, email, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(cid, new Date().toISOString(), v.name, v.steam, v.team, v.car, v.email, JSON.stringify(answers));
    return 'created';
  }

  private toDto(r: Row): SignupRequestDto {
    let answers: { question: string; answer: string }[] = [];
    try { const j = JSON.parse(r.answers) as unknown; if (Array.isArray(j)) answers = j.filter((a) => a && typeof a.question === 'string' && typeof a.answer === 'string'); } catch { /* sin respuestas */ }
    return { id: r.id, name: r.name, steam: r.steam, team: r.team, car: r.car, email: r.email, answers, status: r.status as SignupStatus, createdAt: r.created_at, driverId: r.driver_id ?? null };
  }

  list(cid: number): SignupRequestDto[] {
    this.prune();
    return (this.db.prepare("SELECT * FROM championship_signups WHERE championship_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC").all(cid) as Row[]).map((r) => this.toDto(r));
  }

  pendingCount(cid: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM championship_signups WHERE championship_id = ? AND status = 'pending'").get(cid) as Row).n as number;
  }

  get(cid: number, sid: number): SignupRequestDto | null {
    const r = this.db.prepare('SELECT * FROM championship_signups WHERE id = ? AND championship_id = ?').get(sid, cid) as Row | undefined;
    return r ? this.toDto(r) : null;
  }

  /** Aprueba: inscribe al piloto (si no lo estaba) con el equipo y el coche elegidos y marca la solicitud. */
  approve(cid: number, sid: number, a: { driverId: number; teamId: number | null; car: string | null }): void {
    const c = this.champ(cid);
    if (!c) throw new Error('Ese campeonato no existe.');
    if (c.origin != null) throw new Error('Es una copia de un campeonato de otro Howler: solo lectura.');
    const req = this.db.prepare('SELECT status FROM championship_signups WHERE id = ? AND championship_id = ?').get(sid, cid) as Row | undefined;
    if (!req) throw new Error('Esa solicitud no existe.');
    if (a.teamId != null && !this.db.prepare('SELECT 1 FROM championship_teams WHERE id = ? AND championship_id = ?').get(a.teamId, cid)) throw new Error('Ese equipo no es de este campeonato.');
    this.db.exec('BEGIN');
    try {
      const has = this.db.prepare('SELECT 1 FROM championship_entries WHERE championship_id = ? AND driver_id = ?').get(cid, a.driverId);
      if (!has) this.db.prepare('INSERT INTO championship_entries (championship_id, driver_id, team_id, color, car, skin) VALUES (?, ?, ?, NULL, ?, NULL)').run(cid, a.driverId, a.teamId, a.car || null);
      this.db.prepare("UPDATE championship_signups SET status = 'approved', decided_at = ?, driver_id = ? WHERE id = ?").run(new Date().toISOString(), a.driverId, sid);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /** Rechaza: se borran el correo y las respuestas (no hace falta guardarlos) y la fila desaparece sola pasados unos días. */
  reject(cid: number, sid: number): boolean {
    return this.db.prepare("UPDATE championship_signups SET status = 'rejected', decided_at = ?, email = '', answers = '[]' WHERE id = ? AND championship_id = ?").run(new Date().toISOString(), sid, cid).changes > 0;
  }

  remove(cid: number, sid: number): boolean {
    return this.db.prepare('DELETE FROM championship_signups WHERE id = ? AND championship_id = ?').run(sid, cid).changes > 0;
  }

  /** Las rechazadas se borran a los 30 días. */
  prune(now = Date.now()): void {
    const limit = new Date(now - 30 * 86400000).toISOString();
    this.db.prepare("DELETE FROM championship_signups WHERE status = 'rejected' AND decided_at < ?").run(limit);
  }

  csv(cid: number): string {
    const rows = this.list(cid);
    const questions = [...new Set(rows.flatMap((r) => r.answers.map((a) => a.question)))];
    const head = ['Nombre', 'Steam', 'Equipo', 'Coche', 'Correo', 'Estado', 'Fecha', ...questions];
    const lines = rows.map((r) => [r.name, r.steam, r.team, r.car, r.email, r.status, r.createdAt, ...questions.map((q) => r.answers.find((a) => a.question === q)?.answer ?? '')].map(csvField).join(';'));
    return '﻿' + [head.map(csvField).join(';'), ...lines].join('\r\n') + '\r\n';
  }
}
