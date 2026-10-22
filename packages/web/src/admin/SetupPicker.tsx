import { useState } from 'react';
import { t, tm } from '../i18n';
import { adminApi, type SetupsDto } from './adminApi';

/**
 * Elegir el setup fijo de una plaza: los archivos que ya hay en la carpeta `setups/` del servidor (los de ese coche
 * primero) y, desplegable, los que el jugador tiene guardados en Assetto Corsa, que se copian al servidor con un clic.
 */
export function SetupPicker({ model, value, setups, onChange, onImported }: {
  model: string; value: string; setups: SetupsDto | null; onChange: (v: string) => void; onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = (setups?.server ?? []).filter((s) => s.car === model || s.car === null);
  const others = (setups?.server ?? []).filter((s) => s.car !== null && s.car !== model);
  const known = (setups?.server ?? []).some((s) => s.file === value);
  const current = (setups?.server ?? []).find((s) => s.file === value);
  const mine = (setups?.user ?? []).filter((s) => s.car === model);

  const use = async (s: { car: string; track: string; file: string }) => {
    setBusy(true); setError(null);
    try { const r = await adminApi.importSetup(s); onImported(); onChange(r.name); } catch (e) { setError(tm((e as Error).message)); } finally { setBusy(false); }
  };

  return (
    <div className="mini sp-setup">
      <span>{t('Setup fijo')}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('Ninguno (cada jugador lleva el suyo)')}</option>
        {value !== '' && !known && <option value={value}>{value} ({t('no está en la carpeta del servidor')})</option>}
        {own.map((s) => <option key={s.file} value={s.file}>{s.file}</option>)}
        {others.length > 0 && <optgroup label={t('De otros coches')}>{others.map((s) => <option key={s.file} value={s.file}>{s.file}</option>)}</optgroup>}
      </select>
      {current?.car && current.car !== model && <span className="warn-text">{t('Este setup es de otro coche: «{car}».', { car: current.car })}</span>}
      {value !== '' && !known && setups && <span className="warn-text">{t('El servidor no arrancará si falta este archivo en la carpeta «setups».')}</span>}
      <details>
        <summary>{t('Traer uno de mis setups de Assetto Corsa')}</summary>
        {mine.length === 0
          ? <p className="hint">{t('No hay setups guardados para este coche en Documentos > Assetto Corsa > setups. Guárdalos desde el juego (pantalla de setup → guardar).')}</p>
          : <ul className="sp-setups">{mine.map((s) => (
              <li key={`${s.track}/${s.file}`}>
                <span>{s.file} <span className="muted">· {s.track}</span></span>
                <button type="button" className="btn small" disabled={busy} onClick={() => use(s)}>{t('Copiar al servidor y usar')}</button>
              </li>
            ))}</ul>}
        {error && <p className="warn-text">{error}</p>}
      </details>
    </div>
  );
}
