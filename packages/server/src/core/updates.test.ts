import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerUpdateRoutes } from '../admin/update-routes';
import { hashFromSums, isGithubDownload, pickInstaller, UpdateService, type GhRelease, type UpdateSettings } from './updates';

const rel = (tag: string, o: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag, name: `Howler ${tag}`, body: '<!-- lang:es -->\n- Arreglo\n<!-- lang:en -->\n- Fix', draft: false, prerelease: false, published_at: '2026-10-11T10:00:00Z',
  html_url: `https://github.com/Marc0F12/Howler/releases/tag/${tag}`, assets: [], ...o,
});
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function setup(opts: { releases?: GhRelease[] | GhRelease | 404 | 500; settings?: Partial<UpdateSettings>; current?: string; lang?: 'es' | 'en'; launched?: string[]; platform?: NodeJS.Platform; extra?: (url: string) => Response | undefined } = {}) {
  const settings: UpdateSettings = { check: true, channel: 'stable', repo: 'Marc0F12/Howler', dismissed: '', ...opts.settings };
  const urls: string[] = [];
  const fetchFn = (async (u: string) => {
    urls.push(u);
    const x = opts.extra?.(u);
    if (x) return x;
    if (opts.releases === 404) return json({}, 404);
    if (opts.releases === 500) return json({}, 500);
    return json(opts.releases ?? []);
  }) as never;
  const svc = new UpdateService({
    current: opts.current ?? '0.1.0', settings: () => settings, saveDismissed: (v) => { settings.dismissed = v; }, lang: () => opts.lang ?? 'es',
    dir: mkdtempSync(join(tmpdir(), 'howler-upd-')), fetchFn, platform: opts.platform ?? 'win32', launch: async (f) => { opts.launched?.push(f); },
  });
  return { svc, settings, urls };
}

describe('comprobación', () => {
  it('detecta una versión nueva y da sus notas en el idioma del panel', async () => {
    const a = setup({ releases: rel('v0.2.0'), lang: 'en' });
    const s = await a.svc.check(true);
    expect(s).toMatchObject({ current: '0.1.0', available: true, dismissed: false, error: null });
    expect(s.latest).toMatchObject({ version: '0.2.0', notes: '- Fix', installable: false });
    expect(a.urls[0]).toBe('https://api.github.com/repos/Marc0F12/Howler/releases/latest');
  });
  it('misma versión o anterior: no hay aviso; sin releases (404) tampoco es un error', async () => {
    expect((await setup({ releases: rel('v0.1.0') }).svc.check(true)).available).toBe(false);
    expect((await setup({ releases: rel('v0.0.9') }).svc.check(true)).available).toBe(false);
    const none = await setup({ releases: 404 }).svc.check(true);
    expect(none).toMatchObject({ available: false, error: null, latest: null });
    expect(none.checkedAt).not.toBeNull();
  });
  it('«ahora no» oculta el aviso de esa versión pero no de una más nueva', async () => {
    const a = setup({ releases: rel('v0.2.0') });
    await a.svc.check(true);
    a.svc.dismiss('0.2.0');
    expect(a.svc.state()).toMatchObject({ available: true, dismissed: true });
    const b = setup({ releases: rel('v0.3.0'), settings: { dismissed: '0.2.0' } });
    expect((await b.svc.check(true)).dismissed).toBe(false);
  });
  it('el canal beta mira la lista y elige la más nueva, sin borradores', async () => {
    const list = [rel('v0.2.0-beta.1', { prerelease: true }), rel('v0.1.5'), rel('v0.3.0', { draft: true }), rel('v0.2.0-beta.2', { prerelease: true })];
    const a = setup({ releases: list, settings: { channel: 'beta' } });
    const s = await a.svc.check(true);
    expect(s.latest?.version).toBe('0.2.0-beta.2');
    expect(a.urls[0]).toContain('/releases?per_page=');
  });
  it('un fallo de red o de GitHub se cuenta sin romper nada y conserva lo anterior', async () => {
    const a = setup({ releases: rel('v0.2.0') });
    await a.svc.check(true);
    const bad = new UpdateService({ current: '0.1.0', settings: () => ({ check: true, channel: 'stable', repo: 'Marc0F12/Howler', dismissed: '' }), saveDismissed: () => undefined, lang: () => 'es', dir: tmpdir(), fetchFn: (async () => { throw new TypeError('fetch failed'); }) as never });
    expect((await bad.check(true)).error).toContain('No se pudo comprobar');
    expect((await setup({ releases: 500 }).svc.check(true)).error).toContain('500');
  });
  it('con la comprobación apagada no pregunta, salvo que se pida a mano; no repite antes de 6 h', async () => {
    const off = setup({ releases: rel('v0.2.0'), settings: { check: false } });
    await off.svc.check();
    expect(off.urls).toHaveLength(0);
    await off.svc.check(true);
    expect(off.urls).toHaveLength(1);
    const on = setup({ releases: rel('v0.2.0') });
    await on.svc.check(); await on.svc.check();
    expect(on.urls).toHaveLength(1);
  });
  it('un repositorio mal escrito no se consulta', async () => {
    const a = setup({ releases: rel('v0.2.0'), settings: { repo: '../../etc/passwd' } });
    expect((await a.svc.check(true)).error).toContain('no es válido');
    expect(a.urls).toHaveLength(0);
  });
});

