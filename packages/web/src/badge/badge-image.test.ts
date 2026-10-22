import { describe, expect, it } from 'vitest';
import { autoBadgeUri, badgeDataUri } from './badge-image';
import { autoBadge } from '@howler/shared';

describe('imagen de la insignia', () => {
  it('es un data URI de SVG que se puede decodificar', () => {
    const uri = autoBadgeUri('Copa Howler', ['#cc3300']);
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('#cc3300');
  });
  it('es estable y distinta para otro nombre', () => {
    expect(autoBadgeUri('A')).toBe(autoBadgeUri('A'));
    expect(autoBadgeUri('A')).not.toBe(autoBadgeUri('B'));
    expect(autoBadgeUri('A')).toBe(badgeDataUri(autoBadge('A')));
  });
});
