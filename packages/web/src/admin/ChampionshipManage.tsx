import { formatDay, timeOf } from '../format';
import { t } from '../i18n';
import { useState } from 'react';
import type { ChampionshipDto, ChampionshipStatus } from '@howler/shared';
import { adminApi } from './adminApi';
import { useLive } from '../api';
import { useContentNames } from '../content';
import { clock } from '../format';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const STATUS_LABEL: Record<ChampionshipStatus, string> = { draft: t('Borrador'), active: t('Activo'), finished: t('Terminado') };
const fmtDate = (iso: string | null) => (iso ? `${formatDay(new Date(iso), { month: 'short', year: true })} ${timeOf(new Date(iso))}` : '—');

/** Gestión de un campeonato ya creado: estado, sesiones asignadas a cada carrera, sesiones por confirmar y ajustes de puntos. */
export function ChampionshipManage({ id, onEdit, onDeleted }: { id: number; onEdit: (c: ChampionshipDto) => void; onDeleted: () => void }) {
  const { trackName } = useContentNames();
  const { data: c, refresh } = useLive(() => adminApi.championship(id), [id], (e) => e.type === 'lap' || e.type === 'results' || e.type === 'session');
  const { data: cands, refresh: refreshCands } = useLive(() => adminApi.championshipCandidates(id), [id], (e) => e.type === 'lap' || e.type === 'session');
  const { notice, run } = useNotice();
  const [adj, setAdj] = useState({ roundId: 0, driverId: 0, points: '', reason: '' });
  const [pick, setPick] = useState<Record<number, number>>({});

  if (!c) return <p className="empty">{t('Cargando…')}</p>;
  const reload = () => { refresh(); refreshCands(); };
  const act = (fn: () => Promise<unknown>, ok: string) => run(async () => { await fn(); reload(); return { ok: true }; }, ok);
  const roundOf = (n: number | null) => c.roundList.find((r) => r.number === n);
  const name = (driverId: number) => c.entries.find((e) => e.driverId === driverId)?.name ?? `#${driverId}`;

  return (
    <>
      <Card title={c.name} aside={<span className={`badge ${c.status === 'active' ? 'ok' : ''}`}>{STATUS_LABEL[c.status]}</span>}>
        <div className="row">
          {(['draft', 'active', 'finished'] as ChampionshipStatus[]).filter((s) => s !== c.status).map((s) => (
            <button key={s} type="button" className="btn small" onClick={() => act(() => adminApi.setChampionshipStatus(id, s), t('Ahora está en «{status}»', { status: STATUS_LABEL[s] }))}>{t('Pasar a {status}', { status: STATUS_LABEL[s].toLowerCase() })}</button>
          ))}
          {c.sharedFrom ? <span className="muted">{t('Copia de {name}: solo lectura', { name: c.sharedFrom })}</span> : <button type="button" className="btn small" onClick={() => onEdit(c)}>{t('Editar')}</button>}
          {c.status !== 'draft' && <a className="btn small" href={`#/championship/${c.id}`}>{t('Ver en la web')}</a>}
          <ConfirmButton danger label={t('Borrar')} confirmLabel={t('¿Borrar todo?')} onConfirm={async () => { await adminApi.deleteChampionship(id); onDeleted(); }} />
        </div>
        <p className="hint">{c.status === 'draft' ? t('Es un borrador: no se asigna ninguna sesión ni se ve en la web hasta que lo actives.') : t('Con el campeonato activo, Howler asigna solo la sesión que encaje con la siguiente carrera (mismo circuito, al menos 2 inscritos). Lo demás sale abajo para confirmar.')}</p>
        <Notice notice={notice} />
      </Card>

      <Card title={t('Carreras y sesiones asignadas')}>
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>#</th><th>{t('Circuito')}</th><th>{t('Fecha')}</th><th>{t('Clasificación')}</th><th>{t('Carrera')}</th><th /></tr></thead>
            <tbody>
              {c.roundList.map((r) => (
                <tr key={r.id}>
                  <td>{r.number}</td><td>{trackName(r.track, r.layout)}</td><td className="muted">{fmtDate(r.raceAt)}</td>
                  <td>{r.qualiSessionId != null ? <>#{r.qualiSessionId} <button type="button" className="btn small" onClick={() => act(() => adminApi.assignSession(id, r.id, 'quali', null), t('Clasificación desasignada'))}>{t('Quitar')}</button></> : <span className="muted">—</span>}</td>
                  <td>{r.raceSessionId != null ? <>#{r.raceSessionId} <span className="badge ok">{t('{n} pilotos', { n: r.results.length })}</span> <button type="button" className="btn small" onClick={() => act(() => adminApi.assignSession(id, r.id, 'race', null), t('Carrera desasignada'))}>{t('Quitar')}</button></> : <span className="muted">{t('sin jugar')}</span>}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('Sesiones por confirmar')} aside={<span className="muted">{cands ? cands.length : '…'}</span>}>
        <p className="hint">{t('Carreras y clasificaciones con participantes del campeonato que aún no están en ninguna carrera. Elige a cuál pertenecen.')}</p>
        {cands && cands.length === 0 ? <p className="empty">{t('No hay sesiones pendientes.')}</p> : (
          <ul className="pick-list">
            {(cands ?? []).map((s) => (
              <li key={s.sessionId}>
                <span>#{s.sessionId} · {s.type === 3 ? t('Carrera') : t('Clasificación')} · {trackName(s.track, s.layout)} <span className="muted">· {t('{n} inscritos', { n: s.enrolledDrivers })} · {clock(s.startedAt)}</span></span>
                <span className="row">
                  <select aria-label={t('Carrera para la sesión {id}', { id: s.sessionId })} value={pick[s.sessionId] ?? roundOf(s.suggestedRound)?.id ?? ''} onChange={(e) => setPick({ ...pick, [s.sessionId]: Number(e.target.value) })}>
                    <option value="">{t('Elegir carrera…')}</option>
                    {c.roundList.map((r) => <option key={r.id} value={r.id}>{t('Carrera {n}', { n: r.number })} · {trackName(r.track, r.layout)}</option>)}
                  </select>
                  <button type="button" className="btn small" disabled={!(pick[s.sessionId] ?? roundOf(s.suggestedRound)?.id)}
                    onClick={() => act(() => adminApi.assignSession(id, (pick[s.sessionId] ?? roundOf(s.suggestedRound)!.id), s.type === 3 ? 'race' : 'quali', s.sessionId), t('Sesión asignada'))}>{t('Asignar')}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('Puntos a mano (extras y penalizaciones)')}>
        <p className="hint">{t('Suma o resta puntos a un piloto en una carrera ya jugada, con su motivo. Un número negativo es una penalización. Solo cuenta en campeonatos por puntos.')}</p>
        <div className="row">
          <select aria-label={t('Carrera')} value={adj.roundId} onChange={(e) => setAdj({ ...adj, roundId: Number(e.target.value) })}><option value={0}>{t('Carrera…')}</option>{c.roundList.filter((r) => r.played).map((r) => <option key={r.id} value={r.id}>{t('Carrera {n}', { n: r.number })}</option>)}</select>
          <select aria-label={t('Piloto')} value={adj.driverId} onChange={(e) => setAdj({ ...adj, driverId: Number(e.target.value) })}><option value={0}>{t('Piloto…')}</option>{c.entries.map((e) => <option key={e.driverId} value={e.driverId}>{e.name}</option>)}</select>
          <input type="number" aria-label={t('Puntos')} placeholder={t('+/− puntos')} value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} />
          <input type="text" className="wide" aria-label={t('Motivo')} placeholder={t('Motivo (p. ej. choque en la salida)')} maxLength={200} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
          <button type="button" className="btn" disabled={!adj.roundId || !adj.driverId || !adj.points || Number.isNaN(Number(adj.points))}
            onClick={() => act(async () => { await adminApi.addAdjustment(id, { roundId: adj.roundId, driverId: adj.driverId, points: Number(adj.points), reason: adj.reason }); setAdj({ ...adj, points: '', reason: '' }); }, t('Ajuste anotado'))}>{t('Anotar')}</button>
        </div>
        <ul className="pick-list">
          {c.adjustments.map((a) => (
            <li key={a.id}><span>{t('Carrera {n}', { n: a.round + 1 })} · {name(a.driverId)} · <strong>{a.points > 0 ? '+' : ''}{a.points}</strong> <span className="muted">{a.reason}</span></span>
              <button type="button" className="btn small" onClick={() => act(() => adminApi.removeAdjustment(id, a.id), t('Ajuste quitado'))}>{t('Quitar')}</button></li>
          ))}
          {c.adjustments.length === 0 && <li className="muted">{t('Sin ajustes.')}</li>}
        </ul>
      </Card>
    </>
  );
}
