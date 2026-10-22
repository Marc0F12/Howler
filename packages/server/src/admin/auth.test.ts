import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService, roleAllows } from './auth';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'howler-authunit-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REMOTE = { ip: '203.0.113.5', socket: { remoteAddress: '203.0.113.5' }, headers: {} as Record<string, unknown> };

describe('sesiones del panel', () => {
  it('sobreviven a reiniciar Howler sin guardar nunca el token en claro, y caducan', async () => {
    let t = 1_000_000;
    const a = new AuthService({ dataDir: dir, remoteEnabled: () => true, now: () => t });
    await a.create({ name: 'marc', password: 'una-contraseña-larga', role: 'admin' });
    const { token } = await a.login('marc', 'una-contraseña-larga', '203.0.113.5');
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).not.toContain(token);

    const b = new AuthService({ dataDir: dir, remoteEnabled: () => true, now: () => t }); // «reinicio»
    const who = b.caller({ ...REMOTE, headers: { cookie: `howler_session=${token}` } });
    expect(who.kind === 'remote' && who.account?.name).toBe('marc');

    t += 13 * 3_600_000; // pasadas 12 h sin usarla
    const c = new AuthService({ dataDir: dir, remoteEnabled: () => true, now: () => t });
    expect(c.caller({ ...REMOTE, headers: { cookie: `howler_session=${token}` } })).toEqual({ kind: 'remote', account: null });
  });

  it('cerrar sesión o borrar la cuenta la quita también del archivo', async () => {
    const a = new AuthService({ dataDir: dir, remoteEnabled: () => true });
    const acc = await a.create({ name: 'marc', password: 'una-contraseña-larga', role: 'admin' });
    const { token } = await a.login('marc', 'una-contraseña-larga', '203.0.113.5');
    a.logout(token);
    const b = new AuthService({ dataDir: dir, remoteEnabled: () => true });
    expect(b.caller({ ...REMOTE, headers: { cookie: `howler_session=${token}` } })).toEqual({ kind: 'remote', account: null });
    const { token: t2 } = await a.login('marc', 'una-contraseña-larga', '203.0.113.5');
    a.remove(acc.id);
    expect(new AuthService({ dataDir: dir, remoteEnabled: () => true }).caller({ ...REMOTE, headers: { cookie: `howler_session=${t2}` } })).toEqual({ kind: 'remote', account: null });
  });
});

describe('permisos por rol', () => {
  it('el moderador controla en directo pero no toca el servidor ni los ajustes', () => {
    expect(roleAllows('moderator', 'POST', '/admin/api/control/kick')).toBe(true);
    expect(roleAllows('moderator', 'POST', '/admin/api/penalties')).toBe(true);
    expect(roleAllows('moderator', 'POST', '/admin/api/server/stop')).toBe(false);
    expect(roleAllows('moderator', 'POST', '/admin/api/schedule')).toBe(false);
    expect(roleAllows('viewer', 'GET', '/admin/api/schedule')).toBe(true);
    expect(roleAllows('viewer', 'POST', '/admin/api/control/say')).toBe(false);
    expect(roleAllows('admin', 'POST', '/admin/api/schedule/e0123456789ab/run')).toBe(true);
    expect(roleAllows('admin', 'POST', '/admin/api/settings')).toBe(false);
  });
});
