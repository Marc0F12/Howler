import { useRef, useState, type CSSProperties } from 'react';
import { ACCENT_SWATCHES, BUILTIN_THEMES, THEME_CARDS, resolveTheme, withAccent, withAccentTitles, withTicker, validateTheme, type Theme, type ThemeSelection } from '@howler/shared';
import { RecordBand, SAMPLE_RECORD } from '../components/RecordTicker';
import { downloadText } from '../download';
import { t, tm } from '../i18n';
import { Card, Notice } from './ui';

/** Selector de tema (solo el administrador lo cambia). Lo elegido se ve en la vista previa y se publica con «Guardar y publicar». */
export function ThemeCard({ value, onChange, dirty, scope = 'web' }: { value: ThemeSelection | undefined; onChange: (s: ThemeSelection | undefined) => void; dirty: boolean; scope?: 'web' | 'panel' }) {
  const current = resolveTheme(value);
  const custom = BUILTIN_THEMES.includes(current) ? null : current;
  const fileRef = useRef<HTMLInputElement>(null);
  const [replay, setReplay] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const importTheme = async (file: File) => {
    try {
      if (file.size > 20_000) throw new Error('El archivo es demasiado grande.');
      const c = validateTheme(JSON.parse(await file.text()));
      if (!c.ok) { setMsg({ ok: false, text: tm(c.error) }); return; }
      onChange(BUILTIN_THEMES.some((b) => b.id === c.value.id) ? { ...c.value, id: `${c.value.id}-custom` } : c.value);
      setMsg({ ok: true, text: t('Tema «{name}» cargado: mira la vista previa y pulsa «Guardar y publicar» si te gusta.', { name: c.value.name }) });
    } catch (e) {
      setMsg({ ok: false, text: tm(e instanceof SyntaxError ? 'El archivo no es un tema.' : (e as Error).message) });
    }
  };
  const card = (th: Theme) => (
    <button key={th.id} type="button" className={`theme-card ${th.id === current.id || (th.id === 'original' && current.id === 'original-light') ? 'on' : ''}`} aria-pressed={th.id === current.id || (th.id === 'original' && current.id === 'original-light')}
      onClick={() => onChange(!BUILTIN_THEMES.includes(th) ? th : th.id === 'original' ? (current.id === 'original-light' ? 'original-light' : undefined) : th.id)}>
      <span className="theme-swatch" aria-hidden="true" style={{ background: th.colors.bg }}>
        {[th.colors.surface2, th.colors.accent, th.colors.best, th.colors.personal, th.colors.other].map((c, i) => <i key={i} style={{ background: c }} />)}
      </span>
      <strong>{th.name}</strong>
    </button>
  );
  return (
    <Card title={scope === 'panel' ? t('Tema del panel') : t('Tema')} aside={dirty ? <span className="badge pending">{t('Cambios sin guardar')}</span> : undefined}>
      <p className="hint">{scope === 'panel' ? t('Colores, formas y tipografía del panel de control. Solo se ve desde el panel; la web pública no cambia.') : t('El tema cambia colores, formas y tipografía de la web (y del panel, si no tiene uno propio). Solo lo cambia el administrador desde aquí.')}</p>
      <div className="theme-grid">{THEME_CARDS.map(card)}{custom && card(custom)}</div>
      {current.id.startsWith('original') && (
        <div className="segmented" role="group" aria-label={t('Modo del tema Original')}>
          <button type="button" className={current.id === 'original' ? 'on' : ''} aria-pressed={current.id === 'original'} onClick={() => onChange(undefined)}>{t('Oscuro')}</button>
          <button type="button" className={current.id === 'original-light' ? 'on' : ''} aria-pressed={current.id === 'original-light'} onClick={() => onChange('original-light')}>{t('Claro')}</button>
        </div>
      )}
      <div className="accent-row" role="group" aria-label={t('Color de acento')}>
        <span className="muted">{t('Color de acento')}</span>
        {ACCENT_SWATCHES.map((c) => (
          <button key={c} type="button" className={`accent-dot ${current.colors.accent.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={current.colors.accent.toLowerCase() === c} onClick={() => onChange(withAccent(current, c))} />
        ))}
        <label className="accent-custom muted">{t('Otro color')}
          <input type="color" value={current.colors.accent} onChange={(e) => onChange(withAccent(current, e.target.value))} aria-label={t('Elegir otro color de acento')} />
          <code>{current.colors.accent}</code>
        </label>
      </div>
      <label className="sp-switch"><input type="checkbox" checked={current.accentTitles === true} onChange={(e) => onChange(withAccentTitles(current, e.target.checked))} /><span>{t('Títulos e iconos con el color de acento')}</span></label>
      {scope === 'web' && (<>
      <div className="accent-row" role="group" aria-label={t('Banda de nuevo récord')}>
        <span className="muted">{t('Banda de nuevo récord')}</span>
        <label className="muted">{t('Fondo')} <input type="color" value={current.tickerBg ?? current.colors.wait} onChange={(e) => onChange(withTicker(current, e.target.value, current.tickerFg))} aria-label={t('Fondo de la banda de nuevo récord')} /></label>
        <label className="muted">{t('Texto')} <input type="color" value={current.tickerFg ?? '#000000'} onChange={(e) => onChange(withTicker(current, current.tickerBg, e.target.value))} aria-label={t('Texto de la banda de nuevo récord')} /></label>
        {(current.tickerBg || current.tickerFg) && <button type="button" className="btn" onClick={() => onChange(withTicker(current, undefined, undefined))}>{t('Colores de serie')}</button>}
      </div>
      <div className="ticker-sample" aria-label={t('Muestra de la banda de nuevo récord')}>
        <div className="ticker-sample-cell">
          <RecordBand key={replay} r={SAMPLE_RECORD} where={t('Circuito')} what={t('Coche')} left={3_600_000} style={{ '--ticker-bg': current.tickerBg ?? current.colors.wait, '--ticker-fg': current.tickerFg ?? '#000000' } as CSSProperties} />
        </div>
        <button type="button" className="btn" onClick={() => setReplay((n) => n + 1)}>{t('Ver la animación')}</button>
      </div>
      </>)}
      <div className="actions">
        <button type="button" className="btn" onClick={() => downloadText(`howler-theme-${current.id}.json`, JSON.stringify(current, null, 2))}>{t('Exportar el tema actual')}</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('Importar un tema…')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importTheme(f); }} />
      </div>
      <Notice notice={msg} />
    </Card>
  );
}
