import { ModuleBoundary } from '../../modules/ModuleBoundary';
import type { PageCtx } from '../../modules/context';
import { MODULES, moduleTitle } from '../../modules/registry';
import { t } from '../../i18n';
import { NEEDS_SERVER } from './sample-ctx';

type Wire = 'head' | 'ticker' | 'map' | 'podium' | 'table' | 'cards' | 'list' | 'chart';
const WIRE: Record<string, Wire> = {
  'session-head': 'head', 'record-ticker': 'ticker', 'live-map': 'map', podium: 'podium',
  standings: 'table', king: 'table', 'latest-records': 'table',
};

/** Esquema gris de un módulo (cuando no hay datos con los que dibujarlo de verdad). */
export function ModuleWire({ id }: { id: string }) {
  const kind = WIRE[id] ?? 'table';
  return (
    <div className={`wire wire-${kind}`} aria-hidden="true">
      <b className="wire-title">{moduleTitle(id)}</b>
      {kind === 'map' && <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet"><path d="M12 38 C8 16 34 8 52 14 S92 14 88 34 62 54 44 46 S16 52 12 38Z" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="52" cy="14" r="3" fill="currentColor" /></svg>}
      {kind === 'podium' && <div className="wire-podium"><i style={{ height: '55%' }} /><i style={{ height: '80%' }} /><i style={{ height: '40%' }} /></div>}
      {kind === 'table' && Array.from({ length: 8 }, (_, k) => <i key={k} className="wire-row" style={{ width: `${96 - k * 4}%` }} />)}
      {kind === 'list' && Array.from({ length: 5 }, (_, k) => <i key={k} className="wire-row tall" />)}
      {kind === 'cards' && <div className="wire-cards">{Array.from({ length: 4 }, (_, k) => <i key={k} />)}</div>}
      {kind === 'chart' && <svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="0,34 20,28 40,30 60,16 80,18 100,6" fill="none" stroke="currentColor" strokeWidth="2" /><polyline points="0,36 20,33 40,26 60,26 80,14 100,12" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" /></svg>}
      {(kind === 'head' || kind === 'ticker') && <i className="wire-row" style={{ width: kind === 'head' ? '55%' : '80%' }} />}
    </div>
  );
}

/**
 * Cómo se ve un módulo en el editor: dibujado de verdad con datos reales o de ejemplo; si no hay con qué (un campeonato
 * que no existe, módulos que viven de datos del servidor), como esquema.
 */
export function ModulePreview({ id, ctx, real }: { id: string; ctx: PageCtx | null; real: boolean }) {
  const def = MODULES[id];
  if (!def || !ctx || (NEEDS_SERVER.has(id) && !real)) return <ModuleWire id={id} />;
  return (
    <ModuleBoundary id={id}>
      <div className="lay-live">{def.render(ctx) ?? <ModuleWire id={id} />}</div>
      {!real && <span className="lay-sample">{t('Ejemplo')}</span>}
    </ModuleBoundary>
  );
}
