import { t, tm } from '../i18n';
import { useState } from 'react';
import { formatLapTime } from '@howler/shared';
import { useLive } from '../api';
import { useContentNames } from '../content';
import { clock } from '../format';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

/** Últimas vueltas, para anular una que no debía contar o dar por buena una que se anuló sin razón. */
export function RecentLapsCard() {
  const { carName, trackName } = useContentNames();
  const { notice, run } = useNotice();
  const [note, setNote] = useState('');
  const { data, error, refresh } = useLive(() => adminApi.laps(30), [], (e) => e.type === 'lap' || e.type === 'results');

  const act = (id: number, action: 'void' | 'valid' | 'reset', done: string) =>
    run(async () => { await adminApi.lapAction(id, action, note.trim() || undefined); refresh(); return { ok: true }; }, done);

  return (
    <Card title={t('Vueltas recientes')} aside={<span className="muted">{t('Decisiones a mano')}</span>}>
      <p className="hint">
        {t('Anular una vuelta la saca de tiempos, récords y fantasmas; darla por buena la mete aunque las reglas la anulen. Estas decisiones mandan sobre las reglas y el recálculo no las toca; «Volver a las reglas» las quita. El motivo (opcional) queda guardado.')}
      </p>
      <label className="field-inline">{t('Motivo')} <input type="text" maxLength={200} placeholder={t('Opcional: p. ej. atajo en la chicane')} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Notice notice={notice} />
      {error && !data ? <p className="warn">{t('No se pudieron cargar las vueltas.')}</p> : !data ? <p className="empty">{t('Cargando…')}</p> : data.length === 0 ? <p className="empty">{t('Todavía no hay vueltas.')}</p> : (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Hora')}</th><th>{t('Piloto')}</th><th>{t('Circuito')}</th><th>{t('Coche')}</th><th className="num">{t('Tiempo')}</th><th>{t('Estado')}</th><th /></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{clock(l.at)}</td>
                  <td className="driver">{l.driverName}</td>
                  <td>{trackName(l.track, l.layout)}</td>
                  <td className="muted">{carName(l.car)}</td>
                  <td className={`num ${l.valid ? 'lap' : 'void'}`}>{formatLapTime(l.lapMs)}</td>
                  <td>
                    {l.valid ? <span className="badge ok">{t('Válida')}</span> : l.pending ? <span className="badge pending" title={l.reason ? tm(l.reason) : undefined}>{t('Pendiente')}</span> : <span className="badge bad" title={l.reason ? tm(l.reason) : undefined}>{l.reason ? tm(l.reason) : t('Anulada')}</span>}
                    {l.outLap && <span className="badge" title={t('No empezó en la línea de meta (salida de boxes o reinicio)')}> {t('salida de boxes')}</span>}
                    {l.override && <span className="badge" title={t('Decisión manual del administrador')}> {t('manual')}</span>}
                  </td>
                  <td className="row-actions">
                    {l.pending
                      ? <button type="button" className="btn small" onClick={() => act(l.id, 'valid', t('Vuelta aprobada'))}>{t('Aprobar')}</button>
                      : l.override
                      ? <button type="button" className="btn small" onClick={() => act(l.id, 'reset', t('Vuelta devuelta a las reglas'))}>{t('Volver a las reglas')}</button>
                      : l.valid
                        ? <ConfirmButton danger label={t('Anular')} confirmLabel={t('¿Anular?')} onConfirm={() => act(l.id, 'void', t('Vuelta anulada'))} />
                        : <button type="button" className="btn small" onClick={() => act(l.id, 'valid', t('Vuelta dada por buena'))}>{t('Dar por buena')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
