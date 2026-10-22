import { useEffect, useState } from 'react';
import { sanitizeDisplay, type DisplayConfig } from '@howler/shared';
import { adminGet, adminPut } from './adminApi';
import { Card, Field, Notice, useNotice } from './ui';
import { storeDisplay } from '../display-sync';
import { t } from '../i18n';

/** Idioma, hora, fecha y medidas de la web: los decide quien controla el panel y valen para todos los visitantes (ellos no pueden cambiarlos). */
export function WebDisplayCard() {
  const [d, setD] = useState<DisplayConfig | null>(null);
  const { notice, show } = useNotice();
  useEffect(() => { adminGet<{ display?: unknown }>('/admin/api/appearance').then((a) => setD(sanitizeDisplay(a.display))).catch((e: Error) => show(false, e.message)); }, []);
  if (!d) return <Card title={t('Idioma, hora y medidas de la web')}><Notice notice={notice} /></Card>;

  const save = async (next: DisplayConfig) => {
    setD(next);
    try {
      await adminPut('/admin/api/appearance', { display: next, ...(await adminGet<Record<string, unknown>>('/admin/api/appearance').then(({ layouts, theme }) => ({ layouts, theme }))) });
      storeDisplay(next);
      show(true, t('Guardado. La web se recarga para aplicarlo.'));
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) { show(false, (e as Error).message); }
  };
  const set = <K extends keyof DisplayConfig>(k: K, v: DisplayConfig[K]) => void save({ ...d, [k]: v });

  return (
    <Card title={t('Idioma, hora y medidas de la web')}>
      <p className="hint">{t('Lo eliges tú y vale para todos los que abran la web: los visitantes no pueden cambiarlo.')}</p>
      <Field label={t('Idioma')} hint={t('«Según el navegador» enseña cada visitante en su idioma (español si es español, inglés para el resto).')}>
        <select value={d.lang} onChange={(e) => set('lang', e.target.value as DisplayConfig['lang'])} aria-label={t('Idioma')}>
          <option value="auto">{t('Según el navegador')}</option>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </Field>
      <Field label={t('Formato de hora')}>
        <select value={d.clock} onChange={(e) => set('clock', e.target.value as DisplayConfig['clock'])} aria-label={t('Formato de hora')}>
          <option value="24h">{t('24 h')}</option>
          <option value="12h">{t('12 h (AM/PM)')}</option>
          <option value="auto">{t('Según el idioma')}</option>
        </select>
      </Field>
      <Field label={t('Formato de fecha')}>
        <select value={d.dateOrder} onChange={(e) => set('dateOrder', e.target.value as DisplayConfig['dateOrder'])} aria-label={t('Formato de fecha')}>
          <option value="auto">{t('Según el idioma')}</option>
          <option value="dmy">{t('Día/mes/año')}</option>
          <option value="mdy">{t('Mes/día/año')}</option>
          <option value="ymd">{t('Año-mes-día')}</option>
        </select>
      </Field>
      <Field label={t('Sistema de medida')} hint={t('Cambia cómo se enseñan velocidades y temperaturas; los ajustes de este panel (reglas, penalizaciones) siguen en km/h.')}>
        <select value={d.units} onChange={(e) => set('units', e.target.value as DisplayConfig['units'])} aria-label={t('Sistema de medida')}>
          <option value="metric">{t('Métrico (km/h, °C)')}</option>
          <option value="imperial">{t('Imperial (mph, °F)')}</option>
        </select>
      </Field>
      <Notice notice={notice} />
    </Card>
  );
}
