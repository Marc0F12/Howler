import { t, tm } from '../i18n';
import { useEffect, useState } from 'react';
import { cleanBadge, contrastRatio, MAX_BADGE, readableOn, type MhPeerDto, type MhStateDto } from '@howler/shared';
import { ago } from '../format';
import { ServerBadge } from '../components/ServerBadge';
import { adminApi } from './adminApi';
import { inviteText, parseInvite } from './mh-invite';
import { Card, ConfirmButton, Field, Notice, useNotice } from './ui';

const STATUS: Record<MhPeerDto['status'], string> = {
  requested: t('Esperando aprobación'), pending: t('Solicitud pendiente'), approved: t('Vinculado'), denied: t('Denegado'), revoked: t('Vínculo cerrado'),
};

/** Una frase que dice de un vistazo cómo va la relación con ese Howler. */
function syncLine(p: MhPeerDto): string {
  if (p.status === 'requested') return t('Has pedido vincularte con {name}. Esperando a que lo apruebe.', { name: p.name });
  if (p.status !== 'approved') return p.lastError ? tm(p.lastError) : STATUS[p.status];
  const base = p.lastSyncAt
    ? `${t('Conectado con {name} · última sincronización {ago}', { name: p.name, ago: ago(p.lastSyncAt) })}${p.lastNewLaps > 0 ? ` · ${t('+{n} vueltas nuevas', { n: p.lastNewLaps })}` : ''}`
    : t('Vinculado con {name} · aún no se ha sincronizado', { name: p.name });
  return p.lastError ? `${base} · ${t('sin conexión desde {ago}:', { ago: p.lastAttemptAt ? ago(p.lastAttemptAt) : t('hace un rato') })} ${tm(p.lastError)}` : base;
}

/** Qué viaja realmente: solo si uno da Y el otro recibe. */
function flowLine(p: MhPeerDto): string {
  const to = p.give && p.theyReceive, from = p.receive && p.theyGive;
  if (to && from) return t('Intercambio en los dos sentidos.');
  if (from) return t('Solo recibes de {name}.', { name: p.name });
  if (to) return t('Solo das a {name}.', { name: p.name });
  return t('Ahora mismo no viaja ningún dato (uno da y el otro no recibe, o al revés).');
}

function Request({ p, onDone }: { p: MhPeerDto; onDone: (s: MhStateDto) => void }) {
  const { notice, run } = useNotice();
  const [give, setGive] = useState(p.give);
  const [receive, setReceive] = useState(p.receive);
  return (
    <div className="discord-event">
      <Notice notice={notice} />
      <p><b>{p.name}</b> {t('quiere vincularse contigo')} · {ago(p.createdAt)}.<br />
        <span className="muted">{p.theyGive && p.theyReceive ? t('Pide darte sus datos y recibir los tuyos.') : p.theyGive ? t('Pide darte sus datos.') : t('Pide recibir los tuyos.')} {t('Tú decides qué permites.')}</span></p>
      <label className="check"><input type="checkbox" checked={receive} onChange={(e) => setReceive(e.target.checked)} /><span>{t('Recibir sus vueltas')}</span></label>
      <label className="check"><input type="checkbox" checked={give} onChange={(e) => setGive(e.target.checked)} /><span>{t('Darle mis vueltas')}</span></label>
      <div className="row">
        <button type="button" className="btn primary" disabled={!give && !receive} onClick={() => run(async () => onDone(await adminApi.mhApprove(p.id, give, receive)), t('Vínculo aprobado. Se conectará en menos de un minuto.'))}>{t('Aprobar')}</button>
        <button type="button" className="btn danger" onClick={() => run(async () => onDone(await adminApi.mhDeny(p.id)), t('Solicitud denegada.'))}>{t('Denegar')}</button>
      </div>
    </div>
  );
}

