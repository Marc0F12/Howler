import { useEffect, useState } from 'react';
import type { SmartKey, SmartMode, SmartSettingDto } from '@howler/shared';
import { t, tm } from '../i18n';
import { adminApi } from './adminApi';
import { Card, Notice, useNotice } from './ui';

/** Nombre y explicación de cada ajuste (se muestran en el idioma de la interfaz). */
const INFO: Record<SmartKey, { label: () => string; hint: () => string }> = {
  weatherFx: {
    label: () => t('Clima de CSP (WeatherFX)'),
    hint: () => t('Encendido: el servidor manda tipos de clima y cada jugador los ve con su Pure o Sol. Apagado: clima clásico con la lista del preset.'),
  },
  trackParams: {
    label: () => t('Datos del circuito'),
    hint: () => t('Permite arrancar con un circuito (mod) que no tiene su zona horaria en data_track_params.ini. Apagado, el servidor no arranca con un circuito así.'),
  },
  carChecksums: {
    label: () => t('Coches sin data.acd'),
    hint: () => t('Permite coches sin data.acd en el servidor (mods que no se pueden repartir). Apagado, el servidor exige a los jugadores el mismo archivo.'),
  },
};

const MODES: [SmartMode, () => string][] = [['on', () => t('Encendido')], ['off', () => t('Apagado')], ['auto', () => t('Auto')]];

/** Ajustes rápidos del servidor que dependen del circuito, de los coches o del clima: cada uno Encendido, Apagado o Auto. */
export function SmartSettingsCard({ running, onChanged }: { running: boolean; onChanged?: () => void }) {
  const { notice, run } = useNotice();
  const [list, setList] = useState<SmartSettingDto[] | null>(null);
  const [pending, setPending] = useState(false);
  const load = () => adminApi.smartSettings().then((r) => setList(r.settings), () => setList(null));
  useEffect(() => { void load(); }, []);
  if (!list) return null;

  const choose = (key: SmartKey, mode: SmartMode) => run(async () => {
    const r = await adminApi.setSmartSetting(key, mode);
    setList(r.settings);
    if (r.changed.length) { setPending(true); onChanged?.(); }
    return { ok: true };
  }, running ? t('Guardado. Se aplicará la próxima vez que reinicies el servidor.') : t('Guardado. Se aplicará al arrancar el servidor.'));

  const restart = () => run(async () => {
    await adminApi.restart();
    setPending(false);
    return { ok: true };
  }, t('Reiniciando el servidor para aplicarlo…'));

  return (
    <Card title={t('Ajustes rápidos del servidor')}>
      <p className="hint">{t('Con «Auto», Howler decide cada vez que arranca el servidor según el circuito, los coches y el clima instalados. Si nunca eliges, no se toca lo que ya tienes.')}</p>
      {list.map((s) => {
        const info = INFO[s.key];
        return (
          <div className="field" key={s.key}>
            <span className="field-label">{info.label()}</span>
            <span className="field-control">
              <span className="segmented" role="radiogroup" aria-label={info.label()}>
                {MODES.map(([m, label]) => {
                  const on = s.mode === m || (s.mode === null && ((m === 'on') === s.current) && m !== 'auto');
                  return <button key={m} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => void choose(s.key, m)}>{label()}</button>;
                })}
              </span>
            </span>
            <span className="field-hint">
              {info.hint()}
              <br />
              <span className="muted">{tm(s.reason)}{s.detail ? ` (${s.detail})` : ''}{s.mode === 'auto' ? ` — ${s.effective ? t('se aplicará: encendido') : t('se aplicará: apagado')}` : ''}</span>
            </span>
          </div>
        );
      })}
      {pending && running && (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => void restart()}>{t('Reiniciar el servidor para aplicarlo')}</button>
        </div>
      )}
      <Notice notice={notice} />
    </Card>
  );
}
