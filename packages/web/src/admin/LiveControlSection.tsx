import { translateMessage, type Lang } from '@howler/shared';
import { t } from '../i18n';
import { useState } from 'react';
import type { AdminStateDto } from '@howler/shared';
import { Marker } from '../components/markers';
import { useEffect } from 'react';
import { adminApi, type RecordAnnounceDto } from './adminApi';
import { TimeControl } from './TimeControl';
import { WeatherControl } from './WeatherControl';
import { Card, ConfirmButton, Field, Notice, useNotice, type NoticeRunner } from './ui';

function Slider({ label, value, onChange, min = 0, max = 100, unit = '%' }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: string }) {
  return (
    <Field label={`${label}: ${value}${unit}`}>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

type Tier = 'session' | 'combo' | 'global';
const DEFAULT_TEXT: Record<Tier, string> = {
  global: 'Howler: ¡RÉCORD ABSOLUTO de {circuito}! {piloto} {tiempo} ({coche})',
  combo: 'Howler: ¡Récord de {circuito} con {coche}! {piloto} {tiempo}',
  session: 'Howler: nueva mejor vuelta de la sesión: {piloto} {tiempo} ({coche})',
};
/** El texto por defecto, en el idioma de los mensajes del servidor (el que se manda al chat). */
const defaultText = (tier: Tier, lang: Lang) => translateMessage(lang, DEFAULT_TEXT[tier]);
const HOLES = ['{piloto}', '{tiempo}', '{coche}', '{circuito}', '{anterior}', '{mejora}'];
const ANNOUNCE: [Tier, string, string][] = [
  ['session', t('Mejor vuelta de la sesión'), t('Cuando alguien hace la vuelta más rápida de la sesión en curso (cualquier coche).')],
  ['combo', t('Récord de circuito y coche'), t('Cuando se bate el récord de esa combinación de circuito y coche.')],
  ['global', t('Récord absoluto del circuito'), t('Cuando se bate el mejor tiempo del circuito con cualquier coche.')],
];

/** Texto de un aviso: vacío = el de Howler; se guarda al salir del campo o con el botón. */
function MessageEditor({ tier, value, lang, onSave }: { tier: Tier; value: string; lang: Lang; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="row" style={{ margin: '0 0 10px 26px' }}>
      <input type="text" maxLength={150} style={{ flex: 1, minWidth: 220 }} placeholder={defaultText(tier, lang)} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onSave(text)} aria-label={t('Texto del aviso')} />
      {value && <button type="button" className="btn" onClick={() => onSave('')}>{t('Texto por defecto')}</button>}
    </div>
  );
}

/** Elige qué récords anuncia Howler en el chat del servidor. Si una vuelta bate varios, solo se dice el más importante. */
function RecordAnnounceCard({ run, lang }: { run: NoticeRunner; lang: Lang }) {
  const [v, setV] = useState<RecordAnnounceDto | null>(null);
  useEffect(() => { adminApi.recordAnnounce().then(setV).catch(() => undefined); }, []);
  if (!v) return null;
  const all = v.session && v.combo && v.global;
  const set = (n: RecordAnnounceDto) => run(async () => { setV(await adminApi.saveRecordAnnounce(n)); }, t('Guardado.'));
  return (
    <details className="fold">
    <summary>{t('Avisos de récords en el chat del juego (opcional)')}{v.session || v.combo || v.global ? <span className="pill ok" style={{ marginLeft: 8 }}>{t('activos')}</span> : null}</summary>
    <Card title={t('Avisar de récords en el chat del servidor')}>
      <p className="muted">{t('Los jugadores verán el mensaje dentro del juego. Marca lo que quieras; si una vuelta bate varios récords, solo se anuncia el más importante.')}</p>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => void set({ ...v, session: e.target.checked, combo: e.target.checked, global: e.target.checked })} /> <span><b>{t('Todos')}</b></span></label>
      {ANNOUNCE.map(([k, label, hint]) => (
        <div key={k}>
          <label className="check"><input type="checkbox" checked={v[k]} onChange={(e) => void set({ ...v, [k]: e.target.checked })} /> <span><b>{label}</b><br /><span className="muted">{hint}</span></span></label>
          {v[k] && <MessageEditor tier={k} value={v.messages[k]} lang={lang} onSave={(txt) => set({ ...v, messages: { ...v.messages, [k]: txt } })} />}
        </div>
      ))}
      <p className="muted">{t('Puedes cambiar el texto de cada aviso. Huecos disponibles: {holes}. Máximo 150 letras (el juego recorta los mensajes largos).', { holes: HOLES.join(' ') })}</p>
      {!v.session && !v.combo && !v.global && <p className="muted">{t('Ahora mismo no se avisa de nada.')}</p>}
    </Card>
    </details>
  );
}

