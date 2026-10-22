import { useCallback, useEffect, useState } from 'react';
import type { CarChecksumsStateDto } from '@howler/shared';
import { t } from '../i18n';
import { adminApi } from './adminApi';
import { ConfirmButton, Notice, useNotice } from './ui';

/** Coches de la lista del servidor que no tienen `data.acd` mientras la opción que lo permite está apagada: el servidor no arrancaría. */
export function useCarChecksumProblems(stopped: boolean) {
  const [state, setState] = useState<CarChecksumsStateDto | null>(null);
  const reload = useCallback(() => { void adminApi.carChecksums().then(setState, () => setState(null)); }, []);
  useEffect(() => { if (stopped) reload(); }, [stopped, reload]);
  const problems = state && !state.flag ? state.cars.filter((c) => !c.required && !c.missing && !c.skipped).map((c) => c.model) : [];
  return { problems, reload };
}

/**
 * Aviso guiado cuando el servidor no puede arrancar (o se acaba de caer) por coches sin `data.acd`:
 * permitirlos con un clic, quitarlos de la lista o empaquetarlos con Content Manager.
 */
export function CarChecksumAlert({ problems, crashHint, onChanged, onStartAnyway }: {
  problems: string[]; crashHint: boolean; onChanged: () => void; onStartAnyway: () => void;
}) {
  const { notice, run } = useNotice();
  const [guide, setGuide] = useState(false);
  if (problems.length === 0 && !crashHint) return null;

  const removeCar = (model: string) => run(async () => {
    const list = await adminApi.entryList();
    await adminApi.saveEntryList(list.slots.filter((s) => s.model !== model));
    onChanged();
    return { ok: true };
  }, t('Coche quitado de la lista. Ya puedes arrancar.'));

  return (
    <div className="warn car-alert" role="alert">
      <b>
        {problems.length === 0
          ? t('La última vez el servidor se cayó y la consola habla de «data.acd» o sumas de control.')
          : problems.length === 1
            ? t('El servidor no arrancaría: el coche «{car}» no tiene data.acd.', { car: problems[0]! })
            : t('El servidor no arrancaría: {n} coches no tienen data.acd ({cars}).', { n: problems.length, cars: problems.join(', ') })}
      </b>
      <p className="hint">{t('El servidor guarda una suma de control de cada coche a partir de su archivo data.acd. Si un coche no lo tiene (por ejemplo, viene con la carpeta «data» sin empaquetar), se niega a arrancar, salvo que le digas que lo permita.')}</p>
      <div className="actions">
        {problems.length > 0 && (
          <button type="button" className="btn primary" onClick={() => run(async () => { await adminApi.allowMissingChecksums(true); onChanged(); return { ok: true }; }, t('Hecho: el servidor ya aceptará coches sin data.acd. Ya puedes arrancar.'))}>
            {t('Permitir coches sin data.acd (recomendado)')}
          </button>
        )}
        {problems.map((m) => (
          <ConfirmButton key={m} label={t('Quitar «{car}» de la lista', { car: m })} confirmLabel={t('Confirmar: quitar todas sus plazas')} danger onConfirm={() => removeCar(m)} />
        ))}
        <button type="button" className="btn" onClick={() => setGuide((g) => !g)} aria-expanded={guide}>{t('Cómo empaquetarlo con Content Manager')}</button>
        {problems.length > 0 && <button type="button" className="btn" onClick={onStartAnyway}>{t('Arrancar de todas formas')}</button>}
      </div>
      {guide && (
        <ol className="steps">
          <li>{t('Abre Content Manager y entra en Contenido → Coches.')}</li>
          <li>{t('Elige el coche y busca la opción para empaquetar sus datos («Pack data» o similar; el nombre del botón puede variar según tu versión).')}</li>
          <li>{t('Copia el data.acd resultante a la carpeta del coche del servidor (content\\cars\\<coche>) y arranca de nuevo.')}</li>
        </ol>
      )}
      <Notice notice={notice} />
    </div>
  );
}
