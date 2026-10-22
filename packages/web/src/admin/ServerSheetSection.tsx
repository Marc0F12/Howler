import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cleanTrackId, folderKey, HOWLER_BANNER_URL, HOWLER_LOGO_URL, imageAlt, imageUrlWarning, MAX_IMG_WIDTH, normalizeImageUrl, HOWLER_URL, MAX_SHEET_CHARS, MAX_SHEET_TITLE, bbcodeToHtml, cleanBbcode, isSheetUrl, sheetProblems, type AdminStateDto, type EntryListDto, type InstalledContentDto, type ServerSheetDto, type SheetPresetsDto } from '@howler/shared';
import { t, tm } from '../i18n';
import { carImage, trackImage } from '../content';
import { adminApi } from './adminApi';
import { htmlToBbcode } from './sheet-html';
import { Notice, useNotice } from './ui';

const footerText = () => `${t('Tiempos y estadísticas con')} [url=${HOWLER_URL}]Howler[/url]`;
/** Pie de Howler: el logo pequeño (sin tamaño ni enlace, para que en CM no reaccione al pulsarlo) y el texto debajo. */
const footer = () => `[img=${HOWLER_LOGO_URL}]Howler[/img]\n${footerText()}`;

/** Presets de serie (no se pueden borrar). El de Howler es el de serie cuando la descripción está vacía. */
const BUILTIN: { id: string; name: () => string; code: () => string }[] = [
  { id: 'howler', name: () => t('Howler (por defecto)'), code: footer },
  { id: 'empty', name: () => t('Vacía'), code: () => '' },
  { id: 'banner', name: () => t('Cabecera ancha y pie'), code: () => `[img=${HOWLER_BANNER_URL}]Howler[/img]\n${footerText()}` },
  {
    id: 'rules', name: () => t('Normas + Discord'),
    code: () => `[size=26][b]${t('Bienvenido')}[/b][/size]\n[color=#f5d90a][size=20]${t('Normas')}[/size][/color]\n${t('Respeta a los demás pilotos.')}\n${t('Nada de choques a propósito.')}\n${t('Si te sales de pista, vuelve sin molestar.')}\n\n[b]${t('Enlaces de descarga en')} [url=https://discord.gg/]Discord[/url][/b]\n\n${footer()}`,
  },
];

/** Texto con el que se abre una descripción vacía: el preset por defecto elegido (o el de Howler). */
function defaultCode(p: SheetPresetsDto | null): string {
  const id = p?.defaultId ?? 'howler';
  return BUILTIN.find((x) => x.id === id)?.code() ?? p?.presets.find((x) => x.id === id)?.description ?? footer();
}

const SWATCHES = ['#ffffff', '#f5d90a', '#ff9a1f', '#ff4500', '#e5322d', '#e046e0', '#4fb3ff', '#2ee6c8', '#19c24a', '#9aa0aa'];
const SIZES: [string, () => string, string][] = [['2', () => t('Pequeño'), '2'], ['3', () => t('Normal'), '3'], ['5', () => t('Grande'), '5'], ['6', () => t('Enorme'), '6']];

