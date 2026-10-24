import { describe, expect, it } from 'vitest';
import { sanitizeAppearance } from './appearance';
import { ACCENT_SWATCHES, BUILTIN_THEMES, accentTextColor, onAccentFor, resolveTheme, themeVars, validateTheme, withAccent, withAccentTitles, withTicker } from './theme';

describe('temas', () => {
  it('los temas de serie son válidos y tienen id único', () => {
    for (const t of BUILTIN_THEMES) expect(validateTheme(JSON.parse(JSON.stringify(t))).ok, t.id).toBe(true);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length);
  });
  it('rechaza colores que no son #rrggbb, campos desconocidos y opciones inexistentes', () => {
    const t = JSON.parse(JSON.stringify(BUILTIN_THEMES[0]));
    expect(validateTheme({ ...t, colors: { ...t.colors, bg: 'url(x)' } }).ok).toBe(false);
    expect(validateTheme({ ...t, css: 'body{display:none}' }).ok).toBe(false);
    expect(validateTheme({ ...t, shape: 'triangle' }).ok).toBe(false);
    expect(validateTheme({ ...t, radius: 99 }).ok).toBe(false);
    expect(validateTheme({ ...t, id: 'Mal Id' }).ok).toBe(false);
    expect(validateTheme('x').ok).toBe(false);
  });
  it('resolveTheme cae al original con lo desconocido', () => {
    expect(resolveTheme('f1').id).toBe('f1');
    expect(resolveTheme('nada').id).toBe('original');
    expect(resolveTheme({ nope: 1 } as never).id).toBe('original');
  });
  it('themeVars solo produce variables y atributos conocidos', () => {
    const { vars, attrs } = themeVars(resolveTheme('gt'));
    expect(vars['--accent']).toBe('#5a7be0');
    expect(attrs['data-fade']).toBe('on');
    expect(Object.keys(vars).every((k) => k.startsWith('--') || k === 'color-scheme')).toBe(true);
  });
  it('sanitizeAppearance conserva solo temas válidos', () => {
    expect(sanitizeAppearance({ theme: 'gt' }).theme).toBe('gt');
    expect(sanitizeAppearance({ theme: 'original' }).theme).toBeUndefined();
    expect(sanitizeAppearance({ theme: 'inventado' }).theme).toBeUndefined();
    expect(sanitizeAppearance({ theme: { format: 'howler-theme' } }).theme).toBeUndefined();
    expect(sanitizeAppearance({ theme: resolveTheme('f1') }).theme).toMatchObject({ id: 'f1' });
  });
});

