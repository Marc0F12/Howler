import { useEffect, useMemo, useState } from 'react';
import type { CarTyresDto } from '@howler/shared';
import { t } from '../i18n';
import { adminApi } from './adminApi';
import { carsWithoutTyre, formatLegal, parseLegal, toggleLegal, tyreOptions, unknownLegal } from './tyre-pick';

/**
 * Selector de «Compuestos permitidos»: casillas con los compuestos reales de los coches de la lista del servidor
 * (se leen de su `tyres.ini`, también dentro de `data.acd`). Si no se pueden leer, se escribe a mano como antes.
 */
export function TyrePicker({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [data, setData] = useState<CarTyresDto | null | undefined>(undefined);
  useEffect(() => { adminApi.carTyres().then(setData, () => setData(null)); }, []);
  const options = useMemo(() => (data ? tyreOptions(data) : []), [data]);
  const legal = parseLegal(value);
  const text = <input id={id} type="text" value={value} disabled={disabled} maxLength={200} onChange={(e) => onChange(e.target.value)} />;
  if (data === undefined) return <span className="sp-unit">{t('Leyendo los neumáticos de los coches…')}</span>;
  if (!data || !options.length) return text;
  const missing = carsWithoutTyre(data, legal);
  const unknown = unknownLegal(data, legal);
  return (
    <div className="sp-tyres" id={id} role="group" aria-label={t('Compuestos permitidos')}>
      <div className="sp-tyre-chips">
        {options.map((o) => {
          const on = legal.includes(o.short);
          return (
            <button key={o.short} type="button" role="checkbox" aria-checked={on} disabled={disabled} className={`sp-tyre${on ? ' on' : ''}`}
              title={`${o.names.join(' / ')} · ${o.cars.join(', ')}`} onClick={() => onChange(formatLegal(toggleLegal(legal, o.short, options)))}>
              <strong>{o.short}</strong>
              <span>{o.names[0]}</span>
              <small>{o.cars.length === data.cars.length ? t('Todos los coches') : t('{n} de {m} coches', { n: o.cars.length, m: data.cars.length })}</small>
            </button>
          );
        })}
      </div>
      <p className="sp-tyre-note">
        {legal.length === 0 ? t('Ninguno marcado: cada coche puede usar todos sus compuestos.') : t('Solo se podrán usar los marcados.')}
        {legal.length > 0 && <> <button type="button" className="sp-link" disabled={disabled} onClick={() => onChange('')}>{t('Permitir todos')}</button></>}
      </p>
      {missing.length > 0 && <p className="sp-tyre-warn" role="status">{t('Sin ningún compuesto permitido para: {cars}. No podrían usar neumáticos.', { cars: missing.join(', ') })}</p>}
      {unknown.length > 0 && <p className="sp-tyre-warn" role="status">{t('No existen en estos coches: {list}.', { list: unknown.join(', ') })} <button type="button" className="sp-link" disabled={disabled} onClick={() => onChange(formatLegal(legal.filter((s) => !unknown.includes(s))))}>{t('Quitar')}</button></p>}
    </div>
  );
}
