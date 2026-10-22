import { LANGS, type UpdateStateDto } from '@howler/shared';
import { UpdatesCard } from './UpdatesCard';
import { WebDisplayCard } from './WebDisplayCard';
import { SoundsCard } from './SoundsCard';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { AdminStateDto, ServerDirCheckDto } from '@howler/shared';
import { adminApi } from './adminApi';
import { Card, Field, Notice, useNotice } from './ui';

/** Ajustes de Howler: dónde está el servidor, cómo arrancarlo y los puertos. */
export function SettingsSection({ state, refresh, update, onUpdate }: { state: AdminStateDto; refresh: () => void; update: UpdateStateDto | null; onUpdate: (s: UpdateStateDto) => void }) {
  const { notice, show, run } = useNotice();
  const cur = state.settings;
  const [dir, setDir] = useState(cur.serverDir);
  const [check, setCheck] = useState<ServerDirCheckDto>(state.check);
  const [found, setFound] = useState<{ dir: string; check: ServerDirCheckDto }[] | null>(null);
  const [exe, setExe] = useState(cur.server.exe);
  const [preset, setPreset] = useState(cur.server.preset);
  const [auto, setAuto] = useState(cur.server.startWithHowler);
  const [warn, setWarn] = useState(cur.server.stopWarningSeconds);
  const [language, setLanguage] = useState(cur.language);
  const [httpPort, setHttpPort] = useState(cur.http.port);
  const [adminPort, setAdminPort] = useState(cur.admin.port);
  const [pluginPort, setPluginPort] = useState(cur.acsp.pluginPort);
  const [cmdPort, setCmdPort] = useState(cur.acsp.pluginCommandPort);
  const [forward, setForward] = useState((cur.acsp.forward ?? []).join(', '));

  // Comprueba la carpeta mientras se escribe (con una pequeña espera para no preguntar en cada letra).
  useEffect(() => {
    if (dir === cur.serverDir) { setCheck(state.check); return; }
    const timer = window.setTimeout(() => { adminApi.check(dir).then(setCheck, () => undefined); }, 400);
    return () => window.clearTimeout(timer);
  }, [dir, cur.serverDir, state.check]);

  const running = state.server.state !== 'stopped';

  const save = () =>
    run(async () => {
      const r = await adminApi.saveSettings({
        serverDir: dir,
        http: { port: httpPort },
        admin: { port: adminPort },
        server: { exe, preset, startWithHowler: auto, stopWarningSeconds: warn },
        acsp: { pluginPort, pluginCommandPort: cmdPort, forward: forward.split(/[\s,;]+/).filter(Boolean).map(Number) },
        language,
      });
      refresh();
      return { ok: true, reply: r.restartRequired.length ? t('Hay que reiniciar Howler para aplicar: {list}.', { list: r.restartRequired.join(', ') }) : undefined };
    }, t('Ajustes guardados'));

  return (
    <>
      {update && <UpdatesCard s={update} onChange={onUpdate} />}
      <Card title={t('Carpeta del servidor de Assetto Corsa')}>
        <Field label={t('Carpeta')} hint={t('La que contiene acServer.exe y la carpeta presets.')}>
          <input type="text" className="wide" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
          <button
            type="button"
            className="btn"
            onClick={() => adminApi.detect().then((r) => { setFound(r); if (!r.length) show(false, t('No he encontrado ningún servidor de AC en este PC. Escribe la carpeta a mano.')); }, (e: Error) => show(false, e.message))}
          >
            {t('Buscar automáticamente')}
          </button>
        </Field>
        {found && found.length > 0 && (
          <ul className="found">
            {found.map((f) => (
              <li key={f.dir}>
                <code>{f.dir}</code>
                <button type="button" className="btn small" onClick={() => { setDir(f.dir); setFound(null); if (f.check.presets.length && !f.check.presets.includes(preset)) setPreset(f.check.presets[0]!); }}>{t('Usar esta')}</button>
              </li>
            ))}
          </ul>
        )}
        <ul className="checks">
          <li className={check.exe ? 'ok' : 'bad'}>{check.exe ? t('Servidor encontrado ({exe})', { exe: check.exe }) : t('No encuentro el servidor en esa carpeta')}</li>
          <li className={check.presets.length ? 'ok' : 'bad'}>{check.presets.length ? t('Presets: {list}', { list: check.presets.join(', ') }) : t('No hay presets')}</li>
          <li className={check.hasPlugin ? 'ok' : 'bad'}>{check.hasPlugin ? t('Plugin de Howler instalado') : t('Falta el plugin de Howler: sectores estimados y sin control de hora/clima')}</li>
          <li className={check.tracksDir ? 'ok' : 'bad'}>{check.tracksDir ? t('Circuitos de AC encontrados (mapas y sectores automáticos)') : t('No encuentro los circuitos de AC: no habrá mapa')}</li>
        </ul>
      </Card>

      <Card title={t('Arranque')}>
        <Field label="Preset" hint={t('El que usa Content Manager. Es la configuración con la que arranca el servidor.')}>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {!check.presets.includes(preset) && <option value={preset}>{preset || '(cfg/)'}</option>}
            {check.presets.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label={t('Ejecutable')} hint={t('Normalmente acServer.exe.')}>
          <input type="text" value={exe} onChange={(e) => setExe(e.target.value)} spellCheck={false} />
        </Field>
        <Field label={t('Arrancar el servidor al abrir Howler')}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        </Field>
        <Field label={t('Aviso antes de parar (segundos)')} hint={t('Si hay jugadores conectados, se les avisa por el chat y se espera este tiempo antes de parar o reiniciar.')}>
          <input type="number" min={0} max={300} value={warn} onChange={(e) => setWarn(Number(e.target.value))} />
        </Field>
      </Card>

      <WebDisplayCard />

      <SoundsCard />

      <Card title={t('Idioma de los mensajes del servidor')}>
        <Field label={t('Idioma de los mensajes del servidor')} hint={t('Es el idioma del chat del servidor, de los avisos de Discord y de los motivos que Howler escribe por su cuenta. La web y este panel usan el idioma que elija cada persona con el selector «Idioma de la interfaz» de arriba.')}>
          <select value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Field>
      </Card>

      <Card title={t('Puertos')}>
        <p className="hint">{t('Un cambio de puertos necesita reiniciar Howler. Para que los amigos entren a la web desde fuera, el puerto de la web pública tiene que estar abierto en el router y en el firewall de Windows.')}</p>
        <Field label={t('Web pública (para los amigos)')} hint={t('Por defecto 8420: poco usado, para no chocar con otros servicios.')}>
          <input type="number" min={1024} max={65535} value={httpPort} onChange={(e) => setHttpPort(Number(e.target.value))} />
        </Field>
        <Field label={t('Panel de control (solo este PC)')} hint={t('Solo escucha en 127.0.0.1: no hace falta abrirlo en el router.')}>
          <input type="number" min={1024} max={65535} value={adminPort} onChange={(e) => setAdminPort(Number(e.target.value))} />
        </Field>
        <Field label={t('Sectores del plugin')} hint={t('Debe coincidir con Port en plugin_howler_cfg.yml.')}>
          <input type="number" min={1024} max={65535} value={pluginPort} onChange={(e) => setPluginPort(Number(e.target.value))} />
        </Field>
        <Field label={t('Órdenes al plugin')} hint={t('Debe coincidir con CommandPort en plugin_howler_cfg.yml. 0 = desactivado.')}>
          <input type="number" min={0} max={65535} value={cmdPort} onChange={(e) => setCmdPort(Number(e.target.value))} />
        </Field>
        <Field label={t('Compartir con otros plugins de AC')} hint={t('El servidor solo manda su interfaz UDP a un programa. Si usas otro (penalizaciones, por ejemplo), pon en el server_cfg.ini el puerto de Howler y aquí el puerto en el que escucha ese otro programa (varios separados por comas): Howler le copia todo y le devuelve al servidor lo que conteste. Vacío = ninguno.')}>
          <input type="text" value={forward} onChange={(e) => setForward(e.target.value)} placeholder="12001" spellCheck={false} />
        </Field>
      </Card>

      <div className="actions">
        <button type="button" className="btn primary" onClick={save}>{t('Guardar ajustes')}</button>
        {running && <span className="muted">{t('El servidor está en marcha: los cambios de carpeta, preset y ejecutable se aplicarán la próxima vez que lo arranques.')}</span>}
      </div>
      <Notice notice={notice} />
    </>
  );
}
