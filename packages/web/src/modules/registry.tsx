import type { ReactNode } from 'react';
import { t } from '../i18n';
import type { PageCtx, SessionCtx } from './context';
import { KingModule, LatestRecordsModule, LiveMapModule, PodiumModule, RecordTickerModule, SessionHeadModule, StandingsModule } from './session-modules';

export interface ModuleDef { title: string; render: (ctx: PageCtx) => ReactNode }

// Cada módulo solo se pinta en las páginas cuyo contexto entiende; en otra, no sale nada.
const session = (title: string, fn: (c: SessionCtx) => ReactNode): ModuleDef => ({ title, render: (c) => (c.kind === 'session' ? fn(c) : null) });

/**
 * Catálogo de módulos de la web. El id es el mismo que en `MODULE_META` (@howler/shared), que es lo que valida las
 * disposiciones. Para añadir un módulo: componente, entrada aquí y entrada allí (hay un test que comprueba que coinciden).
 */
export const MODULES: Record<string, ModuleDef> = {
  'session-head': session(t('Cabecera de la sesión'), (c) => <SessionHeadModule c={c} />),
  'record-ticker': session(t('Tira de nuevo récord'), () => <RecordTickerModule />),
  'live-map': session(t('Mapa en directo'), (c) => <LiveMapModule c={c} />),
  podium: session(t('Los tres primeros'), (c) => <PodiumModule c={c} />),
  standings: session(t('Clasificación general'), (c) => <StandingsModule c={c} />),
  king: session(t('Rey de la colina'), (c) => <KingModule c={c} />),
  'latest-records': session(t('Últimos récords'), () => <LatestRecordsModule />),
};

export const moduleTitle = (id: string) => MODULES[id]?.title ?? id;
