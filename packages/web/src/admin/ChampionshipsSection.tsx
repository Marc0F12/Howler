import { t } from '../i18n';
import { useState } from 'react';
import { useLive } from '../api';
import { adminApi } from './adminApi';
import { ChampionshipManage } from './ChampionshipManage';
import { ChampionshipWizard } from './ChampionshipWizard';
import { fromDto, newDraft, type Draft } from './championship-form';
import { Card } from './ui';

type View = { kind: 'list' } | { kind: 'manage'; id: number } | { kind: 'wizard'; draft: Draft };
const STATUS = { draft: t('Borrador'), active: t('Activo'), finished: t('Terminado') } as const;

/** Pestaña «Campeonatos» del panel: lista, asistente de creación y gestión. */
export function ChampionshipsSection({ onPendingChange }: { onPendingChange?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const { data, refresh } = useLive(adminApi.championships, [], (e) => e.type === 'lap' || e.type === 'session');

  if (view.kind === 'wizard') {
    return <ChampionshipWizard initial={view.draft} onCancel={() => setView(view.draft.id != null ? { kind: 'manage', id: view.draft.id } : { kind: 'list' })} onSaved={(id) => { refresh(); onPendingChange?.(); setView({ kind: 'manage', id }); }} />;
  }
  if (view.kind === 'manage') {
    return (
      <>
        <button type="button" className="btn small back" onClick={() => setView({ kind: 'list' })}>← {t('Todos los campeonatos')}</button>
        <ChampionshipManage id={view.id} onEdit={(c) => setView({ kind: 'wizard', draft: fromDto(c) })} onDeleted={() => { refresh(); setView({ kind: 'list' }); }} />
      </>
    );
  }
  return (
    <Card title={t('Campeonatos')} aside={<button type="button" className="btn primary small" onClick={() => setView({ kind: 'wizard', draft: newDraft() })}>{t('+ Nuevo campeonato')}</button>}>
      {!data ? <p className="empty">{t('Cargando…')}</p> : data.length === 0 ? (
        <p className="empty">{t('Todavía no hay campeonatos. Pulsa «+ Nuevo campeonato» y sigue los pasos.')}</p>
      ) : (
        <ul className="pick-list">
          {data.map((c) => (
            <li key={c.id}>
              <span><strong>{c.name}</strong>{c.sharedFrom && <span className="badge"> {t('de {name}', { name: c.sharedFrom })}</span>} <span className={`badge ${c.status === 'active' ? 'ok' : ''}`}>{STATUS[c.status]}</span>
                <span className="muted"> · {t('{n} participantes', { n: c.participants })} · {t('{played}/{total} carreras', { played: c.played, total: c.rounds })}{c.leader ? ` · ${t('líder: {name}', { name: c.leader.name })}` : ''}</span></span>
              <button type="button" className="btn small" onClick={() => setView({ kind: 'manage', id: c.id })}>{t('Gestionar')}</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