/** Editor de texto con formato (negrita, color, tamaño, enlaces, imágenes) sobre una selección cualquiera. Entrega BBCode. */
function RichEditor({ value, loadKey, onChange }: { value: string; loadKey: number; onChange: (bbcode: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [panel, setPanel] = useState<null | 'link' | 'image'>(null);
  const [rawUrl, setUrl] = useState('');
  const [urlError, setUrlError] = useState(false);
  const [width, setWidth] = useState('');
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);
  const [imgW, setImgW] = useState('');

  // El contenido se carga solo al abrir o al cambiar el origen (plantilla, texto con etiquetas): no en cada tecla, para no mover el cursor.
  useEffect(() => { if (ref.current) ref.current.innerHTML = bbcodeToHtml(value, false); }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keep = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', keep);
    return () => document.removeEventListener('selectionchange', keep);
  }, []);

  const sync = () => { if (ref.current) onChange(htmlToBbcode(ref.current)); };
  const restore = () => {
    ref.current?.focus();
    const s = window.getSelection();
    if (s && range.current) { s.removeAllRanges(); s.addRange(range.current); }
  };
  const cmd = (name: string, arg?: string) => { restore(); document.execCommand('styleWithCSS', false, 'false'); document.execCommand(name, false, arg); sync(); };

  const apply = () => {
    const url = panel === 'image' ? normalizeImageUrl(rawUrl) : rawUrl;
    if (!isSheetUrl(url)) { setUrlError(true); return; }
    restore();
    if (panel === 'image') {
      const w = Number(width);
      document.execCommand('insertHTML', false, `<img src="${url}" alt="${imageAlt(url)}"${w >= 16 && w <= MAX_IMG_WIDTH ? ` style="max-width:${Math.round(w)}px;max-height:${Math.round(w)}px"` : ''}>`);
    }
    else if (range.current && range.current.collapsed) document.execCommand('insertHTML', false, `<a href="${url}">${url}</a>`);
    else document.execCommand('createLink', false, url);
    sync();
    setPanel(null); setUrl(''); setUrlError(false); setWidth('');
  };

  const pick = (e: React.MouseEvent) => {
    const el = e.target instanceof HTMLImageElement ? e.target : null;
    ref.current?.querySelectorAll('img.sel').forEach((i) => i.classList.remove('sel'));
    el?.classList.add('sel');
    setSelImg(el);
    setImgW(el ? (/^(\d+)px$/.exec(el.style.maxWidth)?.[1] ?? '') : '');
  };
  const resize = (px: number | null) => {
    if (!selImg) return;
    const v = px === null ? null : Math.min(MAX_IMG_WIDTH, Math.max(16, Math.round(px)));
    if (v === null) { selImg.style.removeProperty('max-width'); selImg.style.removeProperty('max-height'); } else { selImg.style.maxWidth = `${v}px`; selImg.style.maxHeight = `${v}px`; }
    setImgW(px === null ? '' : String(Math.min(MAX_IMG_WIDTH, Math.max(16, Math.round(px)))));
    sync();
  };

  const Btn = ({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: ReactNode }) => (
    <button type="button" className="btn small cm-tool" aria-label={label} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  );

  return (
    <div className="rich">
      <div className="rich-bar" role="toolbar" aria-label={t('Formato del texto')}>
        <Btn label={t('Negrita')} title={t('Negrita')} onClick={() => cmd('bold')}><b>B</b></Btn>
        <Btn label={t('Cursiva')} title={t('Cursiva')} onClick={() => cmd('italic')}><i>I</i></Btn>
        <Btn label={t('Subrayado')} title={t('Subrayado')} onClick={() => cmd('underline')}><u>U</u></Btn>
        <Btn label={t('Tachado')} title={t('Tachado')} onClick={() => cmd('strikeThrough')}><s>S</s></Btn>
        <span className="rich-sep" />
        {SIZES.map(([id, label]) => <Btn key={id} label={label()} title={t('Tamaño: {n}', { n: label() })} onClick={() => cmd('fontSize', id)}>{label()}</Btn>)}
        <span className="rich-sep" />
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="rich-swatch" style={{ background: c }} aria-label={t('Color {c}', { c })} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('foreColor', c)} />
        ))}
        <input type="color" className="rich-color" aria-label={t('Otro color')} title={t('Otro color')} onChange={(e) => cmd('foreColor', e.target.value)} />
        <span className="rich-sep" />
        <Btn label={t('Enlace')} title={t('Enlace')} onClick={() => { setPanel(panel === 'link' ? null : 'link'); setUrl(''); setUrlError(false); }}>{t('Enlace')}</Btn>
        <Btn label={t('Imagen')} title={t('Imagen')} onClick={() => { setPanel(panel === 'image' ? null : 'image'); setUrl(''); setUrlError(false); }}>{t('Imagen')}</Btn>
        <Btn label={t('Quitar formato')} title={t('Quitar formato')} onClick={() => { cmd('removeFormat'); cmd('unlink'); }}>{t('Quitar formato')}</Btn>
        <span className="rich-sep" />
        <Btn label={t('Deshacer')} title={t('Deshacer')} onClick={() => cmd('undo')}>↶</Btn>
        <Btn label={t('Rehacer')} title={t('Rehacer')} onClick={() => cmd('redo')}>↷</Btn>
      </div>
      {panel && (
        <div className="rich-panel">
          <input type="text" className="wide" autoFocus value={rawUrl} placeholder="https://…" aria-invalid={urlError}
            aria-label={panel === 'image' ? t('Enlace de la imagen') : t('Dirección del enlace')}
            onChange={(e) => { setUrl(e.target.value.trim()); setUrlError(false); }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
          <button type="button" className="btn small primary" onClick={apply}>{panel === 'image' ? t('Insertar imagen') : t('Poner enlace')}</button>
          {urlError && <span className="warn">{t('Tiene que empezar por http:// o https:// y no llevar espacios.')}</span>}
          {panel === 'image' && (
            <label className="rich-w">{t('Tamaño máximo (px, opcional)')} <input type="number" min={16} max={MAX_IMG_WIDTH} value={width} onChange={(e) => setWidth(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /></label>
          )}
          {panel === 'image' && (
            <div className="rich-help">
              <strong>{t('La imagen tiene que estar en internet')}</strong>
              <p>{t('Content Manager no puede leer archivos de tu ordenador: cada jugador la descarga desde internet. Por eso aquí se pega un enlace, no se sube un archivo.')}</p>
              <ol>
                <li>{t('Sube tu PNG o JPG a imgur.com (o a un repositorio público de GitHub).')}</li>
                <li>{t('Copia el enlace directo de la imagen: acaba en .png, .jpg…')}</li>
                <li>{t('Pégalo arriba.')}</li>
              </ol>
              <p>{t('No uses enlaces de Discord: caducan y la imagen dejaría de verse.')}</p>
            </div>
          )}
          {panel === 'image' && imageUrlWarning(normalizeImageUrl(rawUrl)) === 'discord' && <span className="warn">{t('Los enlaces de Discord caducan: la imagen dejará de verse. Súbela a otro sitio.')}</span>}
          {panel === 'image' && imageUrlWarning(normalizeImageUrl(rawUrl)) === 'page' && <span className="warn">{t('Esto no parece el enlace directo de una imagen (debería acabar en .png, .jpg…). Si es una página con la imagen, CM no la dibujará.')}</span>}
          {panel === 'link' && <span className="hint">{t('Selecciona antes el texto que quieres convertir en enlace.')}</span>}
        </div>
      )}
      {selImg && (
        <div className="rich-panel">
          <label className="rich-w">{t('Tamaño máximo de la imagen (px)')} <input type="number" min={16} max={MAX_IMG_WIDTH} value={imgW} placeholder={t('original')} onChange={(e) => setImgW(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && imgW) resize(Number(imgW)); }} /></label>
          <button type="button" className="btn small primary" disabled={!imgW} onClick={() => resize(Number(imgW))}>{t('Aplicar')}</button>
          <button type="button" className="btn small" onClick={() => resize(null)}>{t('Tamaño original')}</button>
          <span className="hint">{t('Es el ancho y alto máximos en píxeles; la imagen conserva su proporción y no se agranda. Sin valor, sale a su tamaño original. Ojo: en Content Manager una imagen con tamaño se abre ampliada al pulsarla; sin tamaño no hace nada.')}</span>
        </div>
      )}
      <div
        ref={ref}
        className="cm-desc"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t('Descripción')}
        onInput={sync}
        onClick={pick}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
      />
    </div>
  );
}

