import { useEffect, useRef, useState } from 'react';
import { getLang, t, tm } from '../i18n';
import { DISCORD_EVENTS, type DiscordEventDef, type DiscordEventSetting } from '@howler/shared';
import { adminApi, type DiscordStateDto } from './adminApi';
import { Card, Field, Notice, useNotice } from './ui';

/** Un aviso: interruptor, título y mensaje editables (vacío = el de Howler), huecos disponibles y botón de prueba. */
function EventRow({ def, setting, canTest, onSave, onTest }: {
  def: DiscordEventDef; setting?: DiscordEventSetting; canTest: boolean;
  onSave: (v: DiscordEventSetting) => void; onTest: (title: string, message: string) => void;
}) {
  const enabled = setting?.enabled ?? def.defaultEnabled;
  const [title, setTitle] = useState(setting?.title ?? '');
  const [message, setMessage] = useState(setting?.message ?? '');
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<'title' | 'message'>('message');
  const caret = useRef<{ field: 'title' | 'message'; pos: number } | null>(null);
  const lang = getLang();
  useEffect(() => {
    const c = caret.current;
    if (!c) return;
    caret.current = null;
    const el = c.field === 'title' ? titleRef.current : messageRef.current;
    el?.focus();
    el?.setSelectionRange(c.pos, c.pos);
  });
  /** Mete el hueco en el campo donde se estaba escribiendo, en el punto del cursor. Se guarda en el idioma de quien edita; al enviar valen los dos. */
  const insert = (token: string) => {
    const field = lastField.current;
    const el = field === 'title' ? titleRef.current : messageRef.current;
    const value = field === 'title' ? title : message;
    const a = el?.selectionStart ?? value.length, b = el?.selectionEnd ?? value.length;
    const next = value.slice(0, a) + token + value.slice(b);
    caret.current = { field, pos: a + token.length };
    if (field === 'title') setTitle(next.slice(0, 120)); else setMessage(next.slice(0, 500));
  };
  useEffect(() => { setTitle(setting?.title ?? ''); setMessage(setting?.message ?? ''); }, [setting?.title, setting?.message]);
  const custom = (setting?.title ?? '') !== '' || (setting?.message ?? '') !== '';
  return (
    <div className="discord-event">
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => onSave({ enabled: e.target.checked })} />
        <span><b>{tm(def.label)}</b>{custom && <span className="pill"> {t('personalizado')}</span>}<br /><span className="muted">{tm(def.hint)}</span></span>
      </label>
      <button type="button" className="btn link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('Ocultar texto') : t('Cambiar el texto')}</button>
      {open && (
        <div className="discord-edit">
          <Field label={t('Título')}><input ref={titleRef} type="text" maxLength={120} placeholder={tm(def.defaultTitle)} value={title} onFocus={() => { lastField.current = 'title'; }} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label={t('Mensaje')}><textarea ref={messageRef} rows={3} maxLength={500} placeholder={tm(def.defaultMessage)} value={message} onFocus={() => { lastField.current = 'message'; }} onChange={(e) => setMessage(e.target.value)} /></Field>
          {def.placeholders.length > 0 && (
            <div className="row placeholder-buttons" role="group" aria-label={t('Insertar un dato en el texto')}>
              <span className="muted">{t('Insertar:')}</span>
              {def.placeholders.map((p) => (
                <button key={p.name} type="button" className="btn small" title={tm(p.hint)} onClick={() => insert(`{${lang === 'es' ? p.name : p.alias}}`)}>{p.label[lang === 'es' ? 0 : 1]}</button>
              ))}
            </div>
          )}
          <p className="muted">{t('Si lo dejas vacío se usa el texto de Howler. Admite **negrita** de Discord.')}</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => onSave({ title: title.trim(), message: message.trim() })}>{t('Guardar texto')}</button>
            <button type="button" className="btn" disabled={!canTest} onClick={() => onTest(title.trim(), message.trim())}>{t('Probar este aviso')}</button>
            {custom && <button type="button" className="btn" onClick={() => { setTitle(''); setMessage(''); onSave({ title: '', message: '' }); }}>{t('Volver al texto de Howler')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pestaña «Discord»: Howler avisa en un canal cuando alguien bate un récord o el servidor se enciende o apaga. Sin bots ni claves: solo un enlace. */
export function DiscordSection() {
  const { notice, run } = useNotice();
  const [state, setState] = useState<DiscordStateDto | null>(null);
  const [url, setUrl] = useState('');
  const [hookName, setHookName] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [serverName, setServerName] = useState('');

  useEffect(() => { adminApi.discord().then((s) => { setState(s); setPublicUrl(s.publicUrl); setServerName(s.serverName); }).catch(() => undefined); }, []);
  if (!state) return <p className="empty">{t('Cargando…')}</p>;

  const save = (patch: Parameters<typeof adminApi.saveDiscord>[0], ok: string) => run(async () => { setState(await adminApi.saveDiscord(patch)); }, ok);

  return (
    <>
      <Notice notice={notice} />
      <Card title={t('1. Conecta Howler con tu canal de Discord')} aside={<span className={`pill ${state.configured ? 'ok' : ''}`}>{state.configured ? (state.hooks.length === 1 ? t('1 canal') : t('{n} canales', { n: state.hooks.length })) : t('Sin conectar')}</span>}>
        <ol className="steps">
          <li>{t('En Discord, abre el canal donde quieras los avisos y pulsa la rueda dentada (Editar canal).')}</li>
          <li>{t('Entra en Integraciones → Webhooks → Nuevo webhook.')}</li>
          <li>{t('Pulsa Copiar URL del webhook y pégala aquí abajo.')}</li>
        </ol>
        {state.hooks.length > 0 && (
          <ul className="steps">
            {state.hooks.map((h) => (
              <li key={h.id}>
                <b>{h.name}</b> <span className="muted">{h.hint}</span>{' '}
                <button type="button" className="btn link" onClick={() => run(async () => { setState(await adminApi.removeDiscordHook(h.id)); }, t('Canal quitado.'))}>{t('Quitar')}</button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">{t('Puedes añadir varios canales: cada aviso se manda a todos. Y varios Howlers pueden usar el mismo webhook (así comparten canal): pon abajo el nombre de este servidor para que se sepa de cuál viene cada aviso.')}</p>
        <Field label={t('Nombre del canal')} hint={t('Solo para reconocerlo aquí (por ejemplo «Carreras» o «Avisos»).')}>
          <input type="text" maxLength={40} placeholder={t('Principal')} value={hookName} onChange={(e) => setHookName(e.target.value)} />
        </Field>
        <Field label={t('Enlace del webhook')} hint={t('Es como una contraseña del canal: no se la des a nadie. Howler no lo vuelve a mostrar entero.')}>
          <input type="password" autoComplete="off" placeholder="https://discord.com/api/webhooks/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="row">
          <button type="button" className="btn primary" disabled={!url.trim()} onClick={() => run(async () => { setState(await adminApi.addDiscordHook(hookName.trim() || t('Canal'), url.trim())); setUrl(''); setHookName(''); }, t('Canal añadido. Ahora pulsa «Enviar mensaje de prueba».'))}>{t('Añadir canal')}</button>
          <button type="button" className="btn" disabled={!state.configured && !url.trim()} onClick={() => run(() => adminApi.testDiscord(url.trim() || undefined), t('Mensaje enviado: mira tu canal de Discord.'))}>{t('Enviar mensaje de prueba')}</button>
        </div>
      </Card>
      {(['Servidor', 'Pilotos', 'Récords', 'Campeonatos'] as const).map((group) => (
        <Card key={group} title={t('2. Avisos: {group}', { group: tm(group) })} aside={group === 'Servidor' ? <span className="muted">{t('Elige cuáles quieres y cámbialos a tu gusto')}</span> : undefined}>
          {DISCORD_EVENTS.filter((e) => e.group === group).map((e) => (
            <EventRow key={e.id} def={e} setting={state.events[e.id]} canTest={state.configured}
              onSave={(v) => save({ events: { [e.id]: v } }, t('Guardado.'))}
              onTest={(title, message) => run(() => adminApi.testDiscord(undefined, { id: e.id, title, message }), t('Aviso de prueba enviado: mira tu canal de Discord.'))} />
          ))}
        </Card>
      ))}
      <Card title={t('3. Nombre del servidor y enlace a la web (opcional)')}>
        <Field label={t('Nombre de este servidor')} hint={t('Opcional: si lo pones sale al pie de cada aviso («Servidor: …»). Para más control, usa {servidor} e {insignia} en el título o el mensaje de cualquier aviso.')}>
          <input type="text" maxLength={40} placeholder={t('Ej.: Servidor de Marc')} value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={serverName.trim() === state.serverName} onClick={() => save({ serverName }, t('Guardado.'))}>{t('Guardar nombre')}</button>
        <Field label={t('Dirección de tu web de Howler')} hint={t('Si la pones, el título del aviso de récord enlaza a ella. Ejemplo: http://mi-servidor.com:8420')}>
          <input type="text" placeholder="http://…" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={publicUrl.trim() === state.publicUrl} onClick={() => save({ publicUrl }, t('Guardado.'))}>{t('Guardar dirección')}</button>
      </Card>
    </>
  );
}