describe('color de acento', () => {
  it('withAccent da un tema válido con el acento nuevo y un texto legible, y no se encadena', () => {
    const base = resolveTheme('cm');
    for (const c of ACCENT_SWATCHES) {
      const t = withAccent(base, c);
      expect(validateTheme(JSON.parse(JSON.stringify(t))).ok, c).toBe(true);
      expect(t.colors.accent).toBe(c);
      expect(t.id).toBe('cm-accent');
      expect(withAccent(t, '#2b9dff').id).toBe('cm-accent');
      expect(withAccent(t, '#2b9dff').name).toBe('CM · acento');
    }
    expect(base.colors.accent).toBe('#ff4500');
  });
  it('onAccentFor elige texto oscuro sobre acentos claros y blanco sobre oscuros', () => {
    expect(onAccentFor('#f2a30f')).toBe('#111111');
    expect(onAccentFor('#a30036')).toBe('#ffffff');
  });
});

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('contraste (WCAG AA) de los temas de serie', () => {
  for (const t of BUILTIN_THEMES) {
    it(`${t.id}: texto y texto atenuado ≥ 4,5:1 sobre fondo y superficie; texto del acento ≥ 4,5:1`, () => {
      const c = t.colors;
      for (const bg of [c.bg, c.surface]) {
        expect(ratio(c.text, bg), `text/${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.muted, bg), `muted/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('los estados (en directo, anulada, mejor, mejor personal) se leen sobre el fondo del Original (≥ 3:1)', () => {
    for (const id of ['original', 'original-light']) {
      const c = resolveTheme(id).colors;
      for (const k of ['live', 'wait', 'down', 'best', 'personal'] as const) expect(ratio(c[k], c.bg), `${id}/${k}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Original: paneles abiertos y cifras estrechas', () => {
  it('lo expresa con variables y atributos, y un tema sin `panels` sigue valiendo', () => {
    const o = themeVars(resolveTheme('original'));
    expect(o.attrs['data-panels']).toBe('open');
    expect(o.vars['--font-num-var']).toBe("'wdth' 75");
    expect(themeVars(resolveTheme('f1')).attrs['data-panels']).toBe('boxed');
    expect(themeVars(resolveTheme('f1')).vars['--font-num-var']).toBe('normal');
  });
  it('rechaza un estilo de paneles inventado y acepta los dos reales', () => {
    const base = JSON.parse(JSON.stringify(resolveTheme('gt')));
    expect(validateTheme({ ...base, panels: 'flotante' }).ok).toBe(false);
    expect(validateTheme({ ...base, panels: 'open' }).ok).toBe(true);
    delete base.panels;
    expect(validateTheme(base).ok).toBe(true);
  });
});

describe('Essential: cristal, puesto en cuadradito, mejores rellenos y títulos anchos', () => {
  it('se expresa con atributos y variables', () => {
    const e = themeVars(resolveTheme('essential'));
    expect(e.attrs).toMatchObject({ 'data-panels': 'glass', 'data-rank': 'tag', 'data-best': 'fill' });
    expect(e.vars['--font-display']).toContain('Michroma');
    const o = themeVars(resolveTheme('f1'));
    expect(o.attrs).toMatchObject({ 'data-rank': 'plain', 'data-best': 'text' });
    expect(o.vars['--font-display']).toBe(o.vars['--font-ui']);
  });
  it('valida las opciones nuevas y las deja pasar un viaje de exportar e importar', () => {
    const base = JSON.parse(JSON.stringify(resolveTheme('essential')));
    expect(validateTheme(base).ok).toBe(true);
    expect(validateTheme({ ...base, rank: 'redondo' }).ok).toBe(false);
    expect(validateTheme({ ...base, best: 'brillo' }).ok).toBe(false);
    expect(validateTheme({ ...base, displayFont: 'comic' }).ok).toBe(false);
    expect(validateTheme({ ...base, panels: 'glass' }).ok).toBe(true);
  });
});

describe('contraste ampliado de los temas de serie', () => {
  for (const t of BUILTIN_THEMES) {
    it(`${t.id}: texto y atenuado también sobre la segunda superficie; estados ≥ 4,5:1 (se usan como texto) sobre fondo y superficie; medallas legibles`, () => {
      const c = t.colors;
      expect(ratio(c.text, c.surface2), 'text/surface2').toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.muted, c.surface2), 'muted/surface2').toBeGreaterThanOrEqual(4.5);
      for (const k of ['live', 'wait', 'down', 'best', 'personal', 'other'] as const) {
        for (const bg of [c.bg, c.surface]) expect(ratio(c[k], bg), `${k}/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const k of ['gold', 'silver', 'bronze'] as const) expect(ratio(c[k], c.bg), `${k}/bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(accentTextColor(c), c.bg), 'accent-text/bg').toBeGreaterThanOrEqual(4.5);
      expect(ratio(accentTextColor(c), c.surface2), 'accent-text/surface2').toBeGreaterThanOrEqual(4.5);
    });
  }
  it('el texto elegido sobre cualquier acento ofrecido llega a 4,5:1', () => {
    for (const a of ACCENT_SWATCHES) expect(ratio(onAccentFor(a), a), a).toBeGreaterThanOrEqual(4.5);
  });
});

describe('colores de la banda de récord', () => {
  const base = BUILTIN_THEMES[0]!;
  it('sin elegir no se emiten variables; elegidos, pasan la validación y salen como variables', () => {
    expect(themeVars(base).vars['--ticker-bg']).toBeUndefined();
    const th = withTicker(base, '#FF0066', '#ffffff');
    expect(th.id).toBe('original-custom');
    const ok = validateTheme(th);
    expect(ok.ok && ok.value.tickerBg).toBe('#ff0066');
    expect(themeVars(th).vars).toMatchObject({ '--ticker-bg': '#ff0066', '--ticker-fg': '#ffffff' });
  });
  it('un color que no es #rrggbb rechaza el tema', () => {
    expect(validateTheme({ ...withTicker(base, '#ff0066', undefined), tickerFg: 'rojo' }).ok).toBe(false);
  });
  it('«colores de serie» quita los dos', () => {
    const back = withTicker(withTicker(base, '#ff0066', '#ffffff'), undefined, undefined);
    expect(back.tickerBg).toBeUndefined();
    expect(back.tickerFg).toBeUndefined();
  });
});

describe('títulos con el color de acento', () => {
  it('se valida, viaja en el atributo y un tema de serie pasa a ser propio al activarlo', () => {
    const on = withAccentTitles(resolveTheme('original'), true);
    expect(on).toMatchObject({ accentTitles: true, id: 'original-custom' });
    expect(themeVars(on).attrs['data-accent-titles']).toBe('on');
    expect(themeVars(resolveTheme('original')).attrs['data-accent-titles']).toBe('off');
    expect(validateTheme(JSON.parse(JSON.stringify(on)))).toMatchObject({ ok: true, value: { accentTitles: true } });
    expect(validateTheme({ ...on, accentTitles: 'si' }).ok).toBe(false);
    expect(withAccentTitles(on, false).accentTitles).toBeUndefined();
    expect(withAccentTitles(withAccent(on, '#ff4500'), true).accentTitles).toBe(true);
  });
});
