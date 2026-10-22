import type { DatabaseSync } from 'node:sqlite';
import type { WireChampionship } from '../core/mh-wire';

type Row = Record<string, any>;
const isHttp = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Campeonatos compartidos entre Howlers: exportar los propios y guardar copias de solo lectura de los ajenos. */
export class SharedChampionships {
  constructor(private db: DatabaseSync) {}

  /** Mis campeonatos publicables (no borradores). Los puestos y puntos no viajan: cada Howler los calcula con sus vueltas. */
  exportOwn(): WireChampionship[] {
    const rows = this.db.prepare("SELECT * FROM championships WHERE origin IS NULL AND status <> 'draft' ORDER BY id").all() as Row[];
    return rows.map((c) => {
      const teams = this.db.prepare('SELECT id, name, color FROM championship_teams WHERE championship_id = ? ORDER BY id').all(c.id) as Row[];
      const mods = (roundId: number | null) =>
        (this.db.prepare(`SELECT name, kind, url, note, image_url, specs FROM championship_mods WHERE championship_id = ? AND ${roundId == null ? 'round_id IS NULL' : 'round_id = ?'} ORDER BY id`)
          .all(...(roundId == null ? [c.id] : [c.id, roundId])) as Row[])
          .map((m) => ({ name: m.name, kind: m.kind, url: m.url, note: m.note ?? null, imageUrl: isHttp(m.image_url) ?? null, specs: JSON.parse(m.specs || '{}') }));
      const ownSession = (id: number | null) =>
        id != null && this.db.prepare('SELECT 1 FROM sessions WHERE id = ? AND origin IS NULL').get(id) ? id : null;
      const rounds = this.db.prepare('SELECT * FROM championship_rounds WHERE championship_id = ? ORDER BY number').all(c.id) as Row[];
      return {
        id: c.id, name: c.name, description: c.description, imageUrl: isHttp(c.image_url), format: c.format, status: c.status, scoring: JSON.parse(c.scoring),
        teams: teams.map((t) => ({ key: `t${t.id}`, name: t.name, color: t.color })),
        entries: (this.db.prepare('SELECT d.steam_id, d.name, e.team_id, e.color FROM championship_entries e JOIN drivers d ON d.id = e.driver_id WHERE e.championship_id = ?').all(c.id) as Row[])
          .map((e) => ({ steamId: e.steam_id, name: e.name, teamKey: e.team_id != null ? `t${e.team_id}` : null, color: e.color ?? null })),
        rounds: rounds.map((r) => ({
          id: r.id, track: r.track, layout: r.layout, cars: JSON.parse(r.cars), practiceAt: r.practice_at ?? null, qualiAt: r.quali_at ?? null, raceAt: r.race_at ?? null,
          raceSession: ownSession(r.race_session_id), qualiSession: ownSession(r.quali_session_id), mods: mods(r.id),
        })),
        mods: mods(null),
        adjustments: (this.db.prepare('SELECT a.round_id, d.steam_id, a.points, a.reason FROM championship_adjustments a JOIN drivers d ON d.id = a.driver_id WHERE a.championship_id = ?').all(c.id) as Row[])
          .map((a) => ({ round: a.round_id, steamId: a.steam_id, points: a.points, reason: a.reason })),
      };
    });
  }

