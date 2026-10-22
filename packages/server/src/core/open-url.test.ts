import { describe, expect, it } from 'vitest';
import { openCommand, openExternal } from './open-url';

describe('abrir enlaces según el sistema', () => {
  it('usa el abridor propio de cada sistema, sin intérprete de órdenes', () => {
    expect(openCommand('https://a.b/c?d=1&e=2', 'win32')).toEqual({ cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', 'https://a.b/c?d=1&e=2'] });
    expect(openCommand('https://a.b', 'darwin')).toEqual({ cmd: 'open', args: ['https://a.b'] });
    expect(openCommand('https://a.b', 'linux')).toEqual({ cmd: 'xdg-open', args: ['https://a.b'] });
  });
  it('solo abre http(s)', () => {
    expect(() => openExternal('javascript:alert(1)')).toThrow(/http/);
    expect(() => openExternal('file:///C:/Windows/System32/calc.exe')).toThrow(/http/);
  });
});