describe('instalación', () => {
  const exe = Buffer.from('MZ-instalador-de-prueba');
  const sha = createHash('sha256').update(exe).digest('hex');
  const assets = (over: Partial<GhRelease['assets'][number]>[] = []) => [
    { name: 'Howler-Setup-0.2.0.exe', size: exe.length, browser_download_url: 'https://github.com/Marc0F12/Howler/releases/download/v0.2.0/Howler-Setup-0.2.0.exe', ...over[0] },
    { name: 'SHA256SUMS', size: 100, browser_download_url: 'https://github.com/Marc0F12/Howler/releases/download/v0.2.0/SHA256SUMS', ...over[1] },
  ];
  const files = (hash = sha) => (u: string) => (u.endsWith('SHA256SUMS') ? new Response(`${hash}  Howler-Setup-0.2.0.exe\n`) : u.endsWith('.exe') ? new Response(exe) : undefined);

  it('descarga, comprueba la suma SHA-256 y abre el instalador', async () => {
    const launched: string[] = [];
    const a = setup({ releases: rel('v0.2.0', { assets: assets() }), launched, extra: files() });
    await a.svc.check(true);
    expect(a.svc.state().latest?.installable).toBe(true);
    const s = await a.svc.apply();
    expect(s.install.state).toBe('ready');
    expect(launched).toHaveLength(1);
    expect(readFileSync(launched[0]!).equals(exe)).toBe(true);
  });
  it('si la suma no coincide descarta el archivo y no lo abre', async () => {
    const launched: string[] = [];
    const a = setup({ releases: rel('v0.2.0', { assets: assets() }), launched, extra: files('0'.repeat(64)) });
    await a.svc.check(true);
    await expect(a.svc.apply()).rejects.toThrow('no coincide');
    expect(launched).toHaveLength(0);
    expect(a.svc.state().install.state).toBe('error');
  });
  it('sin archivo de sumas, o fuera de Windows, no se instala desde aquí', async () => {
    const noSums = setup({ releases: rel('v0.2.0', { assets: [assets()[0]!] }) });
    await noSums.svc.check(true);
    expect(noSums.svc.state().latest?.installable).toBe(false);
    await expect(noSums.svc.apply()).rejects.toThrow('instalador');
    const linux = setup({ releases: rel('v0.2.0', { assets: assets() }), platform: 'linux' });
    await linux.svc.check(true);
    expect(linux.svc.state().latest?.installable).toBe(false);
  });
  it('solo descarga de GitHub', async () => {
    const evil = assets([{ browser_download_url: 'https://evil.example.com/Howler-Setup-0.2.0.exe' }]);
    const a = setup({ releases: rel('v0.2.0', { assets: evil }) });
    await a.svc.check(true);
    await expect(a.svc.apply()).rejects.toThrow('GitHub');
    expect(isGithubDownload('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isGithubDownload('http://github.com/x')).toBe(false);
    expect(isGithubDownload('https://github.com.evil.com/x')).toBe(false);
  });
  it('lee el hash de un archivo de sumas', () => {
    const h = 'a'.repeat(64);
    expect(hashFromSums(`${h}  Otro.exe\n${'b'.repeat(64)} *Howler-Setup-0.2.0.exe`, 'Howler-Setup-0.2.0.exe')).toBe('b'.repeat(64));
    expect(hashFromSums(h, 'x.exe')).toBe(h);
    expect(hashFromSums('nada', 'x.exe')).toBeNull();
    expect(pickInstaller(rel('v1', { assets: [] }), 'win32')).toBeNull();
  });
});

describe('rutas del panel', () => {
  it('estado, comprobar, ahora no y ajustes', async () => {
    const a = setup({ releases: rel('v0.2.0') });
    const saved: unknown[] = [];
    const app = Fastify();
    registerUpdateRoutes(app, { updates: a.svc, saveUpdateSettings: (p) => saved.push(p) });
    const checked = (await app.inject({ method: 'POST', url: '/admin/api/update/check' })).json();
    expect(checked.available).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/admin/api/update/dismiss', payload: { version: '0.2.0' } })).json().dismissed).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/admin/api/update/dismiss', payload: { version: '../x y' } })).statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: '/admin/api/update/settings', payload: { check: false } });
    expect(saved).toEqual([{ check: false }]);
    expect((await app.inject({ method: 'PUT', url: '/admin/api/update/settings', payload: { repo: 'otro/repo' } })).statusCode).toBe(400);
    const noInstaller = await app.inject({ method: 'POST', url: '/admin/api/update/apply' });
    expect(noInstaller.statusCode).toBe(400);
    expect(existsSync(a.svc.downloaded ?? '/nada')).toBe(false);
  });
});
