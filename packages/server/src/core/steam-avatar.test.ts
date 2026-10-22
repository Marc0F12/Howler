import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAvatarService, isSteamImageUrl, parseAvatarUrl, readAvatar } from './steam-avatar';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'howler-avatar-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const XML = (url: string) => `<?xml version="1.0"?><profile><steamID64>76561197960287930</steamID64><avatarIcon><![CDATA[x]]></avatarIcon><avatarFull><![CDATA[${url}]]></avatarFull></profile>`;
const IMG = 'https://avatars.fastly.steamstatic.com/abc_full.jpg';
const STEAM = '76561197960287930';

/** Un «Steam» de mentira que cuenta las peticiones. */
function fakeSteam(opts: { xml?: string; imageType?: string; imageBytes?: number; status?: number } = {}) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://steamcommunity.com/')) return new Response(opts.xml ?? XML(IMG), { status: opts.status ?? 200 });
    return new Response(new Uint8Array(opts.imageBytes ?? 100), { status: 200, headers: { 'content-type': opts.imageType ?? 'image/jpeg' } });
  };
  return { fetcher, calls };
}

describe('steam-avatar: URLs', () => {
  it('solo acepta imágenes de los dominios de Steam por https', () => {
    expect(isSteamImageUrl(IMG)).toBe(true);
    expect(isSteamImageUrl('https://steamcdn-a.akamaihd.net/a.jpg')).toBe(true);
    expect(isSteamImageUrl('http://avatars.fastly.steamstatic.com/a.jpg')).toBe(false);
    expect(isSteamImageUrl('https://evil.example.com/steamstatic.com.jpg')).toBe(false);
    expect(isSteamImageUrl('https://steamstatic.com.evil.com/a.jpg')).toBe(false);
    expect(isSteamImageUrl('no es una url')).toBe(false);
  });

  it('parseAvatarUrl lee avatarFull y rechaza dominios ajenos', () => {
    expect(parseAvatarUrl(XML(IMG))).toBe(IMG);
    expect(parseAvatarUrl(XML('https://evil.example.com/a.jpg'))).toBeNull();
    expect(parseAvatarUrl('<profile></profile>')).toBeNull();
  });
});

describe('steam-avatar: servicio', () => {
  it('descarga la foto, la guarda y la siguiente vez no vuelve a pedirla', async () => {
    const { fetcher, calls } = fakeSteam();
    const svc = createAvatarService({ dir: tmp(), fetcher });
    const path = await svc.get(7, STEAM);
    expect(path).toMatch(/7\.jpg$/);
    expect(readAvatar(path!).length).toBe(100);
    expect(calls).toHaveLength(2); // perfil + imagen
    await svc.get(7, STEAM);
    expect(calls).toHaveLength(2);
  });

  it('peticiones simultáneas del mismo piloto comparten una sola descarga', async () => {
    const { fetcher, calls } = fakeSteam();
    const svc = createAvatarService({ dir: tmp(), fetcher });
    await Promise.all([svc.get(1, STEAM), svc.get(1, STEAM), svc.get(1, STEAM)]);
    expect(calls).toHaveLength(2);
  });

  it('un perfil sin foto, una respuesta que no es imagen o una imagen enorme dan null y no se reintentan enseguida', async () => {
    for (const opts of [{ status: 500 }, { imageType: 'text/html' }, { imageBytes: 2_000_000 }, { xml: '<profile></profile>' }]) {
      const { fetcher, calls } = fakeSteam(opts);
      const svc = createAvatarService({ dir: tmp(), fetcher });
      expect(await svc.get(3, STEAM)).toBeNull();
      const before = calls.length;
      expect(await svc.get(3, STEAM)).toBeNull();
      expect(calls.length).toBe(before); // no insiste durante la hora siguiente
    }
  });

  it('reintenta pasada la hora de espera', async () => {
    let t = 1_000_000_000_000;
    const { fetcher, calls } = fakeSteam({ status: 500 });
    const dir = tmp();
    const svc = createAvatarService({ dir, fetcher, now: () => t });
    await svc.get(5, STEAM);
    const first = calls.length;
    t += 2 * 60 * 60_000;
    utimesSync(join(dir, '5.none'), new Date(t - 2 * 60 * 60_000 - 5000), new Date(t - 2 * 60 * 60_000 - 5000));
    await svc.get(5, STEAM);
    expect(calls.length).toBeGreaterThan(first);
  });

  it('un Steam ID raro o el servicio desactivado no tocan la red', async () => {
    const { fetcher, calls } = fakeSteam();
    const svc = createAvatarService({ dir: tmp(), fetcher });
    expect(await svc.get(1, '123')).toBeNull();
    expect(await svc.get(1, '../../etc/passwd')).toBeNull();
    expect(await svc.get(1, null)).toBeNull();
    expect(await createAvatarService({ dir: tmp(), fetcher, enabled: false }).get(1, STEAM)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
