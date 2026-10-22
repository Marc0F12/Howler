import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MhPeerDto, MhPeerStatus } from '@howler/shared';
import { cleanBadge, cleanBadgeColor, defaultBadge, type ServerDto } from '@howler/shared';
import type { WireLap } from '../core/mh-wire';

/** Filtro por Howler de origen: `null` = lo de este servidor; un UUID = lo de ese Howler. Sin filtro = todo. */
export type ServerFilter = { origin: string | null };
export const serverSql = (f: ServerFilter | undefined, alias = ''): string =>
  !f ? '' : f.origin === null ? ` AND ${alias}origin IS NULL` : ` AND ${alias}origin = '${f.origin.replace(/[^0-9a-f-]/gi, '')}'`;
const publicKey = (uuid: string) => sha256(uuid).slice(0, 10);

type Row = Record<string, any>;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 símbolos sin confusiones (0/O, 1/I)

/** Clave de vinculación legible: HWL-XXXX-XXXX-XXXX-XXXX (80 bits). */
export function generateLinkKey(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => KEY_ALPHABET[b & 31]!);
  return 'HWL-' + [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
/** Quita guiones, espacios y mayúsculas para comparar claves tecleadas a mano. */
export const normalizeKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface Peer {
  id: number; direction: 'outgoing' | 'incoming'; peerUuid: string | null; name: string; url: string | null; status: MhPeerStatus;
  tokenPlain: string | null; requestSecret: string | null;
  weGive: boolean; weReceive: boolean; theyGive: boolean; theyReceive: boolean; shareChampionships: boolean; theyShare: boolean; shareTraces: boolean; hidden: boolean;
}
const toPeer = (r: Row): Peer => ({
  id: r.id, direction: r.direction, peerUuid: r.peer_uuid, name: r.name, url: r.url, status: r.status,
  tokenPlain: r.token_plain, requestSecret: r.request_secret,
  weGive: r.we_give === 1, weReceive: r.we_receive === 1, theyGive: r.they_give === 1, theyReceive: r.they_receive === 1,
  shareChampionships: r.share_championships === 1, theyShare: r.they_share === 1, shareTraces: r.share_traces === 1, hidden: r.hidden === 1,
});

/** SQL de MultiHowler: identidad, vínculos y copia de las vueltas de otros Howlers (de solo lectura). */
export class MultiHowlerStore {
  /** Lo pone el Repository: recalcula qué vueltas están ocultas cuando se oculta o muestra un Howler. */
  onHiddenChange?: () => void;

  constructor(private db: DatabaseSync) {
    this.ensureIdentity();
  }

  private ensureIdentity() {
    const r = this.db.prepare('SELECT uuid, link_key FROM mh_identity WHERE id = 1').get() as Row;
    if (!r.uuid) this.db.prepare('UPDATE mh_identity SET uuid = ? WHERE id = 1').run(randomUUID());
    if (!(this.db.prepare('SELECT badge FROM mh_identity WHERE id = 1').get() as Row).badge) this.db.prepare('UPDATE mh_identity SET badge = ? WHERE id = 1').run(defaultBadge(this.name));
    if (!r.link_key) this.db.prepare('UPDATE mh_identity SET link_key = ? WHERE id = 1').run(generateLinkKey());
  }

  /** La insignia que manda otro Howler se vuelve a limpiar aquí: si no cumple las reglas, se usa una derivada de su nombre. */
  private safeBadge(raw: string | undefined, name: string): string {
    try { return cleanBadge(raw ?? ''); } catch { return defaultBadge(name); }
  }

  /** Identidad permanente de este Howler (interna; no se enseña). */
  get uuid(): string { return (this.db.prepare('SELECT uuid FROM mh_identity WHERE id = 1').get() as Row).uuid; }
  get name(): string { return (this.db.prepare('SELECT name FROM mh_identity WHERE id = 1').get() as Row).name; }
  get linkKey(): string { return (this.db.prepare('SELECT link_key FROM mh_identity WHERE id = 1').get() as Row).link_key; }
  get badge(): string { return (this.db.prepare('SELECT badge FROM mh_identity WHERE id = 1').get() as Row).badge; }
  get badgeBg(): string { return (this.db.prepare('SELECT badge_bg FROM mh_identity WHERE id = 1').get() as Row).badge_bg; }
  get badgeFg(): string { return (this.db.prepare('SELECT badge_fg FROM mh_identity WHERE id = 1').get() as Row).badge_fg; }
  get address(): string { return (this.db.prepare('SELECT address FROM mh_identity WHERE id = 1').get() as Row).address; }

  setIdentity(p: { name?: string; address?: string; badge?: string; badgeBg?: string; badgeFg?: string }) {
    if (p.badgeBg !== undefined) this.db.prepare('UPDATE mh_identity SET badge_bg = ? WHERE id = 1').run(cleanBadgeColor(p.badgeBg));
    if (p.badgeFg !== undefined) this.db.prepare('UPDATE mh_identity SET badge_fg = ? WHERE id = 1').run(cleanBadgeColor(p.badgeFg));
    if (p.badge !== undefined) this.db.prepare('UPDATE mh_identity SET badge = ? WHERE id = 1').run(cleanBadge(p.badge));
    if (p.name !== undefined) {
      // Si la insignia es la automática (derivada del nombre), sigue al nombre; si la personalizó, se respeta.
      const auto = p.badge === undefined && this.badge === defaultBadge(this.name);
      this.db.prepare('UPDATE mh_identity SET name = ? WHERE id = 1').run(p.name);
      if (auto) this.db.prepare('UPDATE mh_identity SET badge = ? WHERE id = 1').run(defaultBadge(p.name));
    }
    if (p.address !== undefined) this.db.prepare('UPDATE mh_identity SET address = ? WHERE id = 1').run(p.address);
  }
  /** Primer rev de las vueltas propias que se comparten con la identidad actual (las anteriores quedan solo en este PC). */
  get shareFromRev(): number { return (this.db.prepare('SELECT share_from_rev AS r FROM mh_identity WHERE id = 1').get() as Row).r; }
  /**
   * Identidad nueva (para una carpeta de datos copiada): otro UUID y otra clave. Las vueltas propias que había hasta ahora
   * dejan de compartirse bajo la identidad nueva, porque los demás ya las tienen con la antigua y saldrían duplicadas.
   */
  regenerateIdentity() {
    this.db.prepare('UPDATE mh_identity SET uuid = ?, link_key = ?, share_from_rev = rev WHERE id = 1').run(randomUUID(), generateLinkKey());
  }
  regenerateKey(): string {
    const k = generateLinkKey();
    this.db.prepare('UPDATE mh_identity SET link_key = ? WHERE id = 1').run(k);
    return k;
  }

  // ---------- vínculos ----------

  peers(): Peer[] {
    return (this.db.prepare('SELECT * FROM mh_peers ORDER BY id').all() as Row[]).map(toPeer);
  }
  peer(id: number): Peer | null {
    const r = this.db.prepare('SELECT * FROM mh_peers WHERE id = ?').get(id) as Row | undefined;
    return r ? toPeer(r) : null;
  }
  peerByUuid(uuid: string, direction: 'incoming' | 'outgoing'): Peer | null {
    const r = this.db.prepare('SELECT * FROM mh_peers WHERE peer_uuid = ? AND direction = ? ORDER BY id DESC LIMIT 1').get(uuid, direction) as Row | undefined;
    return r ? toPeer(r) : null;
  }
  peerByToken(token: string): Peer | null {
    const r = this.db.prepare('SELECT * FROM mh_peers WHERE token_hash = ? AND direction = \'incoming\'').get(sha256(token)) as Row | undefined;
    return r ? toPeer(r) : null;
  }
  peerByRequestSecret(uuid: string, secret: string): Peer | null {
    const r = this.db.prepare('SELECT * FROM mh_peers WHERE direction = \'incoming\' AND peer_uuid = ? AND request_secret_hash = ?').get(uuid, sha256(secret)) as Row | undefined;
    return r ? toPeer(r) : null;
  }

  /** Solicitud recibida: un vínculo pendiente que el dueño aprobará o denegará. Sustituye una solicitud anterior del mismo Howler. */
  createIncoming(p: { uuid: string; name: string; give: boolean; receive: boolean }): { id: number; secret: string } {
    const secret = randomBytes(16).toString('hex');
    this.db.prepare(`DELETE FROM mh_peers WHERE direction = 'incoming' AND peer_uuid = ? AND status IN ('pending','denied')`).run(p.uuid);
    // «Quiere dar» ↔ yo recibiría; «quiere recibir» ↔ yo daría (valores iniciales propuestos; el dueño decide al aprobar).
    const r = this.db.prepare(
      `INSERT INTO mh_peers (direction, peer_uuid, name, status, request_secret_hash, they_give, they_receive, we_give, we_receive, created_at)
       VALUES ('incoming', ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    ).run(p.uuid, p.name, sha256(secret), p.give ? 1 : 0, p.receive ? 1 : 0, p.receive ? 1 : 0, p.give ? 1 : 0, new Date().toISOString());
    return { id: Number(r.lastInsertRowid), secret };
  }

  /** Aprueba una solicitud: genera el token privado de ese vínculo (se entrega una vez al solicitante). */
  approve(id: number, give: boolean, receive: boolean) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare(
      `UPDATE mh_peers SET status = 'approved', token_hash = ?, token_plain = ?, we_give = ?, we_receive = ? WHERE id = ? AND direction = 'incoming' AND status = 'pending'`,
    ).run(sha256(token), token, give ? 1 : 0, receive ? 1 : 0, id);
  }
  deny(id: number) {
    this.db.prepare(`UPDATE mh_peers SET status = 'denied' WHERE id = ? AND direction = 'incoming' AND status = 'pending'`).run(id);
  }
  /** Anula el vínculo: su token deja de valer. Los datos ya recibidos se conservan. */
  revoke(id: number, error: string | null = null) {
    this.db.prepare(`UPDATE mh_peers SET status = 'revoked', token_hash = NULL, token_plain = NULL, last_error = ? WHERE id = ?`).run(error, id);
  }
  /** El solicitante ya usó su token: deja de guardarse en claro. */
  tokenDelivered(id: number) {
    this.db.prepare('UPDATE mh_peers SET token_plain = NULL WHERE id = ? AND direction = \'incoming\'').run(id);
  }
  /** Vínculo saliente tras ser aceptada la solicitud. */
  createOutgoing(p: { url: string; name: string; peerName: string; give: boolean; receive: boolean; secret: string; peerUuid?: string }): number {
    const r = this.db.prepare(
      `INSERT INTO mh_peers (direction, name, url, status, request_secret, we_give, we_receive, created_at) VALUES ('outgoing', ?, ?, 'requested', ?, ?, ?, ?)`,
    ).run(p.peerName || p.name, p.url, p.secret, p.give ? 1 : 0, p.receive ? 1 : 0, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }
  outgoingApproved(id: number, p: { token: string; peerUuid: string; name: string; theyGive: boolean; theyReceive: boolean }) {
    this.db.prepare(
      `UPDATE mh_peers SET status = 'approved', token_plain = ?, peer_uuid = ?, name = ?, request_secret = NULL, they_give = ?, they_receive = ?, last_error = NULL WHERE id = ?`,
    ).run(p.token, p.peerUuid, p.name, p.theyGive ? 1 : 0, p.theyReceive ? 1 : 0, id);
  }
  setStatus(id: number, status: MhPeerStatus, error: string | null = null) {
    this.db.prepare('UPDATE mh_peers SET status = ?, last_error = ? WHERE id = ?').run(status, error, id);
  }
  updatePeer(id: number, p: { give?: boolean; receive?: boolean; shareChampionships?: boolean; shareTraces?: boolean; hidden?: boolean }) {
    const set: string[] = []; const args: number[] = [];
    const add = (col: string, v: boolean | undefined) => { if (v !== undefined) { set.push(`${col} = ?`); args.push(v ? 1 : 0); } };
    add('we_give', p.give); add('we_receive', p.receive); add('share_championships', p.shareChampionships); add('share_traces', p.shareTraces); add('hidden', p.hidden);
    if (set.length) this.db.prepare(`UPDATE mh_peers SET ${set.join(', ')} WHERE id = ?`).run(...args, id);
    if (p.hidden !== undefined) this.onHiddenChange?.();
  }
  /** Lo que el otro lado declara en cada intercambio. */
  recordTheirs(id: number, d: { name: string; give: boolean; receive: boolean; shareChampionships?: boolean }) {
    this.db.prepare('UPDATE mh_peers SET name = ?, they_give = ?, they_receive = ?, they_share = ? WHERE id = ?').run(d.name || 'Howler', d.give ? 1 : 0, d.receive ? 1 : 0, d.shareChampionships ? 1 : 0, id);
  }
  recordAttempt(id: number, error: string | null) {
    this.db.prepare('UPDATE mh_peers SET last_attempt_at = ?, last_error = ? WHERE id = ?').run(new Date().toISOString(), error, id);
  }
  recordSync(id: number, newLaps: number) {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE mh_peers SET last_sync_at = ?, last_attempt_at = ?, last_error = NULL, last_new_laps = ? WHERE id = ?').run(now, now, newLaps, id);
  }
  /** Solo para vínculos que no están activos. */
  deletePeer(id: number): boolean {
    return this.db.prepare(`DELETE FROM mh_peers WHERE id = ? AND status <> 'approved'`).run(id).changes > 0;
  }

  peerDtos(): MhPeerDto[] {
    const counts = new Map((this.db.prepare('SELECT origin, COUNT(*) AS n FROM laps WHERE origin IS NOT NULL GROUP BY origin').all() as Row[]).map((r) => [r.origin, r.n as number]));
    return (this.db.prepare('SELECT * FROM mh_peers ORDER BY id').all() as Row[]).map((r) => ({
      id: r.id, direction: r.direction, name: r.name, url: r.url, status: r.status,
      badge: ((r.peer_uuid && (this.db.prepare('SELECT badge FROM mh_origins WHERE uuid = ?').get(r.peer_uuid) as Row | undefined)?.badge) as string) || defaultBadge(r.name),
      badgeBg: (r.peer_uuid && (this.db.prepare('SELECT badge_bg FROM mh_origins WHERE uuid = ?').get(r.peer_uuid) as Row | undefined)?.badge_bg) || '',
      badgeFg: (r.peer_uuid && (this.db.prepare('SELECT badge_fg FROM mh_origins WHERE uuid = ?').get(r.peer_uuid) as Row | undefined)?.badge_fg) || '',
      give: r.we_give === 1, receive: r.we_receive === 1, theyGive: r.they_give === 1, theyReceive: r.they_receive === 1,
      shareChampionships: r.share_championships === 1, shareTraces: r.share_traces === 1, hidden: r.hidden === 1, createdAt: r.created_at,
      lastSyncAt: r.last_sync_at, lastAttemptAt: r.last_attempt_at, lastError: r.last_error, lastNewLaps: r.last_new_laps,
      lapsFrom: (r.peer_uuid && counts.get(r.peer_uuid)) || 0,
    }));
  }

  // ---------- servidores de origen (filtro de la web) ----------

  /** Insignia (texto y colores) del servidor donde nació algo: `null` = este. */
  badgeOf(origin: string | null): { text: string; bg: string; fg: string } {
    if (origin == null) return { text: this.badge, bg: this.badgeBg, fg: this.badgeFg };
    const r = this.db.prepare('SELECT badge, name, badge_bg, badge_fg FROM mh_origins WHERE uuid = ?').get(origin) as Row | undefined;
    return { text: r?.badge || defaultBadge(r?.name ?? 'Howler'), bg: r?.badge_bg ?? '', fg: r?.badge_fg ?? '' };
  }

  /** Servidores de los que hay vueltas visibles. Las claves son un resumen del UUID: la identidad no sale. */
  servers(): ServerDto[] {
    const local = (this.db.prepare('SELECT COUNT(*) AS n FROM laps WHERE origin IS NULL AND hidden = 0').get() as Row).n as number;
    const rows = this.db.prepare(
      `SELECT l.origin, COUNT(*) AS n, COALESCE(o.name, (SELECT p.name FROM mh_peers p WHERE p.peer_uuid = l.origin LIMIT 1), 'Otro Howler') AS name, COALESCE(o.badge, '') AS badge, COALESCE(o.badge_bg, '') AS bg, COALESCE(o.badge_fg, '') AS fg
       FROM laps l LEFT JOIN mh_origins o ON o.uuid = l.origin WHERE l.origin IS NOT NULL AND l.hidden = 0 GROUP BY l.origin ORDER BY name`,
    ).all() as Row[];
    if (!rows.length) return [];
    return [{ key: 'local', name: this.name, badge: this.badge, badgeBg: this.badgeBg, badgeFg: this.badgeFg, laps: local, local: true }, ...rows.map((r) => ({ key: publicKey(r.origin), name: r.name, badge: r.badge || defaultBadge(r.name), badgeBg: r.bg, badgeFg: r.fg, laps: r.n, local: false }))];
  }
  /** De la clave de la web al filtro SQL; una clave desconocida no devuelve nada. */
  serverFilter(key: string | undefined): ServerFilter | undefined {
    if (!key || key === 'all') return undefined;
    if (key === 'local') return { origin: null };
    const hit = (this.db.prepare('SELECT DISTINCT origin FROM laps WHERE origin IS NOT NULL').all() as Row[]).find((r) => publicKey(r.origin) === key);
    return { origin: hit ? hit.origin : '00000000-0000-0000-0000-000000000000' };
  }

  /** Borra para siempre las copias de las vueltas (y sesiones) de un Howler. Lo propio no se toca. */
  deleteOriginData(uuid: string): number {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM championships WHERE origin = ?').run(uuid);
      const n = this.db.prepare('DELETE FROM laps WHERE origin = ?').run(uuid).changes as number;
      this.db.prepare('DELETE FROM sessions WHERE origin = ? AND NOT EXISTS (SELECT 1 FROM laps l WHERE l.session_id = sessions.id)').run(uuid);
      this.db.exec('COMMIT');
      return Number(n);
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- datos ----------

  /** Hasta qué rev tengo guardado de cada Howler de origen (solo copias ajenas). */
  have(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT origin, MAX(origin_rev) AS m FROM laps WHERE origin IS NOT NULL GROUP BY origin').all() as Row[]) out[r.origin] = r.m;
    return out;
  }

  private lapSelect = `
    SELECT l.*, d.steam_id AS d_steam, d.name AS d_name,
           s.id AS s_id, s.track AS s_track, s.layout AS s_layout, s.name AS s_name, s.type AS s_type, s.started_at AS s_started, s.ended_at AS s_ended,
           s.fuel_pct, s.damage_pct, s.tyre_wear_pct, s.tyres_out, s.origin_id AS s_origin_id
    FROM laps l JOIN drivers d ON d.id = l.driver_id JOIN sessions s ON s.id = l.session_id`;

  /** Una vuelta PROPIA (`origin IS NULL`) en el formato que viaja; `sectors` ya trae sus sectores. */
  private toWire(r: Row, sectors: number[]): WireLap {
    return {
      origin: this.uuid, originId: r.id, rev: r.rev,
      originBadge: this.badge, originBadgeBg: this.badgeBg || undefined, originBadgeFg: this.badgeFg || undefined, originName: this.name,
      session: {
        id: r.s_id, track: r.s_track, layout: r.s_layout, name: r.s_name, type: r.s_type, startedAt: r.s_started, endedAt: r.s_ended,
        fuelPct: r.fuel_pct ?? null, damagePct: r.damage_pct ?? null, tyreWearPct: r.tyre_wear_pct ?? null, tyresOut: r.tyres_out ?? null,
      },
      driver: { steamId: r.d_steam, name: r.d_name },
      track: r.track, layout: r.layout, car: r.car, lapMs: r.lap_ms, cuts: r.cuts, grip: r.grip ?? null,
      valid: r.valid === 1, pending: r.pending === 1, invalidReason: r.invalid_reason ?? null,
      outLap: r.out_lap === 1, sectorsExact: r.sectors_exact === 1, maxSpeed: r.max_speed ?? null,
      createdAt: r.created_at, tempAir: r.temp_air ?? null, tempTrack: r.temp_track ?? null, aids: r.aids ?? null, sectorsMs: sectors,
    };
  }

  /**
   * Vueltas PROPIAS que el otro Howler aún no tiene (según su `have`). Solo se comparte lo que nació aquí: no hay relevo; quien
   * quiera los datos de otro Howler tiene que vincularse con él directamente.
   */
  changesFor(have: Record<string, number>, limit: number): WireLap[] {
    const rows = this.db.prepare(`${this.lapSelect} WHERE l.origin IS NULL AND l.rev > ? ORDER BY l.rev LIMIT ?`).all(Math.max(have[this.uuid] ?? 0, this.shareFromRev), limit) as Row[];
    if (rows.length === 0) return [];
    // Los sectores de todo el lote en una sola consulta (no una por vuelta).
    const bySector = new Map<number, number[]>();
    const marks = rows.map(() => '?').join(',');
    for (const x of this.db.prepare(`SELECT lap_id, ms FROM lap_sectors WHERE lap_id IN (${marks}) ORDER BY lap_id, idx`).all(...rows.map((r) => r.id as number)) as Row[]) {
      (bySector.get(x.lap_id) ?? bySector.set(x.lap_id, []).get(x.lap_id)!).push(x.ms as number);
    }
    return rows.map((r) => this.toWire(r, bySector.get(r.id) ?? []));
  }

  /**
   * Guarda copias de vueltas de otros Howlers (idempotente por origen + id; solo avanza si el rev es mayor).
   * Solo se aceptan las que nacieron en `fromOrigin` (el Howler que las manda): un par no puede traer datos de terceros.
   * Devuelve cuántas son nuevas y cuántas actualizan una que ya había.
   */
  applyLaps(laps: WireLap[], fromOrigin: string): { added: number; updated: number } {
    let added = 0, updated = 0;
    const self = this.uuid;
    this.db.exec('BEGIN');
    try {
      for (const w of laps) {
        if (w.origin === self || w.origin !== fromOrigin) continue;
        const existing = this.db.prepare('SELECT id, origin_rev FROM laps WHERE origin = ? AND origin_id = ?').get(w.origin, w.originId) as Row | undefined;
        if (existing && existing.origin_rev >= w.rev) continue;
        if (w.originName) this.db.prepare('INSERT INTO mh_origins (uuid, name, badge, badge_bg, badge_fg) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, badge = excluded.badge, badge_bg = excluded.badge_bg, badge_fg = excluded.badge_fg').run(w.origin, w.originName, this.safeBadge(w.originBadge, w.originName), cleanBadgeColor(w.originBadgeBg), cleanBadgeColor(w.originBadgeFg));
        const sessionId = this.upsertSession(w);
        const driverId = this.driverFor(w.driver.steamId, w.driver.name);
        let lapId: number;
        if (existing) {
          lapId = existing.id;
          this.db.prepare(
            `UPDATE laps SET session_id = ?, driver_id = ?, track = ?, layout = ?, car = ?, lap_ms = ?, cuts = ?, grip = ?, valid = ?, invalid_reason = ?, pending = ?,
             out_lap = ?, sectors_exact = ?, max_speed = ?, temp_air = ?, temp_track = ?, aids = ?, origin_rev = ? WHERE id = ?`,
          ).run(sessionId, driverId, w.track, w.layout, w.car, w.lapMs, w.cuts, w.grip, w.valid ? 1 : 0, w.invalidReason, w.pending ? 1 : 0,
            w.outLap ? 1 : 0, w.sectorsExact ? 1 : 0, w.maxSpeed, w.tempAir, w.tempTrack, w.aids, w.rev, lapId);
          this.db.prepare('DELETE FROM lap_sectors WHERE lap_id = ?').run(lapId);
          updated++;
        } else {
          const r = this.db.prepare(
            `INSERT INTO laps (session_id, driver_id, track, layout, car, lap_ms, cuts, grip, valid, invalid_reason, pending, created_at, sectors_exact, source, max_speed,
             out_lap, temp_air, temp_track, aids, origin, origin_id, origin_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'peer', ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(sessionId, driverId, w.track, w.layout, w.car, w.lapMs, w.cuts, w.grip, w.valid ? 1 : 0, w.invalidReason, w.pending ? 1 : 0, w.createdAt,
            w.sectorsExact ? 1 : 0, w.maxSpeed, w.outLap ? 1 : 0, w.tempAir, w.tempTrack, w.aids, w.origin, w.originId, w.rev);
          lapId = Number(r.lastInsertRowid);
          added++;
        }
        w.sectorsMs.forEach((ms, idx) => this.db.prepare('INSERT INTO lap_sectors (lap_id, idx, ms) VALUES (?, ?, ?)').run(lapId, idx, ms));
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { added, updated };
  }

  private upsertSession(w: WireLap): number {
    const s = w.session;
    const found = this.db.prepare('SELECT id FROM sessions WHERE origin = ? AND origin_id = ?').get(w.origin, s.id) as Row | undefined;
    if (found) {
      this.db.prepare('UPDATE sessions SET ended_at = ?, name = ? WHERE id = ?').run(s.endedAt, s.name, found.id);
      return found.id;
    }
    const r = this.db.prepare(
      `INSERT INTO sessions (track, layout, name, type, started_at, ended_at, fuel_pct, damage_pct, tyre_wear_pct, tyres_out, origin, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(s.track, s.layout, s.name, s.type, s.startedAt, s.endedAt, s.fuelPct, s.damagePct, s.tyreWearPct, s.tyresOut, w.origin, s.id);
    return Number(r.lastInsertRowid);
  }

  /** Un piloto de otro Howler se une automáticamente al local con el mismo Steam ID; si no existe se crea. No pisa nombres locales. */
  driverFor(steamId: string, name: string): number {
    const alias = this.db.prepare('SELECT driver_id FROM driver_aliases WHERE steam_id = ?').get(steamId) as Row | undefined;
    if (alias) return alias.driver_id;
    const found = this.db.prepare('SELECT id FROM drivers WHERE steam_id = ?').get(steamId) as Row | undefined;
    if (found) return found.id;
    const now = new Date().toISOString();
    return Number(this.db.prepare('INSERT INTO drivers (steam_id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(steamId, name || 'Piloto', now, now).lastInsertRowid);
  }
}
