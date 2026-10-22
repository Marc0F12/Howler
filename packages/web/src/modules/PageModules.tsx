import type { PageId } from '@howler/shared';
import { t } from '../i18n';
import { useLayout } from './appearance-store';
import type { PageCtx } from './context';
import { ModuleBoundary } from './ModuleBoundary';
import { MODULES } from './registry';

/**
 * Pinta los módulos de una página según su disposición: cada uno en su sitio de la cuadrícula (12 columnas, filas de 24 px),
 * aislado de los demás. En pantallas estrechas se apilan en orden de lectura y cada uno ocupa lo que necesite.
 */
export function PageModules({ page, ctx }: { page: PageId; ctx: PageCtx }) {
  const layout = useLayout(page);
  if (!layout) return <p className="empty">{t('Cargando…')}</p>;
  const shown = layout.filter((e) => !e.hidden && MODULES[e.id]).sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <div className="mods">
      {shown.map((e) => (
        <div key={e.id} className="mod" data-module={e.id} style={{ gridColumn: `${e.x + 1} / span ${e.w}`, gridRow: `${e.y + 1} / span ${e.h}` }}>
          <ModuleBoundary id={e.id}>{MODULES[e.id]!.render(ctx)}</ModuleBoundary>
        </div>
      ))}
    </div>
  );
}
