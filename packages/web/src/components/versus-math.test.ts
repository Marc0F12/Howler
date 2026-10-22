import { describe, expect, it } from 'vitest';
import type { DriverComboStatDto } from '@howler/shared';
import { versus } from './versus-math';

const combo = (car: string, bestMs: number | null, track = 'imola'): DriverComboStatDto => ({
  track, layout: '', car, laps: 5, validLaps: 4, bestMs, avgMs: null, stdMs: null, outLaps: 0, maxSpeedKmh: null, rank: null, drivers: 2, recordMs: null, lastAt: '2026-01-01',
});

describe('versus', () => {
  it('compara solo lo que han corrido los dos y cuenta victorias', () => {
    const r = versus([combo('a', 90000), combo('b', 80000), combo('solo-a', 1)], [combo('a', 89000), combo('b', 81000), combo('solo-b', 1)]);
    expect(r.rows.map((x) => x.car)).toEqual(['a', 'b']);
    expect(r.rows[0]!.deltaMs).toBe(-1000);
    expect([r.winsA, r.winsB, r.ties]).toEqual([1, 1, 0]);
  });
  it('sin vuelta válida no hay ganador; empate exacto', () => {
    const r = versus([combo('a', null), combo('b', 5)], [combo('a', 7), combo('b', 5)]);
    expect(r.rows.find((x) => x.car === 'a')!.winner).toBeNull();
    expect(r.ties).toBe(1);
  });
});
