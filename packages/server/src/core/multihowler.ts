import { createHash, timingSafeEqual } from 'node:crypto';
import type { MhStateDto } from '@howler/shared';
import type { MultiHowlerStore, Peer } from '../db/multihowler';
import { normalizeKey } from '../db/multihowler';
import type { SharedChampionships } from '../db/shared-championships';
import type { MhTraces, WireTrace } from '../db/mh-traces';
import { MAX_BATCH, syncResponseSchema, type SyncRequest, type SyncResponse } from './mh-wire';

/** Error con código HTTP para las rutas. */
export class MhError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Límite de intentos fallidos con la clave: tras `max` fallos seguidos, espera `windowMs`. */
export class AttemptLimiter {
  private fails = new Map<string, { n: number; first: number }>();
  constructor(private max = 5, private windowMs = 60_000, private now: () => number = Date.now) {}
  blocked(key: string): boolean {
    const f = this.fails.get(key);
    if (!f) return false;
    if (this.now() - f.first > this.windowMs) { this.fails.delete(key); return false; }
    return f.n >= this.max;
  }
  fail(key: string) {
    const f = this.fails.get(key);
    if (!f || this.now() - f.first > this.windowMs) {
      if (this.fails.size >= 5000) this.evictExpired(); // un aluvión de direcciones distintas no hace crecer el mapa sin límite
      this.fails.set(key, { n: 1, first: this.now() });
    } else f.n++;
  }
  private evictExpired() {
    for (const [k, v] of this.fails) if (this.now() - v.first > this.windowMs) this.fails.delete(k);
    if (this.fails.size >= 5000) this.fails.clear();
  }
  reset(key: string) { this.fails.delete(key); }
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export interface MultiHowlerOpts {
  fetchFn?: typeof fetch;
  /** Se llama al guardar vueltas ajenas (para que la web recargue). */
  onLapsChanged?: () => void;
  limiter?: AttemptLimiter;
  timeoutMs?: number;
  /** Campeonatos compartidos (paso 6). Sin esto no se intercambian. */
  shared?: SharedChampionships;
  /** Trayectorias de las mejores vueltas. Sin esto no se intercambian. */
  traces?: MhTraces;
}

/** Lógica de MultiHowler: vinculación con aprobación manual e intercambio de vueltas entre pares. */
export class MultiHowler {
  private fetchFn: typeof fetch;
  private limiter: AttemptLimiter;
  private globalLimiter = new AttemptLimiter(40, 60_000);
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<number>();

  constructor(readonly store: MultiHowlerStore, private opts: MultiHowlerOpts = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.limiter = opts.limiter ?? new AttemptLimiter();
  }

  onLapsChanged() { this.opts.onLapsChanged?.(); }

  state(): MhStateDto {
    return { name: this.store.name, badge: this.store.badge, badgeBg: this.store.badgeBg, badgeFg: this.store.badgeFg, key: this.store.linkKey, address: this.store.address, peers: this.store.peerDtos() };
  }

  // ---------- lado que recibe (rutas públicas) ----------

  /** Alguien pide vincularse con la clave: si es correcta queda una solicitud pendiente para el dueño. */
  requestLink(ip: string, b: { key: string; uuid: string; name: string; give: boolean; receive: boolean }): { status: 'pending'; secret: string } {
    if (this.limiter.blocked(ip) || this.globalLimiter.blocked('all')) throw new MhError(429, 'Demasiados intentos. Espera un minuto.');
    if (!sameSecret(normalizeKey(b.key), normalizeKey(this.store.linkKey))) {
      this.limiter.fail(ip); this.globalLimiter.fail('all');
      throw new MhError(403, 'Clave incorrecta.');
    }
    this.limiter.reset(ip);
    if (b.uuid === this.store.uuid) throw new MhError(409, 'Este Howler tiene la misma identidad que el tuyo: parece una copia de la carpeta de datos.');
    const existing = this.store.peerByUuid(b.uuid, 'incoming');
    if (existing && existing.status === 'approved') throw new MhError(409, 'Ya estáis vinculados. Para empezar de nuevo, el otro lado debe revocar el vínculo.');
    const { secret } = this.store.createIncoming({ uuid: b.uuid, name: b.name || 'Howler', give: b.give, receive: b.receive });
    return { status: 'pending', secret };
  }

