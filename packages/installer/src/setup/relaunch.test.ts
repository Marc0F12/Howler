import { describe, expect, it } from 'vitest';
import { relaunchHowler, type Started } from './relaunch';

const harness = (script: { up: boolean[]; exited: boolean[] }[]) => {
  const log: string[] = [];
  let starts = 0, polls = 0;
  const deps = {
    start: (): Started => { const s = script[Math.min(starts, script.length - 1)]!; starts++; let i = 0; return { exited: () => s.exited[Math.min(i++, s.exited.length - 1)]! }; },
    isUp: async () => { const s = script[Math.min(starts - 1, script.length - 1)]!; return s.up[Math.min(polls++, s.up.length - 1)]!; },
    sleep: async () => {},
    log: (m: string) => { log.push(m); },
  };
  return { deps, log, starts: () => starts };
};

describe('volver a abrir Howler tras actualizar', () => {
  it('a la primera si responde', async () => {
    const h = harness([{ up: [false, true], exited: [false] }]);
    expect(await relaunchHowler(h.deps, { waitMs: 5000, stepMs: 1000 })).toBe(true);
    expect(h.starts()).toBe(1);
    expect(h.log.at(-1)).toMatch(/responde/);
  });
  it('lo lanza otra vez si el primer intento se cierra solo', async () => {
    const h = harness([{ up: [false], exited: [true] }, { up: [true], exited: [false] }]);
    expect(await relaunchHowler(h.deps, { waitMs: 5000, stepMs: 1000 })).toBe(true);
    expect(h.starts()).toBe(2);
    expect(h.log.join('\n')).toMatch(/se cerró nada más abrirse/);
  });
  it('si sigue vivo pero no responde, NO lanza otro encima', async () => {
    const h = harness([{ up: [false], exited: [false] }]);
    expect(await relaunchHowler(h.deps, { waitMs: 3000, stepMs: 1000 })).toBe(false);
    expect(h.starts()).toBe(1);
    expect(h.log.join('\n')).toMatch(/no se lanza otro encima/);
  });
  it('se rinde tras los intentos y lo deja anotado', async () => {
    const h = harness([{ up: [false], exited: [true] }]);
    expect(await relaunchHowler(h.deps, { tries: 3, waitMs: 3000, stepMs: 1000 })).toBe(false);
    expect(h.starts()).toBe(3);
    expect(h.log.at(-1)).toMatch(/No se consiguió/);
  });
  it('un fallo al lanzar cuenta como intento y no rompe', async () => {
    const log: string[] = [];
    let n = 0;
    const ok = await relaunchHowler({
      start: () => { n++; if (n === 1) throw new Error('EPERM'); return { exited: () => false }; },
      isUp: async () => true, sleep: async () => {}, log: (m) => { log.push(m); },
    }, { waitMs: 3000, stepMs: 1000 });
    expect(ok).toBe(true);
    expect(log.join('\n')).toMatch(/EPERM/);
  });
});
