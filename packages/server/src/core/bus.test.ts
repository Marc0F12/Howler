import { describe, expect, it, vi } from 'vitest';
import { Bus } from './bus';

describe('Bus', () => {
  it('un oyente que falla no impide que lleguen los demás ni rompe a quien emite', () => {
    const bus = new Bus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: string[] = [];
    bus.on(() => { throw new Error('boom'); });
    bus.on((e) => got.push(e.type));
    expect(() => bus.emit({ type: 'results' })).not.toThrow();
    expect(got).toEqual(['results']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('se puede dejar de escuchar', () => {
    const bus = new Bus();
    const fn = vi.fn();
    const off = bus.on(fn);
    off();
    bus.emit({ type: 'results' });
    expect(fn).not.toHaveBeenCalled();
  });
});
