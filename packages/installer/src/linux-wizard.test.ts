import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSETTO_LINUX, findAssettoRoot, findServers, runWizard, systemdUnit, type WizardIo } from './linux-wizard';

let root: string, home: string, server: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'howler-wiz-'));
  home = join(root, 'howler');
  server = join(root, 'server');
  mkdirSync(join(home, 'plugin', 'HowlerPlugin'), { recursive: true });
  writeFileSync(join(home, 'plugin', 'HowlerPlugin', 'HowlerPlugin.dll'), 'dll');
  mkdirSync(join(server, 'presets', 'SERVER_00'), { recursive: true });
  writeFileSync(join(server, 'AssettoServer'), 'bin');
  writeFileSync(join(server, 'presets', 'SERVER_00', 'server_cfg.ini'), '[SERVER]\nNAME=x\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function io(answers: string[], opts: { systemd?: boolean } = {}) {
  const said: string[] = [];
  const asked: string[] = [];
  const o: WizardIo = {
    say: (t) => said.push(t),
    ask: async (q, def) => { asked.push(q); return answers.shift() ?? def ?? ''; },
    download: async () => { throw new Error('sin red'); },
    untar: () => undefined,
    hasSystemd: () => opts.systemd ?? false,
    installService: () => 'howler',
    arch: () => 'x64',
    lang: () => 'es',
  };
  return { o, said, asked };
}

describe('asistente de Linux', () => {
  it('con un servidor ya existente basta pulsar Intro: lo prepara y propone arrancar', async () => {
    const { o } = io([]);
    const r = await runWizard(o, { home, node: 'node', serverCandidates: [server], acInstalls: [] });
    expect(r.serverDir).toBe(server);
    expect(r.startNow).toBe(true);
    expect(existsSync(join(server, 'plugins', 'HowlerPlugin', 'HowlerPlugin.dll'))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'howler.config.json'), 'utf8')).serverDir).toBe(server);
  });

  it('«solo Howler» deja la configuración sin servidor', async () => {
    const { o } = io(['3', 'n']); // sin servidores detectados: 1 crear, 2 otra carpeta, 3 solo Howler
    const r = await runWizard(o, { home, node: 'node', serverCandidates: [], acInstalls: [] });
    expect(r.serverDir).toBeNull();
    expect(r.startNow).toBe(false);
    expect(JSON.parse(readFileSync(join(home, 'howler.config.json'), 'utf8')).serverDir).toBe('');
  });

  it('instala el servicio si hay systemd y se acepta, y entonces no pregunta por arrancar', async () => {
    const { o, asked } = io(['1', 's'], { systemd: true });
    const r = await runWizard(o, { home, node: 'node', serverCandidates: [server], acInstalls: [] });
    expect(r.service).toBe('howler');
    expect(r.startNow).toBe(false);
    expect(asked.some((q) => /Arranco Howler ahora/.test(q))).toBe(false);
  });

  it('una carpeta que no sirve se vuelve a pedir', async () => {
    const { o, said } = io(['2', join(root, 'nada'), server, 'n']);
    const r = await runWizard(o, { home, node: 'node', serverCandidates: [], acInstalls: [] });
    // sin servidores detectados la opción 2 es «otra carpeta»
    expect(r.serverDir).toBe(server);
    expect(said.some((s) => /no sirve/.test(s))).toBe(true);
  });

  it('un acServer antiguo no cuenta como servidor', () => {
    const old = join(root, 'old');
    mkdirSync(join(old, 'presets', 'P'), { recursive: true });
    writeFileSync(join(old, 'acServer'), 'x');
    writeFileSync(join(old, 'presets', 'P', 'server_cfg.ini'), '[SERVER]\n');
    expect(findServers([old, server])).toEqual([server]);
  });
});

describe('piezas', () => {
  it('encuentra AssettoServer aunque venga dentro de una carpeta', () => {
    mkdirSync(join(root, 'x', 'envoltorio'), { recursive: true });
    writeFileSync(join(root, 'x', 'envoltorio', 'AssettoServer'), 'b');
    expect(findAssettoRoot(join(root, 'x'))).toBe(join(root, 'x', 'envoltorio'));
    expect(findAssettoRoot(join(root, 'x'), 0)).toBeNull();
  });
  it('las sumas fijadas son SHA-256 válidos', () => {
    expect(ASSETTO_LINUX.x64.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ASSETTO_LINUX.arm64.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('la unidad de systemd apunta al Node indicado', () => {
    const u = systemdUnit('/h', '/h/runtime/bin/node', 'default.target');
    expect(u).toContain('ExecStart=/h/runtime/bin/node /h/app/howler.mjs');
    expect(u).toContain('WantedBy=default.target');
  });
});
