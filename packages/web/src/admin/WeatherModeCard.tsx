import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { WeatherStateDto } from '@howler/shared';
import { adminApi } from './adminApi';
import { Card, Notice, useNotice } from './ui';

/**
 * Qué sistema de clima usa el servidor: el clásico (una lista de climas en el preset) o el de CSP WeatherFX, que es el
 * que usan Pure, Sol y el de por defecto en el cliente. Con WeatherFX el servidor solo manda un «tipo» de clima (lluvia,
 * nublado…) con una transición suave y cada jugador lo dibuja con el script que haya elegido en Content Manager.
 */
export function WeatherModeCard({ running, onChanged }: { running: boolean; onChanged?: () => void }) {
  const { notice, run } = useNotice();
  const [wx, setWx] = useState<WeatherStateDto | null>(null);
  const load = () => adminApi.weather().then(setWx, () => setWx(null));
  useEffect(() => { void load(); }, []);
  if (!wx) return null;

  const change = (fx: boolean, restart: boolean) => run(async () => { await adminApi.setWeatherMode(fx, restart); await load(); onChanged?.(); }, restart ? t('Guardado. Reiniciando el servidor…') : t('Guardado. Se aplicará al arrancar el servidor.'));
  return (
    <Card title={t('Sistema de clima')} aside={<span className={`pill ${wx.fx ? 'ok' : ''}`}>{wx.fx ? t('CSP WeatherFX (Pure / Sol / por defecto)') : t('Clásico (lista del preset)')}</span>}>
      <div className="mode-choice">
        <label className="check">
          <input type="radio" name="wx-mode" checked={!wx.fx} onChange={() => void change(false, false)} />
          <span><b>{t('Clásico')}</b><br /><span className="muted">{t('El servidor tiene una lista de climas (de «Por defecto» o Sol) y se salta entre ellos. Lo ven igual todos los jugadores, con o sin CSP.')}</span></span>
        </label>
        <label className="check">
          <input type="radio" name="wx-mode" checked={wx.fx} onChange={() => void change(true, false)} />
          <span><b>{t('CSP WeatherFX (para Pure)')}</b><br /><span className="muted">{t('El servidor manda un tipo de clima (lluvia, nublado, niebla…) con transición suave y la lluvia afecta al agarre. Cada jugador elige Pure en Content Manager.')}</span></span>
        </label>
      </div>
      {wx.fx && (
        <div className="hint">
          <p>{t('Para ver Pure cada jugador debe tener CSP (Pure 3.59: 0.2.0 o superior para Pure Gamma, 0.2.3p211 o superior para Pure LCS) y Pure instalado, y elegirlo en Content Manager → Ajustes → Custom Shaders Patch → WeatherFX → Weather script (Pure trae dos versiones: «Pure Gamma» y «Pure LCS», esta última para los shaders de espacio de color lineal). Quien no lo tenga ve el clima con el script que use. Con Sol, las transiciones pueden dar un tirón; Pure y el de por defecto no.')}</p>
          <p>{wx.pure.found ? <>{t('Pure está instalado en este PC: {list}.', { list: wx.pure.variants.map((v) => `${v.name}${v.version ? ` ${v.version}` : ''}`).join(', ') })}</> : <>{t('No veo Pure instalado en este PC; no hace falta para el servidor, solo para quien quiera verlo.')}</>}</p>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!running} onClick={() => void change(wx.fx, true)} title={running ? t('Reinicia el servidor para aplicar el cambio de sistema') : t('El servidor está parado: se aplicará al arrancarlo')}>{t('Reiniciar el servidor para aplicar')}</button>
      </div>
      <p className="muted">{t('El cambio de sistema se aplica al reiniciar el servidor.')} {wx.fx ? t('En «En directo» podrás cambiar el tipo de clima con una transición.') : t('La lista de climas se edita aquí debajo.')}</p>
      <Notice notice={notice} />
    </Card>
  );
}