export function LiveControlSection({ state }: { state: AdminStateDto }) {
  const { notice, run } = useNotice();
  const [rain, setRain] = useState({ intensity: 0, wetness: 0, water: 0 });
  const [grip, setGrip] = useState(100);
  const [msg, setMsg] = useState('');
  const [ballast, setBallast] = useState<Record<number, string>>({});

  const live = state.server.state === 'running';
  const canControl = live && state.pluginAlive;

  return (
    <>
      {!live && <p className="warn">{t('El servidor no está en marcha: arráncalo en la pestaña Servidor para controlarlo en directo.')}</p>}
      {live && !state.pluginAlive && (
        <p className="warn">{t('El plugin de Howler no está activo en el servidor, así que estas órdenes no pueden llegar. Revisa la instalación del plugin (ver el manual).')}</p>
      )}
      <Notice notice={notice} />

      <div className="grid-2">
        <Card title={t('Hora y clima')}>
          <TimeControl enabled={canControl} run={run} />
          <WeatherControl enabled={canControl} serverState={state.server.state} run={run} />
          <details>
            <summary>{t('Lluvia y agarre (ajuste fino)')}</summary>
            <Slider label={t('Intensidad de lluvia')} value={rain.intensity} onChange={(n) => setRain({ ...rain, intensity: n })} />
            <Slider label={t('Humedad de la pista')} value={rain.wetness} onChange={(n) => setRain({ ...rain, wetness: n })} />
            <Slider label={t('Agua acumulada')} value={rain.water} onChange={(n) => setRain({ ...rain, water: n })} />
            <button type="button" className="btn" disabled={!canControl} onClick={() => run(() => adminApi.control.rain(rain.intensity, rain.wetness, rain.water), t('Lluvia ajustada'))}>{t('Aplicar lluvia')}</button>
            <Slider label={t('Agarre de la pista')} value={grip} min={50} onChange={setGrip} />
            <button type="button" className="btn" disabled={!canControl} onClick={() => run(() => adminApi.control.grip(grip), t('Agarre cambiado'))}>{t('Aplicar agarre')}</button>
          </details>
        </Card>

        <Card title={t('Sesión y mensajes')}>
          <div className="actions">
            <ConfirmButton label={t('Siguiente sesión')} confirmLabel={t('Confirmar: pasar de sesión')} disabled={!canControl} onConfirm={() => run(() => adminApi.control.session('next'), t('Sesión saltada'))} />
            <ConfirmButton label={t('Reiniciar sesión')} confirmLabel={t('Confirmar: reiniciar sesión')} disabled={!canControl} onConfirm={() => run(() => adminApi.control.session('restart'), t('Sesión reiniciada'))} />
          </div>
          <Field label={t('Mensaje a todos los jugadores')} hint={t('Sale en el chat del juego.')}>
            <input type="text" maxLength={200} value={msg} placeholder={t('Escribe un mensaje…')} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && msg.trim() && canControl) void run(() => adminApi.control.say(msg), t('Mensaje enviado')).then((ok) => { if (ok) setMsg(''); }); }} />
            <button type="button" className="btn" disabled={!canControl || !msg.trim()} onClick={() => run(() => adminApi.control.say(msg), t('Mensaje enviado')).then((ok) => { if (ok) setMsg(''); })}>{t('Enviar')}</button>
          </Field>
        </Card>
      </div>

      <Card title={t('Pilotos conectados ({n})', { n: state.online.length })}>
        {state.online.length === 0 ? (
          <p className="muted">{t('No hay nadie conectado.')}</p>
        ) : (
          <div className="table-scroll">
          <table className="players">
            <thead><tr><th></th><th>{t('Piloto')}</th><th>{t('Coche')}</th><th>{t('Lastre (kg)')}</th><th>{t('Acciones')}</th></tr></thead>
            <tbody>
              {state.online.map((p) => (
                <tr key={p.carId}>
                  <td><svg viewBox="-14 -14 28 28" width="24" height="24" aria-hidden="true"><Marker carId={p.carId} r={12} /></svg></td>
                  <td className="driver">{p.name}</td>
                  <td className="muted">{p.car.replace(/^ks_/, '').replace(/_/g, ' ')}</td>
                  <td>
                    <input type="number" min={0} max={500} className="narrow" value={ballast[p.carId] ?? ''} placeholder="0" onChange={(e) => setBallast({ ...ballast, [p.carId]: e.target.value })} aria-label={t('Lastre de {name}', { name: p.name })} />
                    <button type="button" className="btn small" disabled={!canControl || ballast[p.carId] === undefined || ballast[p.carId] === ''} onClick={() => run(() => adminApi.control.ballast(p.carId, Number(ballast[p.carId])), t('Lastre de {name} cambiado', { name: p.name }))}>{t('Poner')}</button>
                  </td>
                  <td className="row-actions">
                    <ConfirmButton label={t('Expulsar')} confirmLabel={t('¿Expulsar?')} disabled={!canControl} onConfirm={() => run(() => adminApi.control.kick(p.carId), t('{name} expulsado', { name: p.name }))} />
                    <ConfirmButton label={t('Banear')} confirmLabel={t('¿Banear?')} danger disabled={!canControl} onConfirm={() => run(() => adminApi.control.ban(p.carId), t('{name} baneado', { name: p.name }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <RecordAnnounceCard run={run} lang={state.settings.language} />
    </>
  );
}
