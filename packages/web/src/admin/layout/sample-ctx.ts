import { useEffect, useState } from 'react';
import type { PageId, SectorKind, TimingDto, TimingRowDto } from '@howler/shared';
import { api } from '../../api';
import type { PageCtx } from '../../modules/context';

/** Qué módulos solo funcionan con datos del servidor (no se pueden enseñar con un ejemplo sin él): se dibujan como esquema. */
export const NEEDS_SERVER = new Set(['live-map', 'king', 'latest-records', 'record-ticker']);

const kinds: SectorKind[][] = [['purple', 'green', 'yellow'], ['yellow', 'purple', 'green'], ['green', 'yellow', 'yellow'], ['yellow', 'yellow', 'green'], ['none', 'none', 'none'], ['yellow', 'none', 'none']];
const names = ['Marc', 'Lucía', 'Pablo', 'Irene', 'Dani', 'Sara'];
const rows = (): TimingRowDto[] => names.map((driverName, i) => ({
  position: i + 1, driverId: -(i + 1), driverName, carId: i, car: i % 2 ? 'ks_porsche_911_gt3_rs' : 'ks_ferrari_488_gt3', online: i < 4,
  bestMs: 83_400 + i * 410 + (i % 3) * 90, gapMs: i === 0 ? null : i * 410 + (i % 3) * 90, lastMs: 83_900 + i * 520, lastValid: true, lastPending: false, laps: 12 - i,
  lastSectors: kinds[i]!.map((kind, k) => ({ ms: kind === 'none' ? null : 27_000 + k * 400 + i * 150, kind })),
}));

/** Datos de ejemplo para enseñar cómo se ve un módulo cuando todavía no hay nada real. */
export const sampleTiming = (): TimingDto => ({
  session: { id: -1, track: 'ks_silverstone', layout: 'gp', name: 'Ejemplo', type: 3, startedAt: new Date(Date.now() - 25 * 60_000).toISOString() },
  sectorCount: 3,
  rows: rows(),
});

export interface EditorCtx { ctx: PageCtx | null; /** true = datos reales; false = de ejemplo o ninguno. */ real: boolean }

/**
 * Datos con los que se dibujan los módulos en el editor: los reales de la última sesión / campeonato si los hay y, si no,
 * de ejemplo. Los módulos de un campeonato sin ninguno real no tienen ejemplo y salen como esquema.
 */
export function useEditorCtx(page: PageId): EditorCtx {
  const [state, setState] = useState<EditorCtx>({ ctx: null, real: false });
  useEffect(() => {
    let live = true;
    const done = (s: EditorCtx) => { if (live) setState(s); };
    {
      void Promise.all([api.timing().catch(() => null), api.status().catch(() => null)]).then(([data, status]) => {
        const real = !!data?.session && data.rows.length > 0;
        const d = real ? data! : sampleTiming();
        const cars = [...new Set(d.rows.map((r) => r.car).filter(Boolean))];
        done({ ctx: { kind: 'session', variant: page === 'home' ? 'home' : 'history', data: d, session: d.session!, live: false, status, cars }, real });
      });
    }
    return () => { live = false; };
  }, [page]);
  return state;
}
