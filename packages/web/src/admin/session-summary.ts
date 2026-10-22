import { getLang, t } from '../i18n';
import { SESSION_IDS, SESSION_LABEL, txt, type SessionsPlan, type SettingValue } from '@howler/shared';

/** Frases cortas con lo que está activo ahora, en el orden en que se leen mejor (sesiones, condiciones, ayudas, neumáticos). */
export function summarize(values: Record<string, SettingValue>, sessions: SessionsPlan): string[] {
  const lang = getLang();
  const out: string[] = [];
  for (const id of SESSION_IDS) {
    const p = sessions[id];
    if (!p.enabled) continue;
    const name = txt(SESSION_LABEL[id], lang);
    out.push(id === 'race' && p.mode === 'laps' ? `${name} ${t('{n} vueltas', { n: p.laps })}` : `${name} ${p.minutes} min`);
  }
  const n = (k: string) => Number(values[k]);
  out.push(n('fuelRate') === 0 ? t('Combustible infinito') : `${t('Combustible')} ${n('fuelRate')} %`);
  out.push(n('damageMultiplier') === 0 ? t('Sin daños') : `${t('Daños')} ${n('damageMultiplier')} %`);
  out.push(n('tyreWearRate') === 0 ? t('Neumáticos sin desgaste') : `${t('Desgaste')} ${n('tyreWearRate')} %`);
  const assist = (name: string, v: number) => (v === 0 ? `${name} ${t('prohibido')}` : v === 1 ? `${name} ${t('según coche')}` : `${name} ${t('permitido')}`);
  out.push(assist('ABS', n('abs')), assist('TC', n('tc')));
  if (values.stability === true) out.push(t('Estabilidad'));
  if (values.blankets === true) out.push(t('Mantas térmicas'));
  if (values.dynamicTrack === true) out.push(t('Agarre dinámico'));
  return out;
}
