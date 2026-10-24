import { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_IDS, layoutOf, type AppearanceConfig, resolveTheme, type ThemeSelection, resolveLayout, validateLayout, type LayoutEntry, type PageId, type PlacedEntry } from '@howler/shared';
import { api, useLive } from '../api';
import { HomePage } from '../pages/HomePage';
import { SessionPage } from '../pages/SessionPage';
import { downloadText } from '../download';
import { t, tm } from '../i18n';
import { LayoutOverride, getAppearance, setAppearance, useAppearance } from '../modules/appearance-store';
import { LayoutEditor } from './layout/LayoutEditor';
import { adminPut } from './adminApi';
import { previewThemeOnPage, themeProps } from '../theme-apply';
import { ThemeCard } from './ThemeCard';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const PAGE_LABEL: Record<PageId, string> = {
  home: t('Inicio'), session: t('Sesión del historial'),
};
type Draft = Partial<Record<PageId, LayoutEntry[]>>;
type View = 'theme' | 'layout';

const resolved = (page: PageId, stored: LayoutEntry[] | undefined): PlacedEntry[] => resolveLayout(page, stored).map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, ...(e.hidden ? { hidden: true } : {}) }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const themeKey = (s: ThemeSelection | undefined) => JSON.stringify(resolveTheme(s));

/** Vista previa con la web real: los datos son los de verdad y la disposición la de prueba. Los enlaces no navegan. */
function Preview({ page, draft, theme }: { page: PageId; draft: Draft; theme: ThemeSelection | undefined }) {
  const { style, attrs } = themeProps(resolveTheme(theme));
  const status = useLive(api.status, [], (e) => e.type !== 'lap');
  const last = useLive(() => api.sessions({ limit: 1 }), [], (e) => e.type === 'session');
  const sessionId = last.data?.items[0]?.id;
  let body;
  if (page === 'home') body = <HomePage status={status.data} />;
  else if (page === 'session') body = sessionId ? <SessionPage id={sessionId} /> : <p className="empty">{t('Todavía no hay sesiones para enseñar.')}</p>;
  else body = <p className="empty">{t('Todavía no hay sesiones para enseñar.')}</p>;
  return (
    <LayoutOverride.Provider value={draft}>
      <div className="preview-frame" {...attrs} style={style} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); }}>{body}</div>
    </LayoutOverride.Provider>
  );
}

/**
 * Apariencia: el tema (colores, formas, tipografía; la web y el panel pueden tener cada uno el suyo) y la disposición de las
 * páginas de la web. Todo se prueba antes: nada cambia hasta «Guardar y publicar», que vive en una barra fija abajo.
 */