  /** El solicitante pregunta si ya lo han aprobado; con la aprobación recibe su token (una vez). */
  linkStatus(ip: string, b: { uuid: string; secret: string }):
    | { status: 'pending' | 'denied' | 'revoked' }
    | { status: 'approved'; token: string; uuid: string; name: string; give: boolean; receive: boolean } {
    if (this.limiter.blocked(ip)) throw new MhError(429, 'Demasiados intentos. Espera un minuto.');
    const p = this.store.peerByRequestSecret(b.uuid, b.secret);
    if (!p) { this.limiter.fail(ip); throw new MhError(404, 'Solicitud desconocida.'); }
    if (p.status === 'approved' && p.tokenPlain) {
      return { status: 'approved', token: p.tokenPlain, uuid: this.store.uuid, name: this.store.name, give: p.weGive, receive: p.weReceive };
    }
    if (p.status === 'approved') throw new MhError(410, 'El token ya se entregó.');
    return { status: p.status === 'pending' ? 'pending' : p.status === 'denied' ? 'denied' : 'revoked' };
  }

  authenticate(token: string | undefined): Peer {
    if (!token) throw new MhError(401, 'No autorizado.');
    const p = this.store.peerByToken(token);
    if (!p || p.status !== 'approved') throw new MhError(401, 'No autorizado.');
    return p;
  }

  /** Intercambio en los dos sentidos con un par ya aprobado. */
  handleSync(token: string | undefined, req: SyncRequest): SyncResponse {
    const p = this.authenticate(token);
    if (req.uuid !== p.peerUuid) throw new MhError(409, 'La identidad no coincide con este vínculo.');
    if (p.tokenPlain) this.store.tokenDelivered(p.id);
    this.store.recordTheirs(p.id, req);
    let added = 0;
    if (req.push.length && p.weReceive && req.give) {
      const r = this.store.applyLaps(req.push, p.peerUuid!);
      added = r.added;
      if (r.added + r.updated) this.opts.onLapsChanged?.();
    }
    if (this.opts.shared && req.championships && p.weReceive && req.give && p.shareChampionships) {
      this.opts.shared.applyFrom(p.peerUuid!, req.championships, (s, n) => this.store.driverFor(s, n));
      this.opts.onLapsChanged?.();
    }
    // Si el otro lado dejó de compartir campeonatos, sus copias aquí se borran (solo son copias de lo que él comparte).
    if (this.opts.shared && req.shareChampionships === false) {
      this.opts.shared.removeFrom(p.peerUuid!);
      this.opts.onLapsChanged?.();
    }
    this.opts.shared?.relink();
    // Trayectorias: solo si los DOS lados tienen el interruptor activo.
    const tr = this.opts.traces && p.shareTraces && req.shareTraces === true ? this.opts.traces : null;
    let answer: { traces: WireTrace[]; done: number[] } | null = null;
    let wantTraces: number[] = [];
    if (tr) {
      if (p.weReceive && req.give && (req.traces?.length || req.tracesDone?.length)) {
        if (tr.apply(p.peerUuid!, req.traces ?? [], req.tracesDone ?? [])) this.opts.onLapsChanged?.();
      }
      if (p.weGive && req.receive && req.wantTraces?.length) answer = tr.answer(req.wantTraces);
      if (p.weReceive && req.give) wantTraces = tr.wanted(p.peerUuid!);
    }
    this.store.recordSync(p.id, added);
    const mayGive = p.weGive && req.receive;
    return {
      uuid: this.store.uuid, name: this.store.name, give: p.weGive, receive: p.weReceive, shareChampionships: p.shareChampionships,
      have: this.store.have(),
      changes: mayGive ? this.store.changesFor(req.have, MAX_BATCH) : [],
      ...(this.opts.shared && mayGive && p.shareChampionships && req.wantChampionships ? { championships: this.opts.shared.exportOwn() } : {}),
      shareTraces: p.shareTraces,
      ...(answer ? { traces: answer.traces, tracesDone: answer.done } : {}),
      ...(wantTraces.length ? { wantTraces } : {}),
    };
  }

  /** El otro lado anula el vínculo. */
  handleUnlink(token: string | undefined) {
    const p = this.authenticate(token);
    this.store.revoke(p.id, 'El otro Howler ha cerrado el vínculo.');
  }

  // ---------- lado que llama ----------

  private async call(url: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      const res = await this.fetchFn(url.replace(/\/+$/, '') + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: ctl.signal,
        redirect: 'error',
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    } catch (e) {
      throw new MhError(502, e instanceof Error && e.name === 'AbortError' ? 'El otro Howler no responde.' : 'No se pudo conectar con el otro Howler.');
    } finally {
      clearTimeout(timer);
    }
  }

