import { t, tm } from '../i18n';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminStateDto, ServerState } from '@howler/shared';
import { StatusLight } from '../components/StatusLight';
import { adminApi } from './adminApi';
import { CarChecksumAlert, useCarChecksumProblems } from './CarChecksumAlert';
import { isGoodNews, parseLogLine, type ParsedLine } from './console-lines';
import { ServerDiagnosisAlert, useServerPreflight } from './ServerDiagnosisAlert';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const LABEL: Record<ServerState, string> = {
  stopped: t('Parado'),
  starting: t('Arrancando…'),
  running: t('En marcha'),
  stopping: t('Parándose…'),
};
const LIGHT: Record<ServerState, 'live' | 'wait' | 'down'> = { stopped: 'down', starting: 'wait', running: 'live', stopping: 'wait' };

const LogRow = memo(function LogRow({ p }: { p: ParsedLine }) {
  const cls = `log log-${p.level}${p.cont ? ' log-cont' : ''}${p.level === 'inf' && isGoodNews(p.text) ? ' log-good' : ''}`;
  return (
    <div className={cls}>
      {p.time && <span className="log-time">{p.time} </span>}
      {p.tag && <span className="log-tag">{p.tag} </span>}
      <span className="log-text">{p.text}</span>
    </div>
  );
});

/** Consola del servidor en directo: las últimas líneas y las nuevas según llegan. */
function Console({ active }: { active: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const es = new EventSource('/admin/api/server/logs');
    setLines([]);
    es.onmessage = (m) => setLines((prev) => [...prev.slice(-500), JSON.parse(m.data) as string]);
    return () => es.close();
  }, [active]);

  const parsed = useMemo(() => {
    const out: ParsedLine[] = [];
    for (const l of lines) out.push(parseLogLine(l, out.at(-1)));
    return out;
  }, [lines]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={box}
      role="log"
      className="console"
      aria-label={t('Consola del servidor')}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; // si sube a leer, deja de bajar solo
      }}
    >
      {parsed.length ? parsed.map((p, i) => <LogRow key={i} p={p} />) : t('La consola del servidor aparecerá aquí cuando lo arranques desde Howler.')}
    </div>
  );
}

export function ServerSection({ state, refresh }: { state: AdminStateDto; refresh: () => void }) {
  const { notice, run } = useNotice();
  const s = state.server.state;
  const busy = s === 'starting' || s === 'stopping';
  const players = state.online.length;
  const { problems, reload } = useCarChecksumProblems(s === 'stopped');
  const { preflight, reload: reloadPreflight } = useServerPreflight(s === 'stopped');
  const crashDiagnosis = state.server.lastExit && !state.server.lastExit.expected ? state.server.lastExit.diagnosis : [];
  // Lo que se vio antes de arrancar y lo que dijo la consola en la última caída, sin repetir
  const diagnosis = [...preflight, ...crashDiagnosis.filter((c) => !preflight.some((p) => p.id === c.id))];
  const start = () => run(async () => { await adminApi.start(); refresh(); }, t('Arrancando el servidor…'));

  return (
    <>
      <Card
        title={t('Servidor de Assetto Corsa')}
        aside={state.externalServerRunning
          ? <span className="state-pill"><StatusLight state="live" /> {t('En marcha (no lo arrancó Howler)')}</span>
          : <span className="state-pill"><StatusLight state={LIGHT[s]} /> {LABEL[s]}</span>}
      >
        {state.externalServerRunning && (
          <p className="warn">
            {t('Hay un servidor de AC en marcha que no ha arrancado Howler (por ejemplo desde Content Manager). Mientras esté encendido no se puede arrancar otro, y desde aquí tampoco se puede parar de forma limpia. Páralo donde lo arrancaste, o úsalo siempre desde este panel.')}
          </p>
        )}
        {!state.check.ok && <p className="warn">{t('La carpeta del servidor no es válida:')} {state.check.problems.map(tm).join(' ')} {t('Revísala en Ajustes.')}</p>}
        {state.server.lastExit && !state.server.lastExit.expected && s === 'stopped' && (
          <p className="warn">{t('El servidor se cerró solo (código {code}). Mira las últimas líneas de la consola para ver el motivo.', { code: state.server.lastExit.code ?? '?' })}</p>
        )}

        {s === 'stopped' && <CarChecksumAlert problems={problems} crashHint={crashDiagnosis.some((c) => c.id === 'car-checksums')} onChanged={reload} onStartAnyway={start} />}
        {s === 'stopped' && <ServerDiagnosisAlert items={diagnosis} onChanged={() => { reloadPreflight(); reload(); }} onStartAnyway={start} />}

        <div className="actions">
          <button type="button" className="btn primary" disabled={s !== 'stopped' || state.externalServerRunning || !state.check.ok || problems.length > 0 || preflight.length > 0} onClick={start}>
            {t('Arrancar')}
          </button>
          <ConfirmButton
            label={t('Parar')}
            confirmLabel={players ? (players === 1 ? t('Parar (hay 1 conectado)') : t('Parar (hay {n} conectados)', { n: players })) : t('Confirmar parada')}
            danger
            disabled={s === 'stopped' || busy}
            onConfirm={() => run(async () => { await adminApi.stop(); refresh(); }, players ? t('Avisando a los jugadores y parando en {n} s…', { n: state.settings.server.stopWarningSeconds }) : t('Parando el servidor…'))}
          />
          <ConfirmButton
            label={t('Reiniciar')}
            confirmLabel={t('Confirmar reinicio')}
            disabled={s === 'stopped' || busy}
            onConfirm={() => run(async () => { await adminApi.restart(); refresh(); }, t('Reiniciando el servidor…'))}
          />
        </div>
        <Notice notice={notice} />

        {state.server.inviteLink && s !== 'stopped' && (
          <div className="invite-row">
            <button type="button" className="btn primary" title={t('Abre Content Manager (o el navegador) para entrar a tu servidor')} onClick={() => run(async () => { await adminApi.connectToServer(); }, t('Abriendo el enlace: Content Manager debería ofrecer entrar al servidor.'))}>{t('Conectar')}</button>
            <label>{t('Enlace de invitación')}
              <input type="text" readOnly value={state.server.inviteLink} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <button type="button" className="btn" onClick={() => run(async () => { await navigator.clipboard.writeText(state.server.inviteLink!); }, t('Enlace copiado: pégalo en Discord o WhatsApp.'))}>{t('Copiar')}</button>
          </div>
        )}

        <p className="hint">
          {t('Para que todo quede bien guardado, para el servidor siempre con este botón, y no cerrando Content Manager ni la ventana del servidor. Aquí se avisa a los jugadores y el servidor se cierra de forma limpia.')}
          {!state.pluginAlive && s === 'running' && ` ${t('Ojo: el plugin de Howler no está activo en el servidor, así que la parada será forzada.')}`}
        </p>
      </Card>

      <Card title={t('Consola')}>
        <Console active={s !== 'stopped'} />
      </Card>
    </>
  );
}
