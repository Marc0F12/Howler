import { useMemo, useState } from 'react';
import { OWN_EMBLEMS } from '@howler/shared';
import type { LibIcon } from '../../badge/library';
import { t } from '../../i18n';
import { CATEGORY_LABELS } from './badge-labels';

const OWN_COLORS = { rim1: '', rim2: '', bg1: '', bg2: '', accent: '', emblem: 'currentColor', outline: 'none', text: '' };

/** Biblioteca de emblemas: los dibujados en código y la biblioteca de Howler, con categorías y buscador. */
export function EmblemPicker({ value, onPick, icons, failed }: { value: string; onPick: (key: string) => void; icons: LibIcon[] | null; failed: boolean }) {
  const [cat, setCat] = useState('todos');
  const [q, setQ] = useState('');
  const cats = useMemo(() => ['todos', 'propios', ...new Set((icons ?? []).map((i) => i.c))], [icons]);
  const items = useMemo(() => {
    const n = q.trim().toLowerCase();
    const own = cat === 'todos' || cat === 'propios'
      ? Object.entries(OWN_EMBLEMS).filter(([id, e]) => !n || `${id} ${e.name}`.toLowerCase().includes(n)).map(([id, e]) => ({ key: 'own:' + id, name: e.name, svg: <svg viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: e.markup(OWN_COLORS) }} /> }))
      : [];
    const gi = cat === 'propios' ? [] : (icons ?? []).filter((i) => (cat === 'todos' || i.c === cat) && (!n || `${i.n} ${i.en} ${i.t} ${i.id}`.toLowerCase().includes(n)))
      .map((i) => ({ key: 'em:' + i.id, name: i.n, svg: <svg viewBox="0 0 512 512" aria-hidden="true"><path d={i.d} fill="currentColor" fillRule="evenodd" /></svg> }));
    return [...own, ...gi];
  }, [cat, q, icons]);
  return (
    <div className="bge-emblems">
      <input type="search" className="bge-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar (lobo, corona, rueda, calavera…)')} aria-label={t('Buscar emblema')} />
      <div className="bge-chips" role="group" aria-label={t('Categorías')}>
        {cats.map((c) => <button key={c} type="button" className="bge-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c === 'todos' ? t('Todos') : (CATEGORY_LABELS[c] ?? c)}</button>)}
      </div>
      <div className="bge-grid" role="listbox" aria-label={t('Emblemas')}>
        {items.map((e) => <button key={e.key} type="button" role="option" aria-selected={value === e.key} aria-label={e.name} title={e.name} className="bge-icon" onClick={() => onPick(e.key)}>{e.svg}</button>)}
        {items.length === 0 && <p className="hint">{icons || failed ? t('Sin resultados.') : t('Cargando…')}</p>}
      </div>
      {failed && <p className="hint">{t('No se pudo cargar la biblioteca de emblemas; solo están los dibujados aquí.')}</p>}
    </div>
  );
}