  /** «Vincular con otro Howler»: manda la solicitud con su clave. Queda esperando a que el otro la apruebe. */
  async startLink(p: { url: string; key: string; give: boolean; receive: boolean }): Promise<number> {
    let url: URL;
    try { url = new URL(p.url.trim()); } catch { throw new MhError(400, 'La dirección no es válida.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new MhError(400, 'La dirección debe empezar por http:// o https://');
    if (!p.give && !p.receive) throw new MhError(400, 'Elige al menos recibir o dar.');
    const base = url.origin;
    if (this.store.peers().some((x) => x.direction === 'outgoing' && x.url === base && (x.status === 'requested' || x.status === 'approved'))) {
      throw new MhError(409, 'Ya hay un vínculo o una solicitud con esa dirección.');
    }
    const r = await this.call(base, '/api/mh/request', { key: p.key, uuid: this.store.uuid, name: this.store.name, give: p.give, receive: p.receive });
    if (r.status !== 200) throw new MhError(r.status === 403 || r.status === 409 || r.status === 429 ? r.status : 502, r.json?.error ?? 'El otro Howler no aceptó la solicitud.');
    if (typeof r.json?.secret !== 'string' || !/^[0-9a-f]{32}$/.test(r.json.secret)) throw new MhError(502, 'Respuesta no válida del otro Howler.');
    return this.store.createOutgoing({ url: base, name: url.host, peerName: url.host, give: p.give, receive: p.receive, secret: r.json.secret });
  }

  /** Pregunta si una solicitud enviada ya se aprobó. */
  private async pollRequest(peer: Peer): Promise<void> {
    if (!peer.url || !peer.requestSecret) return;
    const r = await this.call(peer.url, '/api/mh/request/status', { uuid: this.store.uuid, secret: peer.requestSecret });
    if (r.status === 404 || r.status === 410) { this.store.setStatus(peer.id, 'revoked', 'El otro Howler ya no conoce esta solicitud.'); return; }
    if (r.status !== 200) throw new MhError(502, r.json?.error ?? 'Respuesta inesperada.');
    if (r.json.status === 'denied') this.store.setStatus(peer.id, 'denied', 'El otro Howler ha denegado la solicitud.');
    else if (r.json.status === 'revoked') this.store.setStatus(peer.id, 'revoked', 'El otro Howler ha cerrado la solicitud.');
    else if (r.json.status === 'approved') {
      // Lo que llega de otro Howler se valida: un token o identidad mal formados (o la de un tercero) no se aceptan.
      const { token, uuid } = r.json as { token?: unknown; uuid?: unknown };
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || typeof uuid !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new MhError(502, 'Respuesta no válida del otro Howler.');
      }
      if (uuid === this.store.uuid || this.store.peers().some((x) => x.id !== peer.id && x.status === 'approved' && x.peerUuid === uuid)) {
        throw new MhError(409, 'Esa identidad ya está en uso en otro vínculo (¿carpeta de datos copiada?).');
      }
      this.store.outgoingApproved(peer.id, { token, peerUuid: uuid, name: String(r.json.name ?? peer.name).slice(0, 80), theyGive: !!r.json.give, theyReceive: !!r.json.receive });
    }
  }

  /** Sincroniza con un par aprobado: en una conexión pide y manda cambios hasta que no queda nada. */
  async syncPeer(id: number): Promise<{ received: number; sent: number }> {
    const peer = this.store.peer(id);
    if (!peer || peer.direction !== 'outgoing') throw new MhError(404, 'Vínculo desconocido.');
    if (this.busy.has(id)) return { received: 0, sent: 0 };
    this.busy.add(id);
    try {
      if (peer.status === 'requested') {
        await this.pollRequest(peer);
        this.store.recordAttempt(id, null);
        return { received: 0, sent: 0 };
      }
      if (peer.status !== 'approved' || !peer.url || !peer.tokenPlain) return { received: 0, sent: 0 };
      let theirHave: Record<string, number> | null = null;
      let received = 0, sent = 0, champsSent = false;
      let traceAnswer: { traces: WireTrace[]; done: number[] } | null = null;
      for (let round = 0; round < 40; round++) {
        const cur = this.store.peer(id)!;
        const push = theirHave && cur.weGive && cur.theyReceive ? this.store.changesFor(theirHave, MAX_BATCH) : [];
        const r = await this.call(peer.url, '/api/mh/sync', {
          uuid: this.store.uuid, name: this.store.name, give: cur.weGive, receive: cur.weReceive, shareChampionships: cur.shareChampionships,
          have: this.store.have(), push,
          ...(this.opts.shared && cur.shareChampionships && cur.weReceive && cur.theyGive && round === 0 ? { wantChampionships: true } : {}),
          ...(this.opts.shared && !champsSent && cur.weGive && cur.theyReceive && cur.shareChampionships && cur.theyShare ? { championships: (champsSent = true, this.opts.shared.exportOwn()) } : {}),
          ...(this.opts.traces && cur.shareTraces ? {
            shareTraces: true,
            ...(cur.weReceive && cur.theyGive ? { wantTraces: this.opts.traces.wanted(cur.peerUuid!) } : {}),
            ...(traceAnswer ? { traces: traceAnswer.traces, tracesDone: traceAnswer.done } : {}),
          } : {}),
        }, peer.tokenPlain);
        if (r.status === 401) { this.store.revoke(id, 'El otro Howler ha revocado el vínculo.'); throw new MhError(401, 'El otro Howler ha revocado el vínculo.'); }
        if (r.status !== 200) throw new MhError(502, r.json?.error ?? 'Respuesta inesperada del otro Howler.');
        const parsed = syncResponseSchema.safeParse(r.json);
        if (!parsed.success) throw new MhError(502, 'Respuesta no válida del otro Howler.');
        const resp = parsed.data;
        if (resp.uuid !== cur.peerUuid) throw new MhError(409, 'La identidad del otro Howler ha cambiado.');
        this.store.recordTheirs(id, resp);
        theirHave = resp.have;
        sent += push.length;
        if (resp.changes.length && cur.weReceive && resp.give) {
          const a = this.store.applyLaps(resp.changes, cur.peerUuid!);
          received += a.added;
          if (a.added + a.updated) this.opts.onLapsChanged?.();
        }
        if (this.opts.shared && resp.championships && cur.weReceive && resp.give && cur.shareChampionships) {
          this.opts.shared.applyFrom(cur.peerUuid!, resp.championships, (s, n) => this.store.driverFor(s, n));
          this.opts.onLapsChanged?.();
        }
        if (this.opts.shared && resp.championships === undefined && resp.shareChampionships === false) {
          this.opts.shared.removeFrom(cur.peerUuid!);
          this.opts.onLapsChanged?.();
        }
        // Trayectorias: lo que me contesta (guardo y marco como pedido) y lo que me pide (lo mando en la siguiente ronda)
        let tracesActive = false;
        traceAnswer = null;
        if (this.opts.traces && cur.shareTraces && resp.shareTraces) {
          if (cur.weReceive && resp.give && (resp.traces?.length || resp.tracesDone?.length)) {
            tracesActive = true;
            if (this.opts.traces.apply(cur.peerUuid!, resp.traces ?? [], resp.tracesDone ?? [])) this.opts.onLapsChanged?.();
          }
          if (cur.weGive && resp.receive && resp.wantTraces?.length) { traceAnswer = this.opts.traces.answer(resp.wantTraces); tracesActive = true; }
        }
        if (!push.length && !resp.changes.length && !tracesActive && round > 0) break;
      }
      this.opts.shared?.relink();
      this.store.recordSync(id, received);
      return { received, sent };
    } catch (e) {
      this.store.recordAttempt(id, e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      this.busy.delete(id);
    }
  }

  async syncAll(): Promise<void> {
    for (const p of this.store.peers()) {
      if (p.direction !== 'outgoing' || (p.status !== 'approved' && p.status !== 'requested')) continue;
      try { await this.syncPeer(p.id); } catch { /* queda en last_error */ }
    }
  }

  /** Avisa al otro lado (si se puede) y anula el vínculo en este. */
  async revoke(id: number): Promise<void> {
    const p = this.store.peer(id);
    if (!p) throw new MhError(404, 'Vínculo desconocido.');
    if (p.direction === 'outgoing' && p.status === 'approved' && p.url && p.tokenPlain) {
      await this.call(p.url, '/api/mh/unlink', {}, p.tokenPlain).catch(() => undefined);
    }
    this.store.revoke(id);
  }

  /**
   * Identidad nueva: se cierran todos los vínculos (los demás conocen la identidad antigua) y se genera otra clave.
   * Los datos ya recibidos de otros se conservan.
   */
  async regenerateIdentity(): Promise<void> {
    for (const p of this.store.peers()) {
      if (p.status === 'approved' || p.status === 'pending' || p.status === 'requested') await this.revoke(p.id).catch(() => undefined);
    }
    this.store.regenerateIdentity();
  }

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncAll(), intervalMs);
    this.timer.unref();
    void this.syncAll();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
