import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autostartLink, copyServer, detectInstall, firewallScript, sha256Line, shortcutScript, uninstallPlan, writeHowlerConfig } from './plan';

const tmp = () => mkdtempSync(join(tmpdir(), 'howler-plan-'));

describe('instalación previa y configuración', () => {
  it('detecta una instalación por su config o su base de datos', () => {
    const d = tmp();
    expect(detectInstall(d)).toEqual({ exists: false, hasConfig: false, hasData: false });
    writeFileSync(join(d, 'howler.config.json'), '{}');
    expect(detectInstall(d)).toMatchObject({ exists: true, hasConfig: true, hasData: false });
  });
  it('crea la configuración una vez y no la pisa al actualizar', () => {
    const d = tmp();
    expect(writeHowlerConfig(d, 'C:\\ac\\server')).toBe('created');
    const cfg = JSON.parse(readFileSync(join(d, 'howler.config.json'), 'utf8'));
    expect(cfg).toMatchObject({ serverDir: 'C:\\ac\\server', http: { port: 8420 }, admin: { port: 8421 } });
    writeFileSync(join(d, 'howler.config.json'), '{"mio":true}');
    expect(writeHowlerConfig(d, 'otra')).toBe('kept');
    expect(readFileSync(join(d, 'howler.config.json'), 'utf8')).toBe('{"mio":true}');
  });
});

describe('copiar el servidor a una carpeta nueva', () => {
  it('copia todo menos copias de seguridad y logs, y deja el original', () => {
    const src = tmp(), dest = join(tmp(), 'nuevo');
    mkdirSync(join(src, 'cfg')); mkdirSync(join(src, 'howler-backup')); mkdirSync(join(src, 'logs'));
    writeFileSync(join(src, 'cfg', 'server_cfg.ini'), 'x'); writeFileSync(join(src, 'howler-backup', 'a'), 'x'); writeFileSync(join(src, 'logs', 'l.txt'), 'x'); writeFileSync(join(src, 'acServer.exe'), 'x');
    expect(copyServer(src, dest).files).toBe(2);
    expect(existsSync(join(dest, 'cfg', 'server_cfg.ini'))).toBe(true);
    expect(existsSync(join(dest, 'howler-backup'))).toBe(false);
    expect(existsSync(join(src, 'cfg', 'server_cfg.ini'))).toBe(true);
  });
  it('rechaza una carpeta dentro de la original o no vacía', () => {
    const src = tmp();
    expect(() => copyServer(src, join(src, 'dentro'))).toThrow(/dentro/);
    const full = tmp(); writeFileSync(join(full, 'a'), 'x');
    expect(() => copyServer(src, full)).toThrow(/no está vacía/);
  });
});

describe('scripts de Windows (solo texto)', () => {
  it('cortafuegos: solo la web, con regla para quitarla', () => {
    const f = firewallScript({ web: 8420 });
    expect(f.add).toContain('localport=8420');
    expect(f.add).toContain('protocol=TCP');
    expect(f.remove).toContain('delete rule');
    expect(f.add).not.toContain('8421');
  });
  it('acceso directo con comillas escapadas', () => {
    const s = shortcutScript("C:\\Mi 'App'\\Howler.exe", 'C:\\Users\\x\\Desktop\\Howler.lnk', '--app');
    expect(s).toContain("'C:\\Mi ''App''\\Howler.exe'");
    expect(s).toContain("$s.Arguments = '--app'");
    expect(autostartLink('C:\\Startup')).toMatch(/Howler\.lnk$/);
  });
  it('el marcador de migración no se copia y las comillas tipográficas se escapan', () => {
    const src = tmp(), dest = join(tmp(), 'n');
    writeFileSync(join(src, 'howler-migration.json'), '{}'); writeFileSync(join(src, 'a.ini'), 'x');
    copyServer(src, dest);
    expect(existsSync(join(dest, 'howler-migration.json'))).toBe(false);
    expect(shortcutScript('C:\\Users\\O\u2019Brien\\Howler.exe', 'C:\\x.lnk')).toContain("O\u2019\u2019Brien");
    expect(firewallScript({ web: 8420 }).add).toContain('delete rule');
  });
  it('desinstalar conserva los datos salvo que se pida lo contrario', () => {
    const keep = uninstallPlan('C:\\H', { web: 8420 });
    expect(keep.keep.length).toBe(2);
    expect(keep.remove.some((p) => p.endsWith('data'))).toBe(false);
    expect(uninstallPlan('C:\\H', { web: 8420 }, false, ['C:\\Desktop\\Howler.lnk']).remove).toContain('C:\\Desktop\\Howler.lnk');
    const all = uninstallPlan('C:\\H', { web: 8420 }, true);
    expect(all.remove.some((p) => p.endsWith('data'))).toBe(true);
    expect(all.commands[0]).toContain('delete rule');
  });
  it('línea de SHA256SUMS', () => {
    const d = tmp(); writeFileSync(join(d, 'a.txt'), 'hola');
    expect(sha256Line(join(d, 'a.txt'))).toBe('b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79  a.txt');
  });
});