function Peer({ p, onDone }: { p: MhPeerDto; onDone: (s: MhStateDto) => void }) {
  const { notice, run } = useNotice();
  const upd = (b: Parameters<typeof adminApi.mhUpdate>[1], ok = t('Guardado.')) => run(async () => onDone(await adminApi.mhUpdate(p.id, b)), ok);
  const active = p.status === 'approved';
  return (
    <div className={`discord-event ${p.hidden ? 'dim' : ''}`}>
      <Notice notice={notice} />
      <p><ServerBadge text={p.badge} bg={p.badgeBg} fg={p.badgeFg} /> <b>{p.name}</b> <span className={`pill ${active && !p.lastError ? 'ok' : ''}`}>{STATUS[p.status]}</span>{p.hidden && <span className="pill"> {t('oculto')}</span>}<br />
        <span className="muted">{syncLine(p)}</span></p>
      {active && (
        <>
          <p className="muted">{flowLine(p)} {t('Tienes {n} vueltas suyas guardadas.', { n: p.lapsFrom })}</p>
          <label className="check"><input type="checkbox" checked={p.receive} onChange={(e) => upd({ receive: e.target.checked })} /><span>{t('Recibir sus vueltas')} <span className="muted">({p.theyGive ? t('ellos dan') : t('ellos no dan')})</span></span></label>
          <label className="check"><input type="checkbox" checked={p.give} onChange={(e) => upd({ give: e.target.checked })} /><span>{t('Darle mis vueltas')} <span className="muted">({p.theyReceive ? t('ellos reciben') : t('ellos no reciben')})</span></span></label>
          <label className="check"><input type="checkbox" checked={p.shareChampionships} onChange={(e) => upd({ shareChampionships: e.target.checked })} /><span>{t('Compartir campeonatos')} <span className="muted">({t('los dos lados deben activarlo; llegan como copia de solo lectura y los resultados se calculan con las vueltas sincronizadas')})</span></span></label>
          <label className="check"><input type="checkbox" checked={p.shareTraces} onChange={(e) => upd({ shareTraces: e.target.checked })} /><span>{t('Compartir trayectorias')} <span className="muted">({t('los dos lados deben activarlo; permite comparar vueltas y ver fantasmas con los pilotos del otro servidor. Cada trayectoria pesa unos 15 KB y solo viaja la mejor vuelta de cada piloto')})</span></span></label>
        </>
      )}
      <div className="row">
        {active && p.url && <button type="button" className="btn" onClick={() => run(async () => onDone(await adminApi.mhSync(p.id)), t('Sincronizado.'))}>{t('Sincronizar ahora')}</button>}
        {p.lapsFrom > 0 && <button type="button" className="btn" onClick={() => upd({ hidden: !p.hidden }, p.hidden ? t('Datos visibles otra vez.') : t('Datos ocultos (siguen guardados).'))}>{p.hidden ? t('Mostrar sus datos') : t('Ocultar sus datos')}</button>}
        {active && <ConfirmButton danger label={t('Revocar vínculo')} confirmLabel={t('Seguro: revocar')} onConfirm={() => run(async () => onDone(await adminApi.mhRevoke(p.id)), t('Vínculo revocado. Los datos recibidos se conservan.'))} />}
        {!active && p.lapsFrom > 0 && <ConfirmButton danger label={t('Borrar sus datos')} confirmLabel={t('Seguro: borrar para siempre')} onConfirm={() => run(async () => { const r = await adminApi.mhDeleteData(p.id); onDone(r); }, t('Datos de ese Howler borrados.'))} />}
        {!active && <button type="button" className="btn" onClick={() => run(async () => onDone(await adminApi.mhRemove(p.id)), t('Quitado de la lista.'))}>{t('Quitar de la lista')}</button>}
      </div>
    </div>
  );
}

const badgeOk = (b: string) => { try { cleanBadge(b); return true; } catch { return false; } };

