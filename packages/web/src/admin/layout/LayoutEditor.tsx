import { useMemo, useState } from 'react';
import ReactGridLayout, { noCompactor, useContainerWidth, type Layout } from 'react-grid-layout';
import { GridBackground } from 'react-grid-layout/extras';
import 'react-grid-layout/css/styles.css';
import { GRID_COLS, GRID_GAP_PX, GRID_ROW_PX, MODULE_META, defaultCols, moduleMeta, type PageId, type PlacedEntry } from '@howler/shared';
import { t } from '../../i18n';
import type { PageCtx } from '../../modules/context';
import { moduleTitle } from '../../modules/registry';
import { ModulePreview } from './ModulePreview';
import { useEditorCtx } from './sample-ctx';

const THUMB_W = 250;
/** Miniatura del módulo: se dibuja a su tamaño de serie (como se vería en la página) y se encoge para caber en la lista. */
function Thumb({ id, ctx, real }: { id: string; ctx: PageCtx | null; real: boolean }) {
  const m = moduleMeta(id)!;
  const w = defaultCols(m) * 100, h = m.defaultH * (GRID_ROW_PX + GRID_GAP_PX) - GRID_GAP_PX;
  const k = THUMB_W / w;
  return (
    <div className="lay-thumb" style={{ height: Math.min(150, Math.max(40, h * k)) }}>
      <div className="lay-thumb-in" style={{ width: w, height: h, transform: `scale(${k})` }}><ModulePreview id={id} ctx={ctx} real={real} /></div>
    </div>
  );
}

const bottom = (rows: PlacedEntry[]) => rows.filter((e) => !e.hidden).reduce((m, e) => Math.max(m, e.y + e.h), 0);
const sameRect = (a: PlacedEntry, b: { x: number; y: number; w: number; h: number }) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Editor de la disposición de una página, como los widgets del móvil: a la izquierda los módulos disponibles (con datos reales
 * o de ejemplo) y a la derecha la página. Se arrastran de la lista a la página, se mueven y se estiran; todo encaja en una
 * cuadrícula invisible de 12 columnas. Quitar un módulo lo devuelve a la lista.
 */
export function LayoutEditor({ page, rows, onChange }: { page: PageId; rows: PlacedEntry[]; onChange: (next: PlacedEntry[]) => void }) {
  const { ctx, real } = useEditorCtx(page);
  const { width, containerRef, mounted } = useContainerWidth();
  const [dragging, setDragging] = useState<string | null>(null);
  const visible = rows.filter((e) => !e.hidden);
  const layout: Layout = useMemo(() => visible.map((e) => {
    const m = moduleMeta(e.id)!;
    return { i: e.id, x: e.x, y: e.y, w: e.w, h: e.h, minW: m.minW, minH: m.minH, maxW: GRID_COLS };
  }), [visible.map((e) => `${e.id}:${e.x},${e.y},${e.w},${e.h}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pasa a los módulos las posiciones que decide la cuadrícula (si algo cambió de verdad). */
  const apply = (next: Layout, added?: string) => {
    const by = new Map(next.map((l) => [l.i, l]));
    let changed = false;
    const out = rows.map((e) => {
      const l = by.get(e.id);
      if (!l) return e;
      const rect = { x: l.x, y: l.y, w: l.w, h: l.h };
      if (e.hidden && e.id !== added) return e;
      if (!e.hidden && sameRect(e, rect)) return e;
      changed = true;
      const { hidden: _h, ...rest } = e;
      return { ...rest, ...rect };
    });
    if (changed) onChange(out);
  };
  const remove = (id: string) => onChange(rows.map((e) => (e.id === id ? { ...e, hidden: true } : e)));
  /** Añade un módulo al final de la página (con su tamaño de serie) sin arrastrar. */
  const addAtEnd = (id: string) => {
    const m = moduleMeta(id)!;
    onChange(rows.map((e) => { if (e.id !== id) return e; const { hidden: _h, ...rest } = e; return { ...rest, x: 0, y: bottom(rows), w: defaultCols(m), h: m.defaultH }; }));
  };

  const pageModules = MODULE_META.filter((m) => m.pages.includes(page));
  const placed = new Set(visible.map((e) => e.id));
  const dropMeta = dragging ? moduleMeta(dragging) : undefined;
  const totalRows = Math.max(24, bottom(rows) + 10);

  return (
    <div className="lay-editor">
      <aside className="lay-palette" aria-label={t('Módulos disponibles')}>
        <h4>{t('Módulos')}</h4>
        <p className="hint">{t('Arrastra un módulo a la página, o pulsa «Añadir». Los que ya están puestos se quitan con la ✕ de la página.')}</p>
        {pageModules.map((m) => {
          const used = placed.has(m.id);
          return (
            <div key={m.id} className={`lay-card ${used ? 'used' : ''}`} draggable={!used}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move'; setDragging(m.id); }}
              onDragEnd={() => setDragging(null)}>
              <Thumb id={m.id} ctx={ctx} real={real} />
              <div className="lay-card-foot">
                <b>{moduleTitle(m.id)}</b>
                {used ? <span className="muted">{t('En la página')}</span> : <button type="button" className="btn small" onClick={() => addAtEnd(m.id)}>{t('Añadir')}</button>}
              </div>
            </div>
          );
        })}
      </aside>

      <div className="lay-stage" ref={containerRef}>
        {mounted && (
          <div className="lay-canvas" style={{ height: totalRows * (GRID_ROW_PX + GRID_GAP_PX) + GRID_GAP_PX }}>
            <GridBackground width={width} cols={GRID_COLS} rowHeight={GRID_ROW_PX} margin={[GRID_GAP_PX, GRID_GAP_PX]} rows={totalRows} color="rgba(128,128,128,0.07)" borderRadius={3} />
            <ReactGridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_PX, margin: [GRID_GAP_PX, GRID_GAP_PX], containerPadding: [0, 0], maxRows: Infinity }}
              dragConfig={{ enabled: true, bounded: false, cancel: '.lay-x', threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] }}
              dropConfig={{ enabled: dragging != null, defaultItem: { w: dropMeta ? defaultCols(dropMeta) : 4, h: dropMeta?.defaultH ?? 6 }, onDragOver: () => (dropMeta ? { w: defaultCols(dropMeta), h: dropMeta.defaultH } : false) }}
              droppingItem={dropMeta ? { i: dropMeta.id, x: 0, y: 0, w: defaultCols(dropMeta), h: dropMeta.defaultH, minW: dropMeta.minW, minH: dropMeta.minH } : undefined}
              compactor={noCompactor}
              onLayoutChange={(l) => apply(l)}
              onDrop={(l, item) => { if (item) { apply(l.some((x) => x.i === item.i) ? l : [...l, item], item.i); } setDragging(null); }}
            >
              {visible.map((e) => (
                <div key={e.id} className="lay-item">
                  <div className="lay-bar"><span>{moduleTitle(e.id)}</span><button type="button" className="lay-x" onClick={() => remove(e.id)} aria-label={t('Quitar {name}', { name: moduleTitle(e.id) })} title={t('Quitar de la página')}>✕</button></div>
                  <div className="mod lay-body"><ModulePreview id={e.id} ctx={ctx} real={real} /></div>
                </div>
              ))}
            </ReactGridLayout>
            {visible.length === 0 && <p className="lay-empty">{t('La página está vacía: arrastra aquí un módulo de la lista.')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
