import { describe, expect, it } from 'vitest';
import { parseProfileXml, parseSteamLink, resolveSteamProfile } from './steam-profile';

describe('enlaces de Steam', () => {
  it('acepta /profiles/<id>, /id/<nombre> y un SteamID64', () => {
    expect(parseSteamLink('https://steamcommunity.com/profiles/76561198000000001/')).toEqual({ kind: 'profiles', value: '76561198000000001' });
    expect(parseSteamLink('steamcommunity.com/id/mi_nombre')).toEqual({ kind: 'id', value: 'mi_nombre' });
    expect(parseSteamLink(' 76561198000000001 ')).toEqual({ kind: 'profiles', value: '76561198000000001' });
  });
  it('rechaza otros dominios, rutas raras y ids mal formados', () => {
    for (const bad of ['https://evil.com/id/x', 'https://steamcommunity.com.evil.com/id/x', 'https://steamcommunity.com/profiles/123', 'https://steamcommunity.com/id/a b', 'ftp://steamcommunity.com/id/xx', '', 'hola'])
      expect(parseSteamLink(bad)).toBeNull();
  });
  it('lee el XML del perfil (con y sin CDATA)', () => {
    expect(parseProfileXml('<profile><steamID64>76561198000000001</steamID64><steamID><![CDATA[Ana]]></steamID></profile>')).toEqual({ steamId: '76561198000000001', name: 'Ana' });
    expect(parseProfileXml('<response><error>The specified profile could not be found.</error></response>')).toBeNull();
  });
  it('resolveSteamProfile usa solo steamcommunity.com y avisa si el perfil no existe', async () => {
    const urls: string[] = [];
    const ok = async (u: string) => (urls.push(u), new Response('<profile><steamID64>76561198000000001</steamID64><steamID>Ana</steamID></profile>'));
    expect(await resolveSteamProfile('steamcommunity.com/id/ana', ok)).toEqual({ steamId: '76561198000000001', name: 'Ana' });
    expect(urls[0]).toBe('https://steamcommunity.com/id/ana?xml=1');
    await expect(resolveSteamProfile('steamcommunity.com/id/nadie', async () => new Response('<response><error>x</error></response>'))).rejects.toThrow(/no existe o es privado/);
    await expect(resolveSteamProfile('https://evil.com/id/x', ok)).rejects.toThrow(/No parece/);
  });
});