/** Pestaña «MultiHowler»: unir varios Howler para compartir tiempos sin bases de datos compartidas. */
export function MultiHowlerSection() {
  const { notice, run } = useNotice();
  const [state, setState] = useState<MhStateDto | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [badge, setBadge] = useState('');
  const [bg, setBg] = useState('');
  const [fg, setFg] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  /** Escribir en un campo; si lo pegado es la invitación entera (dirección + clave), se rellenan los dos. */
  const fillInvite = (text: string, field: 'url' | 'key') => {
    const inv = parseInvite(text);
    if (inv.url && inv.key) { setUrl(inv.url); setKey(inv.key); return; }
    if (field === 'url') setUrl(text); else setKey(text);
  };
  const [give, setGive] = useState(true);
  const [receive, setReceive] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => adminApi.multihowler().then((s) => {
      if (!alive) return;
      setState(s);
      if (first) { setName(s.name); setAddress(s.address); setBadge(s.badge); setBg(s.badgeBg); setFg(s.badgeFg); }
    }).catch(() => undefined);
    void load(true);
    const timer = window.setInterval(() => void load(false), 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  if (!state) return <p className="empty">{t('Cargando…')}</p>;

  const pending = state.peers.filter((p) => p.direction === 'incoming' && p.status === 'pending');
  const others = state.peers.filter((p) => !pending.includes(p));

  return (
    <>
      <Notice notice={notice} />
      <p className="muted">{t('MultiHowler junta los tiempos de varios servidores sin base de datos compartida: cada Howler guarda una copia de todo. Para sincronizar, los dos Howlers tienen que estar encendidos a la vez (que Howler arranque con Windows ayuda).')}</p>
      <Card title={t('Tu Howler')}>
        <Field label={t('Nombre')} hint={t('Cómo te verán los demás al vincularse.')}>
          <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Insignia')} hint={t('Hasta {n} caracteres; vale poner emojis (🐒, 🏁...). Es la etiqueta corta con la que te verán en los filtros y en el historial de los demás.', { n: MAX_BADGE })}>
          <span className="row"><input type="text" value={badge} onChange={(e) => setBadge(e.target.value)} aria-invalid={!badgeOk(badge)} /><ServerBadge text={badgeOk(badge) ? badge.trim() : '—'} bg={bg} fg={fg} /></span>
        </Field>
        <Field label={t('Colores de la insignia')} hint={t('Fondo y letras. «Automático» usa los de la web (o negro/blanco según el fondo).')}>
          <span className="row">
            <label>{t('Fondo')} <input type="color" value={bg || '#6b4eff'} onChange={(e) => setBg(e.target.value)} /></label>
            <label>{t('Letras')} <input type="color" value={fg || readableOn(bg || '#6b4eff')} onChange={(e) => setFg(e.target.value)} /></label>
            <button type="button" className="btn" onClick={() => { setBg(''); setFg(''); }}>{t('Automático')}</button>
          </span>
          {bg && fg && contrastRatio(bg, fg) < 3 && <span className="muted"> ⚠ {t('Se leerá mal: poco contraste entre fondo y letras.')}</span>}
        </Field>
        <Field label={t('Dirección de tu web')} hint={t('La dirección con la que otros llegan a TU web de Howler: tu IP pública (o tu dominio) y el puerto de la web, por ejemplo http://203.0.113.5:8420. Si solo vais a conectar dentro de la misma casa o red, vale la IP local (como http://192.168.1.20:8420). Para conectar por internet, ese puerto debe estar abierto en tu router.')}>
          <input type="text" placeholder="http://…" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <button type="button" className="btn" disabled={!badgeOk(badge) || (name.trim() === state.name && address.trim() === state.address && badge.trim() === state.badge && bg === state.badgeBg && fg === state.badgeFg)} onClick={() => run(async () => setState(await adminApi.mhIdentity({ name: name.trim(), address: address.trim(), badge: badge.trim(), badgeBg: bg, badgeFg: fg })), t('Guardado.'))}>{t('Guardar')}</button>
        <Field label={t('Tu clave de vinculación')} hint={t('Quien la tenga solo puede PEDIR vincularse; tú aprobarás o no cada solicitud. Regenerarla no rompe vínculos ya aprobados.')}>
          <code className="mh-key">{state.key}</code>
        </Field>
        <div className="row">
          <button type="button" className="btn primary" disabled={!state.address} title={state.address ? undefined : t('Guarda primero la dirección de tu web.')} onClick={() => run(async () => { await navigator.clipboard.writeText(inviteText(state.address, state.key)); }, t('Invitación copiada: pégala en Discord o WhatsApp.'))}>{t('Copiar invitación (dirección + clave)')}</button>
          <button type="button" className="btn" onClick={() => run(async () => { await navigator.clipboard.writeText(state.key); }, t('Clave copiada.'))}>{t('Copiar solo la clave')}</button>
          <ConfirmButton label={t('Generar otra clave')} confirmLabel={t('Seguro: otra clave')} onConfirm={() => run(async () => setState(await adminApi.mhRegenerateKey()), t('Clave nueva.'))} />
        </div>
        <details>
          <summary className="muted">{t('¿Copiaste la carpeta de datos de otro Howler?')}</summary>
          <p className="muted">{t('Entonces tu Howler tiene la misma identidad que el original y no podrá vincularse. Regenerarla cierra todos tus vínculos, crea una identidad y una clave nuevas, y solo compartirá las vueltas que des a partir de ahora (las anteriores ya las tiene el otro y saldrían duplicadas). Los datos recibidos de otros se conservan. Hazlo en la copia, no en el original.')}</p>
          <ConfirmButton danger label={t('Regenerar identidad')} confirmLabel={t('Seguro: regenerar identidad')} onConfirm={() => run(async () => setState(await adminApi.mhRegenerateIdentity()), t('Identidad nueva. Vuelve a vincularte con quien quieras.'))} />
        </details>
      </Card>
      {pending.length > 0 && (
        <Card title={t('Solicitudes pendientes ({n})', { n: pending.length })}>
          {pending.map((p) => <Request key={p.id} p={p} onDone={setState} />)}
        </Card>
      )}
      <Card title={t('Vincular con otro Howler')}>
        <ol className="steps">
          <li>{t('La otra persona abre su panel → Ajustes → Conexiones → MultiHowler y pulsa «Copiar invitación». Te la pasa por Discord o WhatsApp.')}</li>
          <li>{t('Pega aquí su invitación (en cualquiera de los dos campos: se rellenan los dos solos) y elige qué quieres. Recibirá una solicitud y decidirá si la aprueba.')}</li>
        </ol>
        <Field label={t('Dirección web del otro Howler')} hint={isPlainInternetUrl(url) ? t('Esa dirección usa http:// (sin cifrar): el vínculo y las vueltas viajarían sin protección por internet. Si el otro Howler está detrás de un dominio con https://, úsalo.') : undefined}><input type="text" placeholder="http://203.0.113.5:8420" value={url} onChange={(e) => fillInvite(e.target.value, 'url')} /></Field>
        <Field label={t('Su clave')}><input type="text" autoComplete="off" placeholder="HWL-XXXX-XXXX-XXXX-XXXX" value={key} onChange={(e) => fillInvite(e.target.value, 'key')} /></Field>
        <label className="check"><input type="checkbox" checked={receive} onChange={(e) => setReceive(e.target.checked)} /><span>{t('Quiero recibir sus vueltas')}</span></label>
        <label className="check"><input type="checkbox" checked={give} onChange={(e) => setGive(e.target.checked)} /><span>{t('Quiero darle las mías')}</span></label>
        <button type="button" className="btn primary" disabled={!url.trim() || !key.trim() || (!give && !receive)}
          onClick={() => run(async () => { setState(await adminApi.mhLink({ url: url.trim(), key: key.trim(), give, receive })); setUrl(''); setKey(''); }, t('Solicitud enviada. Queda esperando a que la apruebe.'))}>{t('Pedir vínculo')}</button>
      </Card>
      <Card title={t('Vínculos')}>
        {others.length === 0 ? <p className="empty">{t('Aún no estás vinculado con nadie.')}</p> : others.map((p) => <Peer key={p.id} p={p} onDone={setState} />)}
      </Card>
    </>
  );
}

/** ¿Es una dirección de red local o privada? Solo cuentan IPs completas (a.b.c.d), nombres sin punto y «.local»/«.lan». */
function isLocalHost(h: string): boolean {
  if (h === 'localhost' || h === '[::1]' || /^\[(fc|fd|fe80)/i.test(h)) return true;
  const q = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (q) {
    const [a, b] = [Number(q[1]), Number(q[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return !h.includes('.') || /\.(local|lan|home|internal)$/i.test(h);
}

/** Una dirección http:// (sin cifrar) que no es de la red local: el aviso se enseña antes de pedir el vínculo. */
export function isPlainInternetUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' && !isLocalHost(u.hostname);
  } catch { return false; }
}
