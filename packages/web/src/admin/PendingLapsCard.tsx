import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { formatLapTime } from '@howler/shared';
import { useLive } from '../api';
import { useContentNames } from '../content';
import { clock } from '../format';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

/** Salidas de boxes y otras vueltas a la espera de que el administrador decida: no cuentan en nada hasta aprobarlas. */
export function PendingLapsCard() {
  const { carName, trackName } = useContentNames();
  const { notice, run } = useNotice();
  const { data, error, refresh } = useLive(() => adminApi.laps(100, true), [], (e) => e.type === 'lap' || e.type === 'results');

  const act = (id: number, action: 'void' | 'valid', done: string) =>
    run(async () => { await adminApi.lapAction(id, action); refresh(); return { ok: true }; }, done);

  const [autoVoid, setAutoVoid] = useState<boolean | null>(null);
  useEffect(() => { adminApi.lapRules().then((s) => setAutoVoid(s.config.autoVoidOutLaps === true), () => setAutoVoid(null)); }, []);
  // Se lee la configuración en vigor justo antes de guardar para no pisar otros cambios hechos en «Reglas de vuelta».
  const toggleAuto = (on: boolean) =>
    run(async () => {
      const s = await adminApi.lapRules();
      await adminApi.saveLapRules({ ...s.config, autoVoidOutLaps: on });
      setAutoVoid(on);
      return { ok: true };
    }, on ? t('Las salidas de boxes se anularán solas') : t('Las salidas de boxes quedarán pendientes de revisión'));

  return (
    <Card title={t('Pendientes de revisión')} aside={<span className="muted">{data ? data.length : '…'}</span>}>
      <p className="hint">
        {t('Las salidas de boxes no cuentan en tiempos, récords ni medias hasta que las apruebes. «Aprobar» las hace válidas (pueden ser récord); «Anular» las deja fuera para siempre.')}
      </p>
      <label className="inline">
        <input type="checkbox" checked={autoVoid ?? false} disabled={autoVoid === null} onChange={(e) => toggleAuto(e.target.checked)} /> {t('Anular automáticamente las salidas de boxes')}
      </label>
      <p className="hint">{t('Afecta solo a las salidas nuevas; las que ya están pendientes se quedan como están. La detección a veces se equivoca (por ejemplo, tras reiniciar Howler): las anuladas se recuperan con «Dar por buena» en «Vueltas recientes».')}</p>
      <Notice notice={notice} />
      {error && !data ? <p className="warn">{t('No se pudieron cargar las vueltas.')}</p> : !data ? <p className="empty">{t('Cargando…')}</p> : data.length === 0 ? <p className="empty">{t('No hay vueltas pendientes.')}</p> : (
        <div className="table-scroll">
          <table className="timing">
            <thead><tr><th>{t('Hora')}</th><th>{t('Piloto')}</th><th>{t('Circuito')}</th><th>{t('Coche')}</th><th className="num">{t('Tiempo')}</th><th /></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{clock(l.at)}</td>
                  <td className="driver">{l.driverName}</td>
                  <td>{trackName(l.track, l.layout)}</td>
                  <td className="muted">{carName(l.car)}</td>
                  <td className="num lap">{formatLapTime(l.lapMs)}</td>
                  <td className="row-actions">
                    <button type="button" className="btn small" onClick={() => act(l.id, 'valid', t('Vuelta aprobada'))}>{t('Aprobar')}</button>
                    <ConfirmButton danger label={t('Anular')} confirmLabel={t('¿Anular?')} onConfirm={() => act(l.id, 'void', t('Vuelta anulada'))} />
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
