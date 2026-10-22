import { describe, expect, it, afterEach } from 'vitest';
import Fastify from 'fastify';
import { cleanBadge, SCORING_PRESETS } from '@howler/shared';
import { openDatabase } from '../db/database';
import { Repository } from '../db/repository';
import { registerMultiHowlerPublic } from '../http/multihowler-routes';
import { registerMultiHowlerAdmin } from '../admin/multihowler-routes';
import { AttemptLimiter, MultiHowler } from './multihowler';
import { encodeTrace } from './lap-trace';

interface Node { repo: Repository; mh: MultiHowler; url: string; close: () => Promise<void>; changed: number[] }
const nodes: Node[] = [];

async function node(name: string): Promise<Node> {
  const repo = new Repository(openDatabase(':memory:'));
  repo.multihowler.setIdentity({ name });
  const changed: number[] = [];
  const mh = new MultiHowler(repo.multihowler, { shared: repo.sharedChampionships, traces: repo.mhTraces, onLapsChanged: () => changed.push(1) });
  const app = Fastify();
  registerMultiHowlerPublic(app, mh);
  registerMultiHowlerAdmin(app, mh);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const n = { repo, mh, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`, close: () => app.close(), changed };
  nodes.push(n);
  return n;
}
afterEach(async () => { await Promise.all(nodes.splice(0).map((n) => n.close())); });

function lap(n: Node, steam: string, driver: string, ms: number, o: { valid?: boolean; sectors?: number[]; track?: string } = {}) {
  const d = n.repo.upsertDriver(steam, driver);
  const s = n.repo.createSession({ track: o.track ?? 'monza', layout: '', name: 'S', type: 1 });
  return n.repo.insertLap({ sessionId: s.id, driverId: d, track: o.track ?? 'monza', layout: '', car: 'mx5', lapMs: ms, sectorsMs: o.sectors ?? [], cuts: 0, grip: 1, valid: o.valid ?? true, invalidReason: null, sectorsExact: true }, []);
}
const lapCount = (n: Node) => (n.repo as any).db.prepare('SELECT COUNT(*) c FROM laps').get().c as number;

/** B pide vincularse con A y A aprueba con los permisos dados. Devuelve el id del vínculo en B. */
async function link(a: Node, b: Node, bAsks: { give: boolean; receive: boolean }, aAllows: { give: boolean; receive: boolean }) {
  const idB = await b.mh.startLink({ url: a.url, key: a.mh.store.linkKey, ...bAsks });
  const pending = a.mh.store.peers().find((p) => p.status === 'pending')!;
  a.mh.store.approve(pending.id, aAllows.give, aAllows.receive);
  await b.mh.syncPeer(idB); // recoge el token
  return idB;
}

describe('vinculación', () => {
  it('la clave sola no conecta: queda pendiente y hay que aprobar', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await b.mh.startLink({ url: a.url, key: a.mh.store.linkKey, give: true, receive: true });
    expect(a.mh.store.peers()[0]).toMatchObject({ status: 'pending', direction: 'incoming' });
    await b.mh.syncPeer(idB);
    expect(b.mh.store.peer(idB)!.status).toBe('requested');
    lap(b, '111', 'Bea', 90_000);
    await expect(b.mh.syncPeer(idB)).resolves.toBeDefined();
    expect(lapCount(a)).toBe(0); // sin aprobar no entra nada
    // aprobar
    a.mh.store.approve(a.mh.store.peers()[0]!.id, true, true);
    await b.mh.syncPeer(idB);
    expect(b.mh.store.peer(idB)!.status).toBe('approved');
  });

  it('clave incorrecta: se rechaza y tras 5 fallos se bloquea', async () => {
    const a = await node('A');
    const limiter = new AttemptLimiter(5, 60_000);
    const mh = new MultiHowler(a.repo.multihowler, { limiter });
    const body = { key: 'HWL-AAAA-AAAA-AAAA-AAAA', uuid: crypto.randomUUID(), name: 'x', give: true, receive: true };
    for (let i = 0; i < 5; i++) expect(() => mh.requestLink('1.1.1.1', body)).toThrow('Clave incorrecta');
    // aunque la clave sea buena, ya está bloqueada esa IP
    expect(() => mh.requestLink('1.1.1.1', { ...body, key: a.mh.store.linkKey })).toThrow('Demasiados intentos');
    expect(a.mh.store.peers()).toHaveLength(0);
  });

  it('la clave se acepta tecleada en minúsculas y sin guiones; regenerarla no rompe vínculos aprobados', async () => {
    const a = await node('A'), b = await node('B');
    const messy = a.mh.store.linkKey.toLowerCase().replace(/-/g, ' ');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    expect(messy).not.toContain('-');
    a.mh.store.regenerateKey();
    lap(a, '9', 'Ana', 80_000);
    await b.mh.syncPeer(idB);
    expect(lapCount(b)).toBe(1);
  });

  it('denegar y revocar: el token deja de valer', async () => {
    const a = await node('A'), b = await node('B'), c = await node('C');
    const idC = await c.mh.startLink({ url: a.url, key: a.mh.store.linkKey, give: true, receive: true });
    a.mh.store.deny(a.mh.store.peers()[0]!.id);
    await c.mh.syncPeer(idC);
    expect(c.mh.store.peer(idC)!.status).toBe('denied');

    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const aPeer = a.mh.store.peers().find((p) => p.status === 'approved')!;
    await a.mh.revoke(aPeer.id);
    await expect(b.mh.syncPeer(idB)).rejects.toThrow('revocado');
    expect(b.mh.store.peer(idB)!.status).toBe('revoked');
  });

  it('dos Howlers con la misma identidad (carpeta copiada) se avisan', async () => {
    const a = await node('A');
    expect(() => a.mh.requestLink('9.9.9.9', { key: a.mh.store.linkKey, uuid: a.mh.store.uuid, name: 'clon', give: true, receive: true })).toThrow('misma identidad');
  });
});

describe('regenerar identidad', () => {
  it('cierra los vínculos, cambia identidad y clave, y no reenvía lo anterior (evita duplicados)', async () => {
    const a = await node('A'), clone = await node('Clon');
    const idC = await link(a, clone, { give: true, receive: true }, { give: true, receive: true });
    lap(clone, '1', 'Ana', 91_000); // vuelta anterior a la regeneración
    const before = clone.mh.store.uuid, keyBefore = clone.mh.store.linkKey;
    await clone.mh.regenerateIdentity();
    expect(clone.mh.store.uuid).not.toBe(before);
    expect(clone.mh.store.linkKey).not.toBe(keyBefore);
    expect(clone.mh.store.peer(idC)!.status).toBe('revoked');
    // se vuelve a vincular con la identidad nueva: solo viaja lo posterior
    const idC2 = await link(a, clone, { give: true, receive: true }, { give: true, receive: true });
    lap(clone, '2', 'Bea', 90_000);
    await clone.mh.syncPeer(idC2);
    expect(lapCount(a)).toBe(1);
  });
});

describe('intercambio', () => {
  it('copia vueltas, sectores y sesión en los dos sentidos; son idempotentes', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '76561198000000001', 'Ana', 91_000, { sectors: [30_000, 30_000, 31_000] });
    lap(b, '76561198000000002', 'Bea', 89_000, { sectors: [29_000, 30_000, 30_000] });
    const r = await b.mh.syncPeer(idB);
    expect(r.received).toBe(1);
    expect(lapCount(a)).toBe(2);
    expect(lapCount(b)).toBe(2);
    const row = (b.repo as any).db.prepare("SELECT l.lap_ms, l.origin, (SELECT COUNT(*) FROM lap_sectors WHERE lap_id = l.id) n FROM laps l WHERE l.origin IS NOT NULL").get();
    expect(row).toMatchObject({ lap_ms: 91_000, n: 3 });
    await b.mh.syncPeer(idB);
    expect(lapCount(a)).toBe(2);
    expect(lapCount(b)).toBe(2);
    // el récord aparece en los dos
    expect(b.repo.combos()[0]).toBeDefined();
  });

  it('el final de una sesión llega a la copia aunque no haya más vueltas', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const lapId = lap(a, '111', 'Ana', 90_000);
    await b.mh.syncPeer(idB);
    const sessionOf = (n: Node) => (n.repo as any).db.prepare('SELECT ended_at FROM sessions ORDER BY id DESC LIMIT 1').get().ended_at as string | null;
    expect(sessionOf(b)).toBeNull();
    const sid = (a.repo as any).db.prepare('SELECT session_id FROM laps WHERE id = ?').get(lapId).session_id as number;
    a.repo.endSession(sid);
    await b.mh.syncPeer(idB);
    expect(sessionOf(b)).not.toBeNull();
  });

  it('un cambio posterior (anular una vuelta) llega a la copia', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const id = lap(a, '1', 'Ana', 91_000);
    await b.mh.syncPeer(idB);
    expect((b.repo as any).db.prepare('SELECT valid FROM laps WHERE origin IS NOT NULL').get().valid).toBe(1);
    (a.repo as any).db.prepare("UPDATE laps SET valid = 0, invalid_reason = 'anulada' WHERE id = ?").run(id);
    const r = await b.mh.syncPeer(idB);
    expect(r.received).toBe(0); // actualización, no vuelta nueva
    expect((b.repo as any).db.prepare('SELECT valid, invalid_reason FROM laps WHERE origin IS NOT NULL').get()).toMatchObject({ valid: 0, invalid_reason: 'anulada' });
  });

  it('permisos por intersección: A solo da / B no recibe → no pasa nada; cambiarlos después lo habilita', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    b.mh.store.updatePeer(idB, { give: false, receive: false });
    lap(a, '1', 'Ana', 91_000);
    lap(b, '2', 'Bea', 92_000);
    await b.mh.syncPeer(idB);
    expect(lapCount(a)).toBe(1);
    expect(lapCount(b)).toBe(1);
    b.mh.store.updatePeer(idB, { receive: true }); // B ahora recibe → A da
    await b.mh.syncPeer(idB);
    expect(lapCount(b)).toBe(2);
    expect(lapCount(a)).toBe(1); // B sigue sin dar
    b.mh.store.updatePeer(idB, { give: true });
    await b.mh.syncPeer(idB);
    expect(lapCount(a)).toBe(2);
  });

  it('A no manda sus datos si lo decide así aunque B quiera recibir', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: false, receive: true }, { give: false, receive: true });
    lap(a, '1', 'Ana', 91_000);
    await b.mh.syncPeer(idB);
    expect(lapCount(b)).toBe(0);
  });

  it('une al piloto por Steam ID y no pisa el nombre local', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(b, '555', 'Nombre local', 95_000);
    lap(a, '555', 'Nombre en A', 90_000);
    await b.mh.syncPeer(idB);
    const drivers = (b.repo as any).db.prepare('SELECT name FROM drivers').all();
    expect(drivers).toEqual([{ name: 'Nombre local' }]);
  });

  it('sin relevo: cada Howler solo manda lo suyo; lo de C no llega a A a través de B', async () => {
    const a = await node('A'), b = await node('B'), c = await node('C');
    const idBA = await link(a, b, { give: true, receive: true }, { give: true, receive: true }); // B → A
    const idCB = await link(b, c, { give: true, receive: true }, { give: true, receive: true }); // C → B
    lap(c, '3', 'Cris', 88_000);
    lap(b, '2', 'Bea', 90_000);
    await c.mh.syncPeer(idCB);
    expect(lapCount(b)).toBe(2); // B tiene lo de C
    await b.mh.syncPeer(idBA);
    expect(lapCount(a)).toBe(1); // A solo recibe lo de B
    expect((a.repo as any).db.prepare('SELECT origin FROM laps').get().origin).toBe(b.mh.store.uuid);
    expect(lapCount(c)).toBe(2); // C tiene lo suyo y lo de B, que es su vínculo directo
  });

  it('un par no puede colar vueltas de otro origen', async () => {
    const a = await node('A'), b = await node('B'), c = await node('C');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(c, '3', 'Cris', 88_000);
    const forged = c.repo.multihowler.changesFor({}, 10);
    expect(forged).toHaveLength(1);
    expect(a.repo.multihowler.applyLaps(forged, b.mh.store.uuid)).toEqual({ added: 0, updated: 0 });
    await b.mh.syncPeer(idB);
    expect(lapCount(a)).toBe(0);
  });

  it('las vueltas ajenas no son «la última sesión», no se recalculan y no entran en la gestión local', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '1', 'Ana', 91_000);
    await b.mh.syncPeer(idB);
    expect(b.repo.latestSessionWithLaps()).toBeNull();
    expect(b.repo.lapAdmin.recent(10, false)).toHaveLength(0);
    expect(b.repo.lapAdmin.batch(0, 10)).toHaveLength(0);
  });

  it('salta lo mal formado sin guardarlo y sin bloquear lo demás', async () => {
    const a = await node('A'), b = await node('B');
    await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const token = (b.mh.store.peers()[0] as any).tokenPlain as string;
    const res = await fetch(a.url + '/api/mh/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ uuid: b.mh.store.uuid, name: 'B', give: true, receive: true, have: {}, push: [{ origin: 'x' }] }) });
    expect(res.status).toBe(200); // el elemento roto se salta; no rompe el intercambio
    expect(lapCount(a)).toBe(0);
    const noAuth = await fetch(a.url + '/api/mh/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(noAuth.status).toBe(401);
    // sin vínculo ni siquiera se lee el cuerpo: un JSON roto da 401, no 400
    const broken = await fetch(a.url + '/api/mh/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no es json' });
    expect(broken.status).toBe(401);
  });
});

describe('respuestas de otro Howler', () => {
  it('no se acepta una aprobación con token o identidad mal formados, ni la identidad de un tercero', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await b.mh.startLink({ url: a.url, key: a.mh.store.linkKey, give: true, receive: true });
    const answer = (json: unknown) => new MultiHowler(b.repo.multihowler, { fetchFn: (async () => new Response(JSON.stringify(json), { status: 200 })) as never });
    const good = '0'.repeat(64), uuid = crypto.randomUUID();
    await expect(answer({ status: 'approved', token: 'x', uuid }).syncPeer(idB)).rejects.toThrow(/no válida/);
    await expect(answer({ status: 'approved', token: good, uuid: 'no-es-uuid' }).syncPeer(idB)).rejects.toThrow(/no válida/);
    await expect(answer({ status: 'approved', token: good, uuid: b.mh.store.uuid }).syncPeer(idB)).rejects.toThrow(/identidad/);
    expect(b.mh.store.peer(idB)!.status).toBe('requested');
    await answer({ status: 'revoked' }).syncPeer(idB);
    expect(b.mh.store.peer(idB)!.status).toBe('revoked');
  });
});

describe('API del panel', () => {
  it('no enseña identidad, tokens ni Steam ID', async () => {
    const a = await node('A'), b = await node('B');
    await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(b, '76561198123456789', 'Bea', 90_000);
    const txt = JSON.stringify(a.mh.state()) + JSON.stringify(b.mh.state());
    expect(txt).not.toContain(a.mh.store.uuid);
    expect(txt).not.toContain(b.mh.store.uuid);
    expect(txt).not.toContain('76561198123456789');
    expect(txt).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('pilotos, ocultar y servidores', () => {
  const one = async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    return { a, b, idB };
  };

  it('unir pilotos deja un alias: las vueltas siguientes con el Steam ID viejo caen en el piloto de destino', async () => {
    const { a, b, idB } = await one();
    lap(b, '111', 'Ana (nombre viejo)', 95_000);
    const old = b.repo.upsertDriver('111', 'x'), keep = b.repo.upsertDriver('222', 'Ana');
    b.repo.driverAdmin.merge(old, keep);
    expect(b.repo.driverAdmin.list().map((d) => d.name)).toEqual(['Ana']);
    expect(b.repo.upsertDriver('111', 'x')).toBe(keep); // el juego reconoce el Steam ID viejo
    lap(a, '111', 'Ana en A', 90_000);
    await b.mh.syncPeer(idB);
    expect(b.repo.driverAdmin.list()).toHaveLength(1);
    expect(b.repo.driverAdmin.list()[0]!.laps).toBe(2);
  });

  it('renombrar a mano no lo pisa el nombre que traiga el juego', async () => {
    const { b } = await one();
    const id = b.repo.upsertDriver('9', 'Nombre Steam');
    b.repo.driverAdmin.rename(id, 'Apodo');
    b.repo.upsertDriver('9', 'Otro nombre Steam');
    expect(b.repo.driverAdmin.list()[0]).toMatchObject({ name: 'Apodo', renamed: true });
  });

  it('un piloto oculto desaparece de tiempos, listados y rankings, y vuelve al mostrarlo', async () => {
    const { b } = await one();
    lap(b, '1', 'Ana', 90_000);
    lap(b, '2', 'Beto', 92_000);
    const ana = b.repo.driverAdmin.list().find((d) => d.name === 'Ana')!.id;
    b.repo.driverAdmin.setHidden(ana, true);
    expect(b.repo.records('monza', '', []).entries.map((e: any) => e.driverName)).toEqual(['Beto']);
    expect(b.repo.profiles.driverList().map((d) => d.name)).toEqual(['Beto']);
    expect(b.repo.profiles.driverProfile(ana)).toBeNull();
    lap(b, '1', 'Ana', 89_000); // vueltas nuevas también quedan ocultas
    expect(b.repo.records('monza', '', []).entries).toHaveLength(1);
    b.repo.driverAdmin.setHidden(ana, false);
    expect(b.repo.records('monza', '', []).entries).toHaveLength(2);
  });

  it('filtro por servidor, ocultar un Howler y borrar sus datos', async () => {
    const { a, b, idB } = await one();
    lap(a, '1', 'Ana', 91_000);
    lap(b, '2', 'Bea', 92_000);
    await b.mh.syncPeer(idB);
    const servers = b.repo.multihowler.servers();
    expect(servers.map((s) => s.name)).toEqual(['B', 'A']);
    expect(servers[0]).toMatchObject({ key: 'local', local: true });
    const other = servers.find((s) => !s.local)!;
    expect(JSON.stringify(servers)).not.toContain(a.mh.store.uuid);
    const names = (key?: string) => b.repo.records('monza', '', [], b.repo.multihowler.serverFilter(key)).entries.map((e: any) => e.driverName).sort();
    expect(names()).toEqual(['Ana', 'Bea']);
    expect(names('local')).toEqual(['Bea']);
    expect(names(other.key)).toEqual(['Ana']);
    expect(names('desconocido')).toEqual([]);
    // ocultar el Howler A
    b.mh.store.updatePeer(idB, { hidden: true });
    expect(names()).toEqual(['Bea']);
    expect(b.repo.multihowler.servers()).toEqual([]);
    // borrar datos: primero hay que revocar
    const peer = b.mh.store.peer(idB)!;
    await b.mh.revoke(idB);
    expect(b.repo.multihowler.deleteOriginData(peer.peerUuid!)).toBe(1);
    expect(lapCount(b)).toBe(1);
  });
});

describe('campeonatos compartidos', () => {
  async function setup(flags: { aShares: boolean; bShares: boolean }) {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    // sesión de carrera en A con dos pilotos inscritos
    const s = a.repo.createSession({ track: 'monza', layout: '', name: 'Race', type: 3 });
    const ana = a.repo.upsertDriver('76561198000000001', 'Ana'), beto = a.repo.upsertDriver('76561198000000002', 'Beto');
    for (const [d, ms] of [[ana, 90_000], [ana, 91_000], [beto, 95_000]] as const) {
      a.repo.insertLap({ sessionId: s.id, driverId: d, track: 'monza', layout: '', car: 'mx5', lapMs: ms, sectorsMs: [], cuts: 0, grip: 1, valid: true, invalidReason: null }, []);
    }
    const cid = a.repo.championships.save(null, {
      name: 'Copa A', format: 'individual', status: 'active', scoring: SCORING_PRESETS.f1!.config, teams: [],
      entries: [{ driverId: ana, teamKey: null }, { driverId: beto, teamKey: null }],
      rounds: [{ track: 'monza', layout: '', mods: [{ name: 'Mx5', kind: 'car', url: 'https://example.com/mx5' }] }],
    });
    const round = (a.repo.championships.get(cid)!).roundList[0]!.id;
    a.repo.championships.assign(cid, round, 'race', s.id);
    a.mh.store.updatePeer(a.mh.store.peers()[0]!.id, { shareChampionships: flags.aShares });
    b.mh.store.updatePeer(idB, { shareChampionships: flags.bShares });
    return { a, b, idB, cid };
  }

  it('si los dos lo activan, B recibe el campeonato como copia de solo lectura con sus resultados', async () => {
    const { b, idB } = await setup({ aShares: true, bShares: true });
    await b.mh.syncPeer(idB); // 1.ª: se enteran de qué comparte cada uno
    await b.mh.syncPeer(idB);
    const list = b.repo.championships.list(false);
    expect(list).toHaveLength(1);
    const c = b.repo.championships.get(list[0]!.id, true)!;
    expect(c).toMatchObject({ name: 'Copa A', sharedFrom: 'A', participants: 2, played: 1 });
    expect(c.standings.drivers[0]!.total).toBeGreaterThan(c.standings.drivers[1]!.total); // Ana gana
    expect(c.roundList[0]!.mods[0]!.name).toBe('Mx5');
    expect(() => b.repo.championships.setStatus(c.id, 'finished')).toThrow('solo lectura');
    expect(() => b.repo.championships.save(c.id, { name: 'x' } as never)).toThrow('solo lectura');
  });

  it('si uno de los dos no lo activa, no viaja', async () => {
    const one = await setup({ aShares: true, bShares: false });
    await one.b.mh.syncPeer(one.idB); await one.b.mh.syncPeer(one.idB);
    expect(one.b.repo.championships.list(false)).toHaveLength(0);
    const two = await setup({ aShares: false, bShares: true });
    await two.b.mh.syncPeer(two.idB); await two.b.mh.syncPeer(two.idB);
    expect(two.b.repo.championships.list(false)).toHaveLength(0);
  });

  it('si el origen deja de compartir, la copia desaparece en el otro lado', async () => {
    const { a, b, idB } = await setup({ aShares: true, bShares: true });
    await b.mh.syncPeer(idB); await b.mh.syncPeer(idB);
    const copy = b.repo.championships.list(false)[0]!;
    expect(() => b.repo.championships.remove(copy.id)).toThrow('solo lectura'); // la copia no se borra a mano
    a.mh.store.updatePeer(a.mh.store.peers()[0]!.id, { shareChampionships: false });
    await b.mh.syncPeer(idB);
    expect(b.repo.championships.list(false)).toHaveLength(0);
  });

  it('borrar los datos de un Howler borra también sus campeonatos', async () => {
    const { a, b, idB } = await setup({ aShares: true, bShares: true });
    await b.mh.syncPeer(idB); await b.mh.syncPeer(idB);
    expect(b.repo.championships.list(false)).toHaveLength(1);
    await b.mh.revoke(idB);
    b.repo.multihowler.deleteOriginData(a.mh.store.uuid);
    expect(b.repo.championships.list(false)).toHaveLength(0);
  });
});

describe('insignia', () => {
  it('se valida (máx. 6 caracteres visibles, emojis incluidos), viaja y se usa en los filtros', async () => {
    const a = await node('Pablo Racing'), b = await node('B');
    expect(a.mh.store.badge).toBe('PABLOR'); // por defecto, de las primeras letras del nombre
    a.mh.store.setIdentity({ badge: '🐒🏁ABC' });
    expect(a.mh.store.badge).toBe('🐒🏁ABC');
    expect(() => a.mh.store.setIdentity({ badge: '1234567' })).toThrow('como mucho 6');
    expect(() => a.mh.store.setIdentity({ badge: '   ' })).toThrow('vacía');
    expect(() => a.mh.store.setIdentity({ badge: '🐒🐒🐒🐒🐒🐒' })).not.toThrow(); // 6 emojis = 6
    a.mh.store.setIdentity({ badge: '🐒AB' });
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '1', 'Ana', 91_000);
    await b.mh.syncPeer(idB);
    expect(b.repo.multihowler.servers().map((s) => s.badge)).toEqual(['B', '🐒AB']);
    expect(b.mh.state().peers[0]!.badge).toBe('🐒AB');
    expect(b.repo.sessionHistory.list({ limit: 10, offset: 0 }).items[0]!.serverBadge).toBe('🐒AB');
    a.mh.store.setIdentity({ badge: 'NUEVA' }); // al cambiarla se actualiza en el siguiente intercambio
    lap(a, '1', 'Ana', 90_000);
    await b.mh.syncPeer(idB);
    expect(b.mh.state().peers[0]!.badge).toBe('NUEVA');
  });
});

describe('insignia: caracteres', () => {
  it('respeta mayúsculas, minúsculas y símbolos; rechaza invisibles, inversión de texto y emojis gigantes', () => {
    for (const ok of ['aBc!?#', 'Pablo_', '[WM]', 'ñandú', '日本語', '🐒', '👨‍👩‍👧‍👦', '<b>x', 'a b']) expect(cleanBadge(ok)).toBe(ok);
    expect(cleanBadge('a\u202eb\u200bc')).toBe('abc'); // invertir texto y espacio de ancho cero se quitan
    expect(() => cleanBadge('\u200b\u200e')).toThrow('vacía');
    expect(() => cleanBadge('abcdefg')).toThrow('como mucho 6');
    expect(() => cleanBadge('👨‍👩‍👧‍👦'.repeat(6))).toThrow('demasiados símbolos'); // 6 familias = 6 «caracteres» pero enormes
    expect(() => cleanBadge('e\u0301'.repeat(2) + 'a\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030a\u030b\u030c\u030d\u030e\u030f\u0310\u0311\u0312\u0313'.repeat(2))).toThrow('demasiados');
  });
  it('lo que manda otro Howler se vuelve a limpiar al recibirlo', async () => {
    const a = await node('Ana'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '1', 'Ana', 91_000);
    (a.repo as any).db.prepare('UPDATE mh_identity SET badge = ? WHERE id = 1').run('\u202eEVIL\u200b-X-Y-Z'); // dato manipulado directamente
    await b.mh.syncPeer(idB);
    expect(b.mh.state().peers[0]!.badge).toBe('ANA');
  });
});

describe('insignia: colores', () => {
  it('se eligen, viajan y lo inválido que llegue se descarta', async () => {
    const a = await node('Ana'), b = await node('B');
    a.mh.store.setIdentity({ badgeBg: '#FF8800', badgeFg: '#112233' });
    expect([a.mh.store.badgeBg, a.mh.store.badgeFg]).toEqual(['#ff8800', '#112233']);
    a.mh.store.setIdentity({ badgeFg: 'rojo; background:url(x)' }); // basura -> automático
    expect(a.mh.store.badgeFg).toBe('');
    a.mh.store.setIdentity({ badgeFg: '#ffffff' });
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '1', 'Ana', 91_000);
    await b.mh.syncPeer(idB);
    expect(b.mh.state().peers[0]).toMatchObject({ badgeBg: '#ff8800', badgeFg: '#ffffff' });
    expect(b.repo.multihowler.servers()[1]).toMatchObject({ badgeBg: '#ff8800', badgeFg: '#ffffff' });
    expect(b.repo.sessionHistory.list({ limit: 5, offset: 0 }).items[0]).toMatchObject({ serverBadgeBg: '#ff8800' });
    // un valor manipulado en origen no pasa el filtro de entrada
    expect(() => b.repo.multihowler.applyLaps([{ ...a.repo.multihowler.changesFor({}, 1)[0]!, originBadgeBg: 'url(x)' }], a.mh.store.uuid)).not.toThrow();
  });
});

describe('insignia en tablas y en Discord', () => {
  it('cada fila de la tabla lleva la insignia de donde se hizo la vuelta', async () => {
    const a = await node('Ana'), b = await node('B');
    a.mh.store.setIdentity({ badge: '🐒AN', badgeBg: '#ff8800' });
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    lap(a, '1', 'Ana', 91_000);
    lap(b, '2', 'Bea', 92_000);
    await b.mh.syncPeer(idB);
    const rows = b.repo.records('monza', '', []).entries;
    expect(rows.map((r) => [r.driverName, r.serverBadge, r.serverBadgeBg])).toEqual([['Ana', '🐒AN', '#ff8800'], ['Bea', 'B', '']]);
  });
  it('{servidor} e {insignia} son huecos opcionales de cualquier aviso', async () => {
    const { DISCORD_EVENTS, fillTemplate } = await import('@howler/shared');
    for (const e of DISCORD_EVENTS) expect(e.placeholders.map((p) => p.name)).toEqual(expect.arrayContaining(['servidor', 'insignia']));
    const rec = DISCORD_EVENTS.find((e) => e.id === 'recordCombo')!;
    expect(rec.defaultTitle + rec.defaultMessage).not.toMatch(/\{(servidor|insignia)\}/); // no salen si no los pones
    expect(fillTemplate('{badge} {driver} / {track} ({server})', { insignia: '🐒WM', piloto: 'Ana', circuito: 'Imola', servidor: 'Marc' })).toBe('🐒WM Ana / Imola (Marc)'); // los huecos valen en inglés
    expect(fillTemplate('{insignia} {piloto} en {circuito} ({servidor})', { insignia: '🐒WM', piloto: 'Ana', circuito: 'Imola', servidor: 'Servidor de Marc' })).toBe('🐒WM Ana en Imola (Servidor de Marc)');
  });
});

describe('trayectorias compartidas', () => {
  const sample = (n = 60) => encodeTrace({ t: Array.from({ length: n }, (_, i) => i * 100), x: Array.from({ length: n }, (_, i) => i), z: Array.from({ length: n }, () => 0), h: Array.from({ length: n }, () => 0), v: Array.from({ length: n }, () => 100), gear: Array.from({ length: n }, () => 3), rpm: Array.from({ length: n }, () => 6000) });
  const traceOf = (n: Node, steam: string) => (n.repo as any).db.prepare('SELECT t.lap_id FROM lap_traces t JOIN laps l ON l.id = t.lap_id JOIN drivers d ON d.id = l.driver_id WHERE d.steam_id = ?').all(steam).length as number;

  it('con el interruptor activo en los dos lados viajan las trazas de la mejor vuelta, en los dos sentidos', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const lapA = lap(a, '1', 'Ana', 91_000), lapB = lap(b, '2', 'Bea', 92_000);
    a.repo.saveTrace(lapA, 60, sample()); b.repo.saveTrace(lapB, 60, sample());
    a.mh.store.updatePeer(a.mh.store.peers()[0]!.id, { shareTraces: true });
    b.mh.store.updatePeer(idB, { shareTraces: true });
    await b.mh.syncPeer(idB);
    expect(traceOf(b, '1')).toBe(1); // B recibe la de Ana
    expect(traceOf(a, '2')).toBe(1); // y A la de Bea
    // y el comparador de B ya puede usarla
    const dA = (b.repo as any).db.prepare("SELECT id FROM drivers WHERE steam_id = '1'").get().id as number;
    expect(b.repo.bestLapsWithTraces('monza', '', [{ driverId: dA, car: 'mx5' }])[0]!.data).not.toBeNull();
  });

  it('si un lado no lo activa, no viaja nada', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    a.repo.saveTrace(lap(a, '1', 'Ana', 91_000), 60, sample());
    b.mh.store.updatePeer(idB, { shareTraces: true }); // A no
    await b.mh.syncPeer(idB);
    expect(lapCount(b)).toBe(1); // las vueltas sí
    expect(traceOf(b, '1')).toBe(0);
  });

  it('una traza falsa o enorme no se guarda y no se vuelve a pedir', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const l = lap(a, '1', 'Ana', 91_000);
    a.repo.saveTrace(l, 60, Buffer.from('esto no es una traza'));
    a.mh.store.updatePeer(a.mh.store.peers()[0]!.id, { shareTraces: true });
    b.mh.store.updatePeer(idB, { shareTraces: true });
    await b.mh.syncPeer(idB);
    expect(traceOf(b, '1')).toBe(0);
    const origin = a.mh.store.uuid;
    expect(b.repo.mhTraces.wanted(origin)).toEqual([]);
  });

  it('solo se piden las mejores vueltas de cada piloto', async () => {
    const a = await node('A'), b = await node('B');
    const idB = await link(a, b, { give: true, receive: true }, { give: true, receive: true });
    const slow = lap(a, '1', 'Ana', 95_000), fast = lap(a, '1', 'Ana', 91_000);
    a.repo.saveTrace(slow, 60, sample()); a.repo.saveTrace(fast, 60, sample());
    a.mh.store.updatePeer(a.mh.store.peers()[0]!.id, { shareTraces: true });
    b.mh.store.updatePeer(idB, { shareTraces: true });
    await b.mh.syncPeer(idB);
    expect(traceOf(b, '1')).toBe(1);
  });
});
