import { useEffect, useState } from 'react';
import type { CarChecksumsStateDto } from '@howler/shared';
import { useContentNames } from '../content';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { Card, Notice, useNotice } from './ui';

/**
 * Coches que exigen a los jugadores tener el mismo `data.acd`. Con un mod que no se puede repartir, quien no tiene ese
 * archivo no puede entrar. Aquí se deja de exigir por coche (el archivo del servidor se renombra, no se borra).
 */
export function CarChecksumsCard({ running }: { running: boolean }) {
  const { carName } = useContentNames();
  const { notice, run } = useNotice();
  const [st, setSt] = useState<CarChecksumsStateDto | null>(null);
  const load = () => adminApi.carChecksums().then(setSt, () => setSt(null));
  useEffect(() => { void load(); }, []);
  if (!st || st.cars.length === 0) return null;

  const change = (model: string, skip: boolean, restart = false) => run(async () => {
    const r = await adminApi.setCarChecksums([model], skip, restart);
    await load();
    if (r.refused.length > 0) throw new Error(tm(r.refused[0]!.reason));
  }, restart ? t('Guardado. Reiniciando el servidor…') : t('Guardado. Se aplicará al arrancar el servidor.'));

  const allow = (on: boolean) => run(async () => { await adminApi.allowMissingChecksums(on); await load(); return { ok: true }; }, t('Guardado. Se aplicará al arrancar el servidor.'));

  return (
    <Card title={t('Archivos de los coches (data.acd)')}>
      <p className="hint">{t('El servidor comprueba que cada jugador tenga EXACTAMENTE el mismo archivo data.acd que él. Con un mod que no se puede repartir eso impide entrar. «No se exige» significa que el servidor no pide ese archivo para ese coche: los jugadores solo necesitan tener el coche. Es menos seguro contra trampas. Hace falta reiniciar el servidor.')}</p>
      <p className="check-flag">
        {st.flag
          ? <><span className="pill ok">{t('Activada')}</span> {t('La opción «permitir coches sin data.acd» del servidor.')} <button type="button" className="btn small" onClick={() => void allow(false)}>{t('Desactivarla')}</button></>
          : <><span className="pill warn">{t('Desactivada')}</span> {t('La opción «permitir coches sin data.acd» del servidor: un coche sin ese archivo impediría arrancar.')} <button type="button" className="btn small primary" onClick={() => void allow(true)}>{t('Activarla')}</button></>}
      </p>
      <ul className="car-checks">
        {st.cars.map((c) => {
          const free = !c.required; // sin data.acd activo en el servidor: nada que comprobar si la opción está activada
          return (
            <li key={c.model}>
              <span><b>{carName(c.model)}</b> <span className="muted">{c.model}</span></span>
              {c.linked && c.required ? <span className="muted">{t('Carpeta enlazada a otra: no se toca')}</span>
                : c.required ? <><span className="pill">{t('Se exige')}</span><button type="button" className="btn small" onClick={() => void change(c.model, true, running)}>{running ? t('No exigirlo y reiniciar') : t('No exigirlo')}</button></>
                : <>
                  <span className={`pill ${st.flag ? 'ok' : 'warn'}`}>{st.flag ? t('No se exige') : t('Daría error al arrancar')}</span>
                  <span className="muted">{c.skipped ? t('Howler le quitó el data.acd en el servidor (se puede deshacer).')
                    : c.missing ? t('No está en la carpeta de contenido del servidor (solo en tu juego): no hay archivo que comprobar.')
                    : c.unpacked ? t('Tiene la carpeta data sin empaquetar y no hay data.acd.') : t('No hay data.acd en la carpeta del coche del servidor.')}</span>
                  {c.skipped && <button type="button" className="btn small" onClick={() => void change(c.model, false)}>{t('Volver a exigirlo')}</button>}
                  {free && !st.flag && !c.skipped && <button type="button" className="btn small primary" onClick={() => void allow(true)}>{t('Permitirlo')}</button>}
                </>}
            </li>
          );
        })}
      </ul>
      <Notice notice={notice} />
    </Card>
  );
}