const pretty = (id: string) => id.replace(/^ks_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Título y descripción que Content Manager enseña al elegir el servidor, editados dentro de una maqueta de su ficha. */
export function ServerSheetSection({ state }: { state: AdminStateDto }) {
  const { notice, run } = useNotice();
  const [saved, setSaved] = useState<ServerSheetDto | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [loadKey, setLoadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryListDto | null>(null);
  const [installed, setInstalled] = useState<InstalledContentDto | null>(null);
  const [presets, setPresets] = useState<SheetPresetsDto | null>(null);
  const [presetId, setPresetId] = useState('howler');
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  const load = (s: ServerSheetDto, p: SheetPresetsDto | null = presets) => { setSaved(s); setTitle(s.title); setDesc(s.description.trim() ? s.description : defaultCode(p)); setLoadKey((k) => k + 1); };
  useEffect(() => {
    adminApi.sheetPresets().catch(() => null).then((p) => {
      setPresets(p);
      setPresetId(p?.defaultId ?? 'howler');
      return adminApi.serverSheet().then((s) => { load(s, p); setError(null); }, (e: Error) => setError(tm(e.message)));
    });
    adminApi.entryList().then(setEntries, () => setEntries(null));
    adminApi.installedContent().then(setInstalled, () => setInstalled(null));
  }, [state.settings.serverDir, state.settings.server.preset]);

  const cars = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of entries?.slots ?? []) if (!s.spectator) m.set(s.model, (m.get(s.model) ?? 0) + 1);
    return [...m];
  }, [entries]);

  if (error) return <p className="warn">{t('No se pudo leer la ficha del servidor:')} {error}</p>;
  if (!saved) return <p className="empty">{t('Cargando…')}</p>;

  const running = state.server.state !== 'stopped';
  const clean = cleanBbcode(desc);
  const problems = sheetProblems(title, clean);
  const dirty = title !== saved.title || clean !== cleanBbcode(saved.description);

  const save = (applyAndRestart: boolean) =>
    run(async () => {
      const r = await adminApi.saveServerSheet(title.trim(), clean, applyAndRestart);
      setSaved(r); setTitle(r.title); setDesc(r.description);
      return { ok: true, reply: r.restarting ? t('Reiniciando el servidor para aplicarlo…') : running ? t('Se aplicará la próxima vez que reinicies el servidor.') : t('Se aplicará al arrancar el servidor.') };
    }, t('Ficha guardada'));

  const setCode = (code: string) => { setDesc(code); setLoadKey((k) => k + 1); };
  const first = cars[0]?.[0];
  const carLabel = (id: string) => installed?.cars.find((c) => c.id === id)?.name ?? pretty(id);
  const trackInfo = entries?.track ? installed?.tracks.find((x) => folderKey(cleanTrackId(x.track)) === folderKey(cleanTrackId(entries.track)) && x.layout === entries.layout) ?? installed?.tracks.find((x) => folderKey(cleanTrackId(x.track)) === folderKey(cleanTrackId(entries.track))) : undefined;
  const trackLabel = trackInfo?.name ?? (entries?.track ? pretty(cleanTrackId(entries.track)) : t('Circuito'));

  return (
    <div className="sheet">
      <p className="hint">{t('Así se ve tu servidor en Content Manager cuando alguien lo elige. A la izquierda escribes; a la derecha ves cómo queda. Usa la barra sobre el texto que selecciones. Se guarda en los archivos del servidor y se aplica al reiniciarlo.')}</p>
      {saved.missing && <p className="warn">{t('No se encuentra el archivo {file}. Arranca el servidor una vez para que se cree.', { file: saved.missing })}</p>}

      <div className="sheet-tpl">
        <label className="sheet-tpl-label" htmlFor="sheet-preset">{t('Presets')}</label>
        <select id="sheet-preset" value={presetId} onChange={(e) => { setPresetId(e.target.value); setConfirmLoad(false); }}>
          <optgroup label={t('De serie')}>
            {BUILTIN.map((p) => <option key={p.id} value={p.id}>{p.name()}{(presets?.defaultId ?? 'howler') === p.id ? ` ★` : ''}</option>)}
          </optgroup>
          {presets && presets.presets.length > 0 && (
            <optgroup label={t('Mis presets')}>
              {presets.presets.map((p) => <option key={p.id} value={p.id}>{p.name}{presets.defaultId === p.id ? ` ★` : ''}</option>)}
            </optgroup>
          )}
        </select>
        <button type="button" className="btn small" onClick={() => { const code = BUILTIN.find((x) => x.id === presetId)?.code() ?? presets?.presets.find((x) => x.id === presetId)?.description ?? ''; if (!desc.trim() || confirmLoad) { setCode(code); setConfirmLoad(false); } else setConfirmLoad(true); }}>
          {confirmLoad ? t('¿Seguro? Se pierde el texto actual') : t('Cargar')}
        </button>
        <button type="button" className="btn small" onClick={() => setNaming(naming === null ? '' : null)}>{t('Guardar como preset…')}</button>
        <button type="button" className="btn small" disabled={(presets?.defaultId ?? 'howler') === presetId} onClick={() => void run(async () => { setPresets(await adminApi.setDefaultSheetPreset(presetId === 'howler' ? null : presetId)); return { ok: true }; }, t('Ese preset se cargará con la descripción vacía.'))}>{t('Usar por defecto')}</button>
        {presets?.presets.some((p) => p.id === presetId) && (
          <button type="button" className="btn small" onClick={() => void run(async () => { const r = await adminApi.deleteSheetPreset(presetId); setPresets(r); setPresetId(r.defaultId ?? 'howler'); return { ok: true }; }, t('Preset borrado.'))}>{t('Borrar')}</button>
        )}
        <button type="button" className="btn small" onClick={() => setCode(`${cleanBbcode(desc)}${desc.trim() ? '\n\n' : ''}${footer()}`)}>{t('Añadir pie de Howler')}</button>
        {naming !== null && (
          <span className="sheet-tpl-name">
            <input type="text" value={naming} maxLength={40} autoFocus placeholder={t('Nombre del preset')} aria-label={t('Nombre del preset')} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('sheet-preset-save')?.click(); }} />
            <button id="sheet-preset-save" type="button" className="btn small primary" disabled={!naming.trim()} onClick={() => void run(async () => { const r = await adminApi.saveSheetPreset(naming, clean); setPresets(r); setPresetId(r.presets.find((p) => p.name.toLowerCase() === naming.trim().replace(/\s+/g, ' ').toLowerCase())?.id ?? presetId); setNaming(null); return { ok: true }; }, t('Preset guardado.'))}>{t('Guardar')}</button>
          </span>
        )}
      </div>

      <div className="sheet-cols">
        <div className="sheet-edit-col">
          <label className="field sheet-title-field">
            <span className="field-label">{t('Título del servidor')}</span>
            <span className="field-control"><input type="text" className="wide" value={title} maxLength={MAX_SHEET_TITLE} onChange={(e) => setTitle(e.target.value)} /></span>
            <span className="field-hint">{t('Admite emojis y símbolos. En la lista de Content Manager se le añade automáticamente un ℹ y el puerto.')}</span>
            {title.includes('[') && <span className="warn field-hint">{t('Cuidado con los corchetes: en la cabecera de la ficha CM los toma por etiquetas y el texto entre corchetes desaparece (en la lista sí se ve). Usa paréntesis, por ejemplo (EU).')}</span>}
          </label>
          <span className="field-label">{t('Descripción')}</span>
          <RichEditor value={desc} loadKey={loadKey} onChange={setDesc} />
        </div>

        <div className="sheet-prev-col">
          <h3 className="sheet-prev-h">{t('Resultado final')}</h3>
          <div className="cm-sheet" aria-label={t('Vista de Content Manager')}>
            <div className="cm-main">
              <div className="cm-head">
                <p className="cm-title-preview" dangerouslySetInnerHTML={{ __html: bbcodeToHtml(title.trim().replace(/\s+/g, ' ') || t('(sin título)')) }} />
                <div className="cm-addr"><span className="cm-badge">Kunos</span><span className="cm-badge cm-badge-ok">↻</span><span className="muted">127.0.0.1:9600</span><span className="cm-ping muted">12 ms</span></div>
              </div>
              {saved.hasPassword && <p className="cm-pass">🔒 {t('Contraseña')}: ●●●●</p>}
              <div className="cm-cards">
                <figure className="cm-card">
                  {entries?.track ? <img src={trackImage(entries.track, entries.layout)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="cm-missing">{t('Circuito')}</div>}
                  <figcaption><span>{trackLabel}</span><i aria-hidden="true">⋮</i></figcaption>
                </figure>
                <figure className="cm-card">
                  {first ? <img src={carImage(first)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="cm-missing">{t('Coche')}</div>}
                  <figcaption><span>{first ? carLabel(first) : t('Coche')}</span><i aria-hidden="true">⋮</i></figcaption>
                </figure>
              </div>
              <dl className="cm-info" aria-label={t('Datos de ejemplo')}>
                <dt>{t('País')}:</dt><dd>{trackInfo?.country ?? '—'}</dd>
                <dt>{t('Clientes')}:</dt><dd>0/{entries?.maxClients ?? 16}</dd>
                <dt>{t('Características CSP')}:</dt><dd>SPECTATING_AWARE,…</dd>
                <dt>{t('Quedan')}:</dt><dd>00:29:53</dd>
                <dt className="cm-gap">{t('Clima')}:</dt><dd className="cm-gap" />
                <dt className="cm-gap">{t('Contactos')}:</dt><dd className="cm-gap">{t('sin límite')}</dd>
                <dt>{t('Aire')}:</dt><dd>20 °C</dd>
                <dt>{t('Viento')}:</dt><dd>0 km/h (N)</dd>
                <dt>{t('Asfalto')}:</dt><dd>26 °C</dd>
                <dt>{t('Agarre')}:</dt><dd>100.0%</dd>
              </dl>
              <div className="cm-final" dangerouslySetInnerHTML={{ __html: bbcodeToHtml(clean) }} />
              <div className="cm-sessions">
                <strong>{t('Sesiones')}:</strong>
                {saved.sessions.map((s, i) => (
                  <p key={s.kind} className={i === 0 ? 'on' : ''}><span>{{ practice: t('Práctica'), qualify: t('Clasificación'), race: t('Carrera') }[s.kind]}</span><span>{s.kind === 'race' && s.laps > 0 ? t('{n} vueltas', { n: s.laps }) : `${s.minutes >= 60 ? `${Math.floor(s.minutes / 60)} h ` : ''}${s.minutes % 60 ? `${s.minutes % 60} min` : ''}`.trim()}</span></p>
                ))}
              </div>
              <p className="cm-empty"><strong>{t('El servidor está vacío')}</strong></p>
            </div>
            <ul className="cm-cars" aria-label={t('Coches del servidor')}>
              {cars.map(([model, n], i) => <li key={model} className={i === 0 ? 'on' : ''}>{carLabel(model)} <span>({n}/{n})</span></li>)}
              {cars.length === 0 && <li className="muted">{t('Sin coches en la lista')}</li>}
            </ul>
            <div className="cm-foot"><span>{t('Refrescar')}</span><span>{t('Favorito')} ▾</span><span>{t('Invitar')} ▾</span><span>{t('Conducir')} ▾</span><span className="muted">{t('Unirse')}</span></div>
          </div>
          <p className="hint">{t('Es una imitación de la ficha de Content Manager con datos de ejemplo; los tamaños y colores exactos pueden variar un poco. Si no ves la descripción en CM, comprueba que el servidor está reiniciado. Un enlace en el título lo pinta CM como enlace.')}</p>
          <p className="hint">{t('Las imágenes solo las dibuja CM si el jugador tiene activada la opción «Load images in server descriptions» (viene activada de serie). Las direcciones sueltas del texto se convierten en enlaces solas.')}</p>
        </div>
      </div>

      <details>
        <summary>{t('Texto con etiquetas (avanzado)')} · {clean.length}/{MAX_SHEET_CHARS}</summary>
        <textarea className="sheet-code" rows={6} value={desc} spellCheck={false} onChange={(e) => setDesc(e.target.value)} onBlur={() => setLoadKey((k) => k + 1)} aria-label={t('Texto con etiquetas (avanzado)')} />
        <p className="hint">{t('Es lo que se guarda: etiquetas de Content Manager [b] [i] [u] [s] [color=#rrggbb] [size=píxeles] [url=…]texto[/url] [img=dirección|tamaño]texto[/img]. Si lo editas aquí, el editor se actualiza al salir.')}</p>
      </details>

      {problems.length > 0 && <ul className="warn">{problems.map((p) => <li key={p}>{tm(p)}</li>)}</ul>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!dirty || problems.length > 0 || !!saved.missing} onClick={() => void save(false)}>{t('Guardar')}</button>
        {running && <button type="button" className="btn" disabled={problems.length > 0 || !!saved.missing} onClick={() => void save(true)}>{t('Guardar y reiniciar el servidor')}</button>}
        {dirty && <button type="button" className="btn" onClick={() => load(saved)}>{t('Descartar cambios')}</button>}
      </div>
      <Notice notice={notice} />
    </div>
  );
}
