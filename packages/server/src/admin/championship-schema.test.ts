import { describe, expect, it } from 'vitest';
import { SCORING_PRESETS, newBadge } from '@howler/shared';
import { championshipInputSchema } from './championship-schema';

const base = { name: 'Copa', format: 'individual', scoring: SCORING_PRESETS.f1!.config, teams: [], entries: [], rounds: [] };

describe('esquema del campeonato: insignia', () => {
  const ok = (extra: object) => championshipInputSchema.safeParse({ ...base, ...extra });
  it('acepta el diseño y lo normaliza; sin diseño queda como estaba', () => {
    const r = ok({ badgeDesign: { ...newBadge(), text: ' Copa ' } });
    expect(r.success && r.data.badgeDesign?.text).toBe('Copa');
    expect(ok({ badgeDesign: null }).success).toBe(true);
    expect(ok({}).success).toBe(true);
  });
  it('rechaza diseños con campos desconocidos, SVG suelto o valores fuera de lista', () => {
    expect(ok({ badgeDesign: { ...newBadge(), svg: '<svg onload=alert(1)/>' } }).success).toBe(false);
    expect(ok({ badgeDesign: { ...newBadge(), emblem: 'gi:"><script>' } }).success).toBe(false);
    expect(ok({ badgeDesign: 'x' }).success).toBe(false);
  });
});