export function AppearanceSection() {
  const saved = useAppearance();
  const [view, setView] = useState<View>('theme');
  const [page, setPage] = useState<PageId>('home');
  const [draft, setDraft] = useState<Draft>({});
  const [themeDraft, setThemeDraft] = useState<{ sel: ThemeSelection | undefined } | null>(null);
  /** Tema propio del panel: `null` = el panel usa el mismo que la web. */
  const [panelDraft, setPanelDraft] = useState<{ sel: ThemeSelection | null } | null>(null);
  const [editing, setEditing] = useState<'web' | 'panel'>('web');
  const [busy, setBusy] = useState(false);
  const { notice, run } = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(() => resolved(page, draft[page] ?? saved?.layouts[page]), [page, draft, saved]);
  const themeSel = themeDraft ? themeDraft.sel : saved?.theme;
  const panelSel: ThemeSelection | null = panelDraft ? panelDraft.sel : (saved?.panelTheme ?? null);
  const separate = panelSel !== null;
  const panelEffective = panelSel ?? themeSel;

  // El panel enseña ya el tema que se está editando; al salir de esta pantalla vuelve al guardado
  useEffect(() => { previewThemeOnPage(panelEffective); }, [themeKey(panelEffective)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const a = getAppearance(); if (a) previewThemeOnPage(a.panelTheme ?? a.theme); }, []);

  if (!saved) return <p className="empty">{t('Cargando…')}</p>;

  const webDirty = !!themeDraft && themeKey(themeSel) !== themeKey(saved.theme);
  const panelDirty = !!panelDraft && (panelSel === null ? saved.panelTheme !== undefined : saved.panelTheme === undefined || themeKey(panelSel) !== themeKey(saved.panelTheme));
  const dirtyPages = PAGE_IDS.filter((p) => p in draft && !same(resolved(p, draft[p]), resolved(p, saved.layouts[p])));
  const anyDirty = webDirty || panelDirty || dirtyPages.length > 0;
  const edit = (next: PlacedEntry[]) => setDraft((d) => ({ ...d, [page]: next }));
  const isDefault = (p: PageId) => same(resolved(p, undefined), resolved(p, draft[p] ?? saved.layouts[p]));

  const save = async () => {
    setBusy(true);
    await run(async () => {
      const layouts: Draft = { ...saved.layouts };
      for (const p of PAGE_IDS) {
        if (!(p in draft)) continue;
        if (same(resolved(p, draft[p]), resolved(p, undefined))) delete layouts[p]; else layouts[p] = resolved(p, draft[p]);
      }
      const out = await adminPut<AppearanceConfig>('/admin/api/appearance', { layouts, theme: themeSel, panelTheme: panelSel });
      setAppearance(out);
      setDraft({});
      setThemeDraft(null);
      setPanelDraft(null);
    }, t('Guardado: ya se usa esta apariencia.'));
    setBusy(false);
  };
  const discard = () => { setDraft({}); setThemeDraft(null); setPanelDraft(null); setEditing('web'); };
  const exportLayout = () => {
    downloadText(`howler-layout-${page}.json`, JSON.stringify(layoutOf(page, rows), null, 2));
  };
  /** Carga el archivo como borrador: se ve en la vista previa y no cambia nada hasta «Guardar y publicar». */
  const importLayout = async (file: File) => {
    try {
      if (file.size > 100_000) throw new Error('El archivo es demasiado grande.');
      const checked = validateLayout(JSON.parse(await file.text()));
      if (!checked.ok) { setImportMsg({ ok: false, text: tm(checked.error) }); return; }
      const { page: target, modules } = checked.value;
      setDraft((d) => ({ ...d, [target]: resolved(target, modules) }));
      setPage(target);
      setImportMsg({ ok: true, text: t('Disposición cargada para «{page}»: mira la vista previa y pulsa «Guardar y publicar» si te gusta.', { page: PAGE_LABEL[target] }) });
    } catch (e) {
      setImportMsg({ ok: false, text: tm(e instanceof SyntaxError ? 'El archivo no es una disposición.' : (e as Error).message) });
    }
  };
  const restore = () => setDraft((d) => ({ ...d, [page]: resolved(page, undefined) }));
  const setSeparate = (on: boolean) => {
    setPanelDraft({ sel: on ? (themeSel ?? 'original') : null });
    if (!on) setEditing('web');
  };
  const scope = separate ? editing : 'web';

  return (
    <div className="tab-body">
      <span className="segmented" role="group" aria-label={t('Qué quieres personalizar')}>
        <button type="button" className={view === 'theme' ? 'on' : ''} aria-pressed={view === 'theme'} onClick={() => setView('theme')}>{t('Tema y colores')}{(webDirty || panelDirty) ? ' •' : ''}</button>
        <button type="button" className={view === 'layout' ? 'on' : ''} aria-pressed={view === 'layout'} onClick={() => setView('layout')}>{t('Disposición de la web')}{dirtyPages.length > 0 ? ' •' : ''}</button>
      </span>

      {view === 'theme' && (
        <>
          <Card title={t('Dónde se aplica')}>
            <p className="hint">{t('Por defecto, el panel y la web pública usan el mismo tema. Si quieres, el panel puede tener el suyo (por ejemplo, uno sobrio para ti y otro vistoso para los visitantes).')}</p>
            <label className="sp-switch"><input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /><span>{t('El panel usa un tema distinto al de la web')}</span></label>
            {separate && (
              <span className="segmented" role="group" aria-label={t('Tema que estás editando')}>
                <button type="button" className={scope === 'web' ? 'on' : ''} aria-pressed={scope === 'web'} onClick={() => setEditing('web')}>{t('Web pública')}{webDirty ? ' •' : ''}</button>
                <button type="button" className={scope === 'panel' ? 'on' : ''} aria-pressed={scope === 'panel'} onClick={() => setEditing('panel')}>{t('Panel')}{panelDirty ? ' •' : ''}</button>
              </span>
            )}
          </Card>
          <ThemeCard
            scope={scope}
            value={scope === 'panel' ? (panelSel ?? undefined) : themeSel}
            onChange={(sel) => (scope === 'panel' ? setPanelDraft({ sel: sel ?? 'original' }) : setThemeDraft({ sel }))}
            dirty={scope === 'panel' ? panelDirty : webDirty}
          />
          {scope === 'web' && (
            <Card title={t('Vista previa de la web')}>
              <p className="hint">{t('Así se verá la web con este tema, con los datos de verdad.')}</p>
              <Preview page="home" draft={{ ...saved.layouts, ...draft }} theme={themeSel} />
            </Card>
          )}
        </>
      )}

      {view === 'layout' && (
        <>
          <Card title={t('Disposición de la web')}>
            <p className="hint">{t('Elige una página y móntala como quieras: arrastra módulos desde la lista, muévelos y estíralos por las esquinas; se pegan a una cuadrícula invisible. Hasta que no pulses «Guardar y publicar» la web pública no cambia.')}</p>
            <span className="segmented" role="group" aria-label={t('Página')}>
              {PAGE_IDS.map((p) => <button key={p} type="button" className={p === page ? 'on' : ''} aria-pressed={p === page} onClick={() => setPage(p)}>{PAGE_LABEL[p]}{dirtyPages.includes(p) ? ' •' : ''}</button>)}
            </span>
            <LayoutEditor page={page} rows={rows} onChange={edit} />
            <div className="actions">
              <ConfirmButton label={t('Restaurar la de serie (esta página)')} confirmLabel={t('¿Seguro? Se pierde la disposición de esta página')} disabled={busy || isDefault(page)} onConfirm={restore} />
              <button type="button" className="btn" onClick={exportLayout}>{t('Exportar esta página')}</button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('Importar desde un archivo…')}</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importLayout(f); }} />
            </div>
            <Notice notice={importMsg} />
          </Card>
          <Card title={t('Vista previa: {page}', { page: PAGE_LABEL[page] })}>
            <p className="hint">{t('Así se verá la web con tus cambios, con los datos de verdad.')}</p>
            <Preview page={page} draft={{ ...saved.layouts, ...draft }} theme={themeSel} />
          </Card>
        </>
      )}

      <div className="sp-bar" role="region" aria-label={t('Guardar los cambios')}>
        <span className={anyDirty ? 'badge pending' : 'muted'}>{anyDirty ? t('Cambios sin guardar') : t('Todo guardado')}</span>
        <Notice notice={notice} />
        <button type="button" className="btn" disabled={busy || !anyDirty} onClick={discard}>{t('Descartar cambios')}</button>
        <button type="button" className="btn primary" disabled={busy || !anyDirty} onClick={() => void save()}>{t('Guardar y publicar')}</button>
      </div>
    </div>
  );
}
