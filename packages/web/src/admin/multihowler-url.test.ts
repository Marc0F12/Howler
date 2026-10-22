import { describe, expect, it } from 'vitest';
import { isPlainInternetUrl } from './MultiHowlerSection';

describe('aviso de http:// sin cifrar', () => {
  it('avisa solo con http:// hacia internet', () => {
    expect(isPlainInternetUrl('http://mi-servidor.com:8420')).toBe(true);
    expect(isPlainInternetUrl('http://81.34.2.10:8420')).toBe(true);
    expect(isPlainInternetUrl('https://mi-servidor.com')).toBe(false);
    expect(isPlainInternetUrl('http://192.168.1.20:8420')).toBe(false);
    expect(isPlainInternetUrl('http://localhost:8420')).toBe(false);
    expect(isPlainInternetUrl('basura')).toBe(false);
    // un dominio que EMPIEZA como una IP privada sigue siendo público; Tailscale/CGNAT y nombres de red local, no
    expect(isPlainInternetUrl('http://10.mi-dominio.com')).toBe(true);
    expect(isPlainInternetUrl('http://100.101.5.5:8420')).toBe(false);
    expect(isPlainInternetUrl('http://mipc.local:8420')).toBe(false);
    expect(isPlainInternetUrl('http://servidor:8420')).toBe(false);
  });
});
