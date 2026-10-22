import { useMemo, useRef, useState } from 'react';
import { PAGE_IDS, layoutOf, type AppearanceConfig, resolveTheme, type ThemeSelection, resolveLayout, validateLayout, type LayoutEntry, type PageId, type PlacedEntry } from '@howler/shared';
import { api, useLive } from '../api';
import { HomePage } from '../pages/HomePage';
import { SessionPage } from '../pages/SessionPage';
import { downloadText } from '../download';
import { t, tm } from '../i18n';
import { LayoutOverride, setAppearance, useAppearance } from '../modules/appearance-store';
import { LayoutEditor } from './layout/LayoutEditor';
import { adminPut } from './adminApi';
import { themeProps } from '../theme-apply';
import { ThemeCard } from './ThemeCard';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const PAGE_LABEL: Record<PageId, string> = {
  home: t('Inicio'), session: t('Sesión del historial'),
};
type Draft = Partial<Record<PageId, LayoutEntry[]>>;

const resolved = (page: PageId, stored: LayoutEntry[] | undefined): PlacedEntry[] => resolveLayout(page, stored).map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, ...(e.hidden ? { hidden: true } : {}) }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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

/** Editor de disposición: qué módulos salen en cada página de la web pública, en qué orden y de qué ancho. */
export function AppearanceSection() {
  const saved = useAppearance();
  const [page, setPage] = useState<PageId>('home');
  const [draft, setDraft] = useState<Draft>({});
  const [themeDraft, setThemeDraft] = useState<{ sel: ThemeSelection | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const { notice, run } = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(() => resolved(page, draft[page] ?? saved?.layouts[page]), [page, draft, saved]);
  if (!saved) return <p className="empty">{t('Cargando…')}</p>;

  const themeSel = themeDraft ? themeDraft.sel : saved.theme;
  const themeDirty = !!themeDraft && JSON.stringify(resolveTheme(themeSel)) !== JSON.stringify(resolveTheme(saved.theme));
  const dirtyPages = PAGE_IDS.filter((p) => p in draft && !same(resolved(p, draft[p]), resolved(p, saved.layouts[p])));
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
      const out = await adminPut<AppearanceConfig>('/admin/api/appearance', { layouts, theme: themeSel });
      setAppearance(out);
      setDraft({});
      setThemeDraft(null);
    }, t('Guardado: la web pública ya usa esta disposición.'));
    setBusy(false);
  };
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

  return (
    <div className="tab-body">
      <Card title={t('Disposición de la web')} aside={dirtyPages.length > 0 || themeDirty ? <span className="badge pending">{t('Cambios sin guardar')}</span> : undefined}>
        <p className="hint">{t('Elige una página y móntala como quieras: arrastra módulos desde la lista, muévelos y estíralos por las esquinas; se pegan a una cuadrícula invisible. Hasta que no pulses «Guardar y publicar» la web pública no cambia.')}</p>
        <span className="segmented" role="group" aria-label={t('Página')}>
          {PAGE_IDS.map((p) => <button key={p} type="button" className={p === page ? 'on' : ''} aria-pressed={p === page} onClick={() => setPage(p)}>{PAGE_LABEL[p]}{dirtyPages.includes(p) ? ' •' : ''}</button>)}
        </span>
        <LayoutEditor page={page} rows={rows} onChange={edit} />
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy || (dirtyPages.length === 0 && !themeDirty)} onClick={() => void save()}>{t('Guardar y publicar')}</button>
          <button type="button" className="btn" disabled={busy || (dirtyPages.length === 0 && !themeDirty)} onClick={() => { setDraft({}); setThemeDraft(null); }}>{t('Descartar cambios')}</button>
          <ConfirmButton label={t('Restaurar la de serie (esta página)')} confirmLabel={t('¿Seguro? Se pierde la disposición de esta página')} disabled={busy || isDefault(page)} onConfirm={restore} />
        </div>
        <Notice notice={notice} />
        <div className="actions">
          <button type="button" className="btn" onClick={exportLayout}>{t('Exportar esta página')}</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('Importar desde un archivo…')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importLayout(f); }} />
        </div>
        <Notice notice={importMsg} />
      </Card>
      <ThemeCard value={themeSel} onChange={(sel) => setThemeDraft({ sel })} dirty={themeDirty} />
      <Card title={t('Vista previa: {page}', { page: PAGE_LABEL[page] })}>
        <p className="hint">{t('Así se verá la web con tus cambios, con los datos de verdad.')}</p>
        <Preview page={page} draft={{ ...saved.layouts, ...draft }} theme={themeSel} />
      </Card>
    </div>
  );
}
