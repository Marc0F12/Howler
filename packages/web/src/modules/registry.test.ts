import { describe, expect, it } from 'vitest';
import { MODULE_META } from '@howler/shared';
import { MODULES } from './registry';

describe('registro de módulos', () => {
  it('coincide con el catálogo de @howler/shared (los ids que se validan son los que se pintan)', () => {
    expect(Object.keys(MODULES).sort()).toEqual(MODULE_META.map((m) => m.id).sort());
  });
});
