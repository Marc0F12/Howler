import type { DatabaseSync } from 'node:sqlite';
import type { ManagedDriverDto } from '@howler/shared';

type Row = Record<string, any>;

/** Gestor de pilotos del panel: listar, renombrar, ocultar y unir duplicados. El Steam ID nunca sale de aquí. */
export class DriverAdmin {
  constructor(private db: DatabaseSync) {}

  list(): ManagedDriverDto[] {
    const rows = this.db.prepare(
      `SELECT d.id, d.name, d.hidden, d.name_locked, d.steam_id, d.last_seen,
              COUNT(l.id) AS laps, COALESCE(SUM(l.origin IS NULL), 0) AS own, COALESCE(SUM(l.origin IS NOT NULL), 0) AS peer
       FROM drivers d LEFT JOIN laps l ON l.driver_id = d.id GROUP BY d.id ORDER BY d.name COLLATE NOCASE`,
    ).all() as Row[];
    return rows.map((r) => ({
      id: r.id, name: r.name, hidden: r.hidden === 1, renamed: r.name_locked === 1, laps: r.laps, ownLaps: r.own, peerLaps: r.peer,
      imported: String(r.steam_id).startsWith('stracker:'), lastSeen: r.last_seen,
    }));
  }

  rename(id: number, name: string) {
    if (!this.db.prepare('UPDATE drivers SET name = ?, name_locked = 1 WHERE id = ?').run(name, id).changes) throw new Error('Ese piloto no existe.');
  }

  /** Oculta o muestra al piloto: sus vueltas dejan de salir en la web (siguen guardadas). */
  setHidden(id: number, hidden: boolean) {
    if (!this.db.prepare('UPDATE drivers SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id).changes) throw new Error('Ese piloto no existe.');
    this.refreshHidden();
  }

  /** Recalcula `laps.hidden`: vuelta oculta si lo está su piloto o el Howler del que viene. */
  refreshHidden() {
    this.db.prepare(
      `UPDATE laps SET hidden = CASE WHEN EXISTS (SELECT 1 FROM drivers d WHERE d.id = laps.driver_id AND d.hidden = 1)
        OR EXISTS (SELECT 1 FROM mh_peers p WHERE p.peer_uuid = laps.origin AND p.hidden = 1) THEN 1 ELSE 0 END
       WHERE hidden <> CASE WHEN EXISTS (SELECT 1 FROM drivers d WHERE d.id = laps.driver_id AND d.hidden = 1)
        OR EXISTS (SELECT 1 FROM mh_peers p WHERE p.peer_uuid = laps.origin AND p.hidden = 1) THEN 1 ELSE 0 END`,
    ).run();
  }

  /**
   * Une `fromId` con `intoId`: pasa vueltas, choques, inscripciones, ajustes y penalizaciones, y borra el primero. Su Steam ID queda como
   * alias del destino, así las vueltas que lleguen luego (del juego o de otro Howler) siguen cayendo en el piloto unido.
   */
  merge(fromId: number, intoId: number) {
    if (fromId === intoId) throw new Error('Elige otro piloto: no se puede unir con él mismo.');
    const from = this.db.prepare('SELECT steam_id, first_seen, last_seen FROM drivers WHERE id = ?').get(fromId) as Row | undefined;
    const into = this.db.prepare('SELECT hidden FROM drivers WHERE id = ?').get(intoId) as Row | undefined;
    if (!from) throw new Error('El piloto de origen no existe.');
    if (!into) throw new Error('El piloto de destino no existe.');
    // Unir a alguien oculto con uno visible dejaría a la vista todas sus vueltas sin avisar: primero hay que decidir si debe seguir oculto.
    if ((this.db.prepare('SELECT hidden FROM drivers WHERE id = ?').get(fromId) as Row).hidden === 1 && into.hidden !== 1) {
      throw new Error('Ese piloto está oculto: mostrarlo antes de unirlo (o ocultar también al de destino).');
    }
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE laps SET driver_id = ? WHERE driver_id = ?').run(intoId, fromId);
      this.db.prepare('UPDATE lap_incidents SET other_driver_id = ? WHERE other_driver_id = ?').run(intoId, fromId);
      this.db.prepare('UPDATE championship_adjustments SET driver_id = ? WHERE driver_id = ?').run(intoId, fromId);
      this.db.prepare('UPDATE penalties SET driver_id = ? WHERE driver_id = ?').run(intoId, fromId);
      this.db.prepare('UPDATE OR IGNORE championship_entries SET driver_id = ? WHERE driver_id = ?').run(intoId, fromId);
      this.db.prepare('DELETE FROM championship_entries WHERE driver_id = ?').run(fromId);
      this.db.prepare('UPDATE driver_aliases SET driver_id = ? WHERE driver_id = ?').run(intoId, fromId);
      this.db.prepare('INSERT OR REPLACE INTO driver_aliases (steam_id, driver_id) VALUES (?, ?)').run(from.steam_id, intoId);
      this.db.prepare('UPDATE drivers SET first_seen = MIN(first_seen, ?), last_seen = MAX(last_seen, ?) WHERE id = ?').run(from.first_seen, from.last_seen, intoId);
      this.db.prepare('DELETE FROM drivers WHERE id = ?').run(fromId);
      this.refreshHidden();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