  /**
   * Guarda las copias que llegan de `origin` (sustituyendo lo anterior) y borra las que ese Howler ya no comparte.
   * `driverFor` une cada inscrito con su piloto local por Steam ID.
   */
  applyFrom(origin: string, list: WireChampionship[], driverFor: (steamId: string, name: string) => number): void {
    this.db.exec('BEGIN');
    try {
      const keep: number[] = [];
      for (const w of list) {
        keep.push(w.id);
        let cid = (this.db.prepare('SELECT id FROM championships WHERE origin = ? AND origin_id = ?').get(origin, w.id) as Row | undefined)?.id as number | undefined;
        if (cid == null) {
          cid = Number(this.db.prepare('INSERT INTO championships (name, description, image_url, format, status, scoring, created_at, origin, origin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(w.name, w.description, w.imageUrl, w.format, w.status, JSON.stringify(w.scoring), new Date().toISOString(), origin, w.id).lastInsertRowid);
        } else {
          this.db.prepare('UPDATE championships SET name = ?, description = ?, image_url = ?, format = ?, status = ?, scoring = ? WHERE id = ?')
            .run(w.name, w.description, w.imageUrl, w.format, w.status, JSON.stringify(w.scoring), cid);
          this.db.prepare('DELETE FROM championship_entries WHERE championship_id = ?').run(cid);
          this.db.prepare('DELETE FROM championship_teams WHERE championship_id = ?').run(cid);
          this.db.prepare('DELETE FROM championship_mods WHERE championship_id = ?').run(cid);
          this.db.prepare('DELETE FROM championship_rounds WHERE championship_id = ?').run(cid); // arrastra ajustes
        }
        const teamIds = new Map<string, number>();
        for (const t of w.teams) teamIds.set(t.key, Number(this.db.prepare('INSERT INTO championship_teams (championship_id, name, color) VALUES (?, ?, ?)').run(cid, t.name, t.color).lastInsertRowid));
        const driverIds = new Map<string, number>();
        for (const e of w.entries) {
          const did = driverFor(e.steamId, e.name);
          driverIds.set(e.steamId, did);
          this.db.prepare('INSERT OR IGNORE INTO championship_entries (championship_id, driver_id, team_id, color) VALUES (?, ?, ?, ?)')
            .run(cid, did, e.teamKey != null ? teamIds.get(e.teamKey) ?? null : null, e.color);
        }
        const addMod = (m: WireChampionship['mods'][number], rid: number | null) =>
          this.db.prepare('INSERT INTO championship_mods (championship_id, round_id, name, kind, url, note, image_url, specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(cid, rid, m.name, m.kind, m.url, m.note ?? null, m.imageUrl ?? null, JSON.stringify(m.specs ?? {}));
        const roundIds = new Map<number, number>();
        w.rounds.forEach((r, i) => {
          const rid = Number(this.db.prepare('INSERT INTO championship_rounds (championship_id, number, track, layout, cars, practice_at, quali_at, race_at, origin_race_session, origin_quali_session) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(cid, i + 1, r.track, r.layout, JSON.stringify(r.cars), r.practiceAt, r.qualiAt, r.raceAt, r.raceSession, r.qualiSession).lastInsertRowid);
          roundIds.set(r.id, rid);
          r.mods.forEach((m) => addMod(m, rid));
        });
        w.mods.forEach((m) => addMod(m, null));
        for (const a of w.adjustments) {
          const rid = roundIds.get(a.round);
          const did = driverIds.get(a.steamId) ?? driverFor(a.steamId, 'Piloto');
          if (rid != null) this.db.prepare('INSERT INTO championship_adjustments (championship_id, round_id, driver_id, points, reason) VALUES (?, ?, ?, ?, ?)').run(cid, rid, did, a.points, a.reason);
        }
      }
      const stale = (this.db.prepare('SELECT id, origin_id FROM championships WHERE origin = ?').all(origin) as Row[]).filter((r) => !keep.includes(r.origin_id));
      for (const r of stale) this.db.prepare('DELETE FROM championships WHERE id = ?').run(r.id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.relink();
  }

  /** Enlaza las pruebas de las copias con las sesiones ya sincronizadas (puede haber llegado después que el campeonato). */
  relink() {
    for (const kind of ['race', 'quali'] as const) {
      this.db.prepare(
        `UPDATE championship_rounds SET ${kind}_session_id = (
           SELECT s.id FROM sessions s JOIN championships c ON c.id = championship_rounds.championship_id
           WHERE s.origin = c.origin AND s.origin_id = championship_rounds.origin_${kind}_session)
         WHERE origin_${kind}_session IS NOT NULL`,
      ).run();
    }
  }

  /** Borra las copias de campeonatos de un Howler. */
  removeFrom(origin: string) {
    this.db.prepare('DELETE FROM championships WHERE origin = ?').run(origin);
  }
}
