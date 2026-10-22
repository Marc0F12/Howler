import { t, tm } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import type { WeatherStateDto } from '@howler/shared';
import { adminApi } from './adminApi';
import { Card, Notice, useNotice } from './ui';

/**
 * Elige el sistema de clima (el de AC por defecto, Sol, Pure…, los que haya instalados) y qué climas entran en la
 * lista del servidor. La lista se guarda en el preset y el servidor la lee al arrancar, así que hace falta reiniciar.
 * Con el clima de CSP (WeatherFX) no hace falta: allí los tipos son libres y se cambian en directo.
 */
export function WeatherListEditor({ running }: { running: boolean }) {
  const { notice, run } = useNotice();
  const [wx, setWx] = useState<WeatherStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState('default');
  /** Selección por sistema, para no perderla al cambiar de pestaña. */
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const load = () =>
    adminApi.weather().then((w) => {
      setWx(w);
      setError(null);
      const first = w.list[0]?.system ?? w.systems[0]?.id ?? 'default';
      setSystem(first);
      const bySystem: Record<string, string[]> = {};
      for (const e of w.list) (bySystem[e.system] ??= []).push(e.graphics);
      setPicked(bySystem);
    }, (e: Error) => setError(tm(e.message)));
  useEffect(() => { void load(); }, []);

  const current = useMemo(() => wx?.systems.find((s) => s.id === system), [wx, system]);
  const chosen = picked[system] ?? [];
  const saved = useMemo(() => (wx?.list.every((e) => e.system === system) ? wx.list.map((e) => e.graphics) : []), [wx, system]);
  const dirty = JSON.stringify([...chosen].sort()) !== JSON.stringify([...saved].sort()) || (wx?.list.some((e) => e.system !== system) ?? false);

  if (error) return <p className="warn">{t('No se pudo leer la configuración de climas:')} {error}</p>;
  if (!wx) return <p className="empty">{t('Cargando…')}</p>;
  // Con el clima de CSP (Pure, Sol…) los tipos se eligen en directo y no hay lista que editar: no se enseña.
  if (wx.fx) return null;
  if (wx.systems.length === 0) {
    return <Card title={t('Climas disponibles')}><p className="warn">{t('No encuentro la carpeta content/weather de tu instalación de Assetto Corsa, así que no puedo listar los climas instalados.')}</p></Card>;
  }

  const toggle = (g: string) => setPicked({ ...picked, [system]: chosen.includes(g) ? chosen.filter((x) => x !== g) : [...chosen, g] });
  const save = (applyAndRestart: boolean) =>
    run(async () => {
      const r = await adminApi.saveWeatherList(chosen, applyAndRestart);
      await load();
      return { ok: true, reply: r.restarting ? t('Reiniciando el servidor para aplicarlo…') : running ? t('Se aplicará cuando reinicies el servidor.') : t('Se aplicará al arrancar el servidor.') };
    }, t('Lista de climas guardada ({n})', { n: chosen.length }));

  return (
    <Card title={t('Climas disponibles')}>
      <p className="hint">
        {t('Elige el sistema de clima y los climas que quieres tener en la lista. En la pestaña En directo podrás saltar entre ellos al instante. El servidor lee la lista al arrancar, así que para aplicar los cambios hay que reiniciarlo.')}
      </p>

      <div className="segmented" role="radiogroup" aria-label={t('Sistema de clima')}>
        {wx.systems.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={system === s.id} className={system === s.id ? 'on' : ''} onClick={() => setSystem(s.id)}>
            {tm(s.label)}
          </button>
        ))}
      </div>
      {wx.list.some((e) => e.system !== system) && (
        <p className="hint">{t('La lista actual del servidor usa otro sistema; al guardar se sustituirá por los climas de {system}.', { system: tm(current?.label ?? '') })}</p>
      )}

      <ul className="weather-grid">
        {current?.weathers.map((w) => (
          <li key={w.graphics}>
            <label>
              <input type="checkbox" checked={chosen.includes(w.graphics)} onChange={() => toggle(w.graphics)} />
              <span>{w.name}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="actions">
        <button type="button" className="btn" disabled={!dirty || chosen.length === 0} onClick={() => save(false)}>{t('Guardar')}</button>
        <button type="button" className="btn primary" disabled={!dirty || chosen.length === 0 || !running} onClick={() => save(true)}>{t('Guardar y reiniciar el servidor')}</button>
        <span className="muted">{chosen.length === 1 ? t('1 clima en la lista') : t('{n} climas en la lista', { n: chosen.length })}</span>
      </div>
      {chosen.length === 0 && <p className="hint">{t('Marca al menos un clima.')}</p>}
      <Notice notice={notice} />
    </Card>
  );
}
