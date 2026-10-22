import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { compareHref, pickKey } from './links';

const MAX_PICKS = 3;

/** Selección de vueltas para comparar (hasta 3): cada una es la mejor de un piloto con un coche en un circuito. */
export function useComparePicks(track: string, layout: string) {
  const [picked, setPicked] = useState<string[]>([]);
  // Las vueltas elegidas son de un circuito concreto: al cambiar de circuito o layout se vacía la selección.
  useEffect(() => { setPicked([]); }, [track, layout]);
  return {
    picked,
    has: (driverId: number, car: string) => picked.includes(pickKey(driverId, car)),
    full: picked.length >= MAX_PICKS,
    toggle: (driverId: number, car: string) => {
      const k = pickKey(driverId, car);
      setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX_PICKS ? p : [...p, k]));
    },
    clear: () => setPicked([]),
    href: compareHref(track, layout, picked),
  };
}

export type ComparePicks = ReturnType<typeof useComparePicks>;

/** Casilla de una fila de tabla: marca esa vuelta para compararla. */
export function PickBox({ picks, driverId, car, name }: { picks: ComparePicks; driverId: number; car: string; name: string }) {
  const on = picks.has(driverId, car);
  return (
    <input
      type="checkbox"
      className="compare-check"
      checked={on}
      disabled={!on && picks.full}
      onChange={() => picks.toggle(driverId, car)}
      aria-label={t('Comparar la mejor vuelta de {name}', { name })}
      title={!on && picks.full ? t('Ya hay 3 elegidas: quita una para añadir otra') : t('Elige 2 o 3 vueltas para compararlas')}
    />
  );
}

/** Barra que aparece al elegir vueltas: lleva al comparador cuando hay al menos 2. */
export function CompareBar({ picks }: { picks: ComparePicks }) {
  const n = picks.picked.length;
  if (n === 0) {
    return (
      <div className="compare-bar idle">
        <button type="button" className="btn primary" disabled>{t('Comparar vueltas')}</button>
        <span className="muted">{t('Marca 2 o 3 pilotos de la tabla con la casilla de la izquierda para comparar sus mejores vueltas.')}</span>
      </div>
    );
  }
  return (
    <div className="compare-bar" role="status">
      <span>{n === 1 ? t('1 vuelta elegida') : t('{n} vueltas elegidas', { n })}{n < 2 ? `: ${t('elige otra más')}` : ''}</span>
      {n >= 2 ? <a className="btn primary" href={picks.href}>{t('Comparar vueltas')}</a> : <button type="button" className="btn primary" disabled>{t('Comparar vueltas')}</button>}
      <button type="button" className="btn-link" onClick={picks.clear}>{t('Quitar selección')}</button>
    </div>
  );
}
