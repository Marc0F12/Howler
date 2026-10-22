import { describe, expect, it } from 'vitest';
import { cleanTrackId, folderKey } from './track-id';

describe('cleanTrackId', () => {
  it('se queda con la carpeta del circuito', () => {
    expect(cleanTrackId('csp/3465/../D/../leroy_gandia')).toBe('leroy_gandia');
    expect(cleanTrackId('Csp/3465/../Actk Navarra')).toBe('Actk Navarra');
    expect(cleanTrackId('Euphoria Hillside Park (TRACK=Csp/3465/../Euphoria Hillside Park)')).toBe('Euphoria Hillside Park');
    expect(cleanTrackId('ks_vallelunga')).toBe('ks_vallelunga');
  });
  it('folderKey iguala nombres de carpeta equivalentes', () => {
    expect(folderKey('Euphoria Hillside Park')).toBe(folderKey('euphoria_hillside_park'));
  });
});
