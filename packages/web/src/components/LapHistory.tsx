import { speedValue, tempValue, tempUnit } from '../prefs';
import { useMemo, useState } from 'react';
import { formatAids, formatDelta, formatLapTime, type SessionLapDto } from '@howler/shared';
import { api, useLive } from '../api';
import { clock } from '../format';
import { t, tm } from '../i18n';

const W = 800, H = 210, PAD = { l: 56, r: 16, t: 32, b: 26 };
const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;

/**
 * Evolución de un piloto en una sesión: gráfica de sus tiempos (más rápido arriba, así «mejorar» es subir) y la
 * lista de vueltas, que se desplaza dentro de su caja para que 100 vueltas no alarguen la página.
 * Las vueltas anuladas no entran en la escala: salen como marcas rojas en el eje, y están en la lista.
 */
export function LapHistory({ sessionId, driverId }: { sessionId: number; driverId: number }) {
  const { data, error } = useLive(
    () => api.sessionLaps(sessionId, driverId),
    [sessionId, driverId],
    (e) => e.type === 'results' || (e.type === 'lap' && e.sessionId === sessionId && e.driverId === driverId),
  );
  const [view, setView] = useState<'all' | 'best'>('all');

  if (error && !data) return <p className="empty">{t('No se pudo cargar el historial.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  if (data.length === 0) return <p className="empty">{t('Todavía no ha completado ninguna vuelta en esta sesión.')}</p>;

  // Las salidas de boxes no cuentan para la escala, la mejor vuelta ni la gráfica: su tiempo incluye salir de boxes.
  const valid = data.filter((l) => l.valid && !l.outLap);
  const outLaps = data.filter((l) => l.outLap).length;
  const pendingLaps = data.filter((l) => l.pending).length;
  const best = valid.length ? Math.min(...valid.map((l) => l.lapMs)) : null;
  const rows = view === 'best' ? [...valid].sort((a, b) => a.lapMs - b.lapMs).slice(0, 10) : data;
  const hasSectors = data.some((l) => l.sectorsMs.length > 0);
  const hasTemps = data.some((l) => l.tempAir != null || l.tempTrack != null);
  const hasAids = data.some((l) => formatAids(l.aids).length > 0);
  const sectorCount = Math.max(0, ...data.map((l) => l.sectorsMs.length));

  return (
    <div className="lap-history">
      {valid.length >= 2 ? <LapChart laps={data} best={best!} /> : (
        <p className="lap-history-note">{valid.length === 0 ? t('Todas sus vueltas están anuladas.') : t('La gráfica aparece a partir de la segunda vuelta válida.')}</p>
      )}
      <div className="lap-list-bar">
        <span className="muted">{data.length === 1 ? t('1 vuelta') : t('{n} vueltas', { n: data.length })}{data.some((l) => !l.valid && !l.pending) ? ` (${t('{n} anuladas', { n: data.filter((l) => !l.valid && !l.pending).length })})` : ''}{pendingLaps > 0 ? ` · ${pendingLaps === 1 ? t('1 pendiente de revisión') : t('{n} pendientes de revisión', { n: pendingLaps })}` : ''}{outLaps > 0 ? ` · ${outLaps === 1 ? t('1 salida de boxes') : t('{n} salidas de boxes', { n: outLaps })}` : ''}</span>
        {valid.length > 10 && (
          <span className="segmented" role="group" aria-label={t('Qué vueltas mostrar')}>
            <button type="button" className={view === 'all' ? 'on' : ''} aria-pressed={view === 'all'} onClick={() => setView('all')}>{t('Todas')}</button>
            <button type="button" className={view === 'best' ? 'on' : ''} aria-pressed={view === 'best'} onClick={() => setView('best')}>{t('Mejores 10')}</button>
          </span>
        )}
      </div>
      <div className="lap-list" tabIndex={0} aria-label={t('Lista de vueltas')}>
        <table className="timing lap-table">
          <thead>
            <tr>
              <th className="num">{t('Vuelta')}</th><th className="num">{t('Tiempo')}</th><th className="num">{t('Dif.')}</th>
              {hasSectors && Array.from({ length: sectorCount }, (_, i) => <th key={i} className="num sector-col">S{i + 1}</th>)}
              <th className="num">{t('V. máx.')}</th>
              {hasTemps && <th className="num" title={t('Temperatura del aire / de la pista')}>{t('Temp.')}</th>}
              {hasAids && <th>{t('Ayudas')}</th>}
              <th className="num">{t('Hora')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.lapId} className={`${l.valid ? '' : l.pending ? 'pending' : 'void'} ${l.outLap ? 'outlap' : ''} ${l.valid && !l.outLap && l.lapMs === best ? 'is-best' : ''}`}>
                <td className="num muted">{l.lapNo}</td>
                <td className="num lap-time" title={l.valid ? undefined : `${t('Anulada')}${l.invalidReason ? `: ${tm(l.invalidReason)}` : ''}`}>{formatLapTime(l.lapMs)}</td>
                <td className="num muted">{l.pending ? <span className="badge pending" title={t('Salida de boxes pendiente de revisión: no cuenta en tiempos ni récords hasta que el administrador la apruebe.')}>{t('pendiente de revisión')}</span> : l.outLap ? <span className="badge" title={t('No empezó en la línea de meta: su tiempo incluye salir de boxes o volver tras un reinicio. No cuenta en medias ni en la gráfica.')}>{t('salida de boxes')}</span> : l.valid && best != null && l.lapMs !== best ? formatDelta(l.lapMs - best) : l.valid ? '' : t('anulada')}</td>
                {hasSectors && Array.from({ length: sectorCount }, (_, i) => <td key={i} className="num sector sector-col">{formatLapTime(l.sectorsMs[i] ?? null)}</td>)}
                <td className="num muted">{l.maxSpeedKmh != null ? Math.round(speedValue(l.maxSpeedKmh)) : '—'}</td>
                {hasTemps && <td className="num muted">{l.tempAir != null || l.tempTrack != null ? `${l.tempAir != null ? tempValue(l.tempAir) : '—'} / ${l.tempTrack != null ? tempValue(l.tempTrack) : '—'} ${tempUnit()}` : '—'}</td>}
                {hasAids && <td className="muted aids-cell">{formatAids(l.aids).map(tm).join(', ') || '—'}</td>}
                <td className="num muted">{clock(l.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Gráfica de líneas de una serie (sin leyenda: el título la nombra). Cursor con etiqueta al pasar el ratón. */
function LapChart({ laps, best }: { laps: SessionLapDto[]; best: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = useMemo(() => laps.filter((l) => l.valid && !l.outLap), [laps]);

  // Escala: de la mejor vuelta a la peor, pero una vuelta muy lenta (salida de pista, boxes) no aplasta el resto.
  const worst = Math.max(...valid.map((l) => l.lapMs));
  const top = best, bottom = Math.min(worst, best * 1.15);
  const span = Math.max(bottom - top, 500);
  const n = laps.length;
  const x = (lapNo: number) => PAD.l + (n === 1 ? plotW / 2 : ((lapNo - 1) / (n - 1)) * plotW);
  const y = (ms: number) => PAD.t + (Math.min(ms, top + span) - top) / span * plotH; // más rápido = más arriba
  const clipped = (ms: number) => ms > top + span;

  // Mejores personales sucesivos: puntos verdes en las vueltas donde mejoró su propio tiempo.
  const improved = new Set<number>();
  let run = Infinity;
  for (const l of valid) if (l.lapMs < run) { run = l.lapMs; improved.add(l.lapNo); }

  const path = valid.map((l, i) => `${i ? 'L' : 'M'}${x(l.lapNo).toFixed(1)},${y(l.lapMs).toFixed(1)}`).join(' ');
  const gridTimes = [top, top + span / 2, top + span];
  const ticks = n <= 12 ? laps.map((l) => l.lapNo) : [1, ...Array.from({ length: 4 }, (_, i) => Math.round(1 + ((i + 1) * (n - 1)) / 5)), n];
  const hv = hover != null ? laps[hover] : null;

  return (
    <div className="lap-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t('Evolución de los tiempos: de {a} a {b} en {n} vueltas', { a: formatLapTime(valid[0]!.lapMs), b: formatLapTime(best), n })}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / plotW) * (n - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {gridTimes.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="chart-grid" />
            <text x={PAD.l - 8} y={y(g) + 4} textAnchor="end" className="chart-axis">{formatLapTime(Math.round(g))}</text>
          </g>
        ))}
        {ticks.map((k) => <text key={k} x={x(k)} y={H - 6} textAnchor="middle" className="chart-axis">{k}</text>)}
        <text x={PAD.l} y={11} className="chart-axis">{t('más rápido ↑')}</text>

        <path d={path} className="chart-line" />

        {laps.filter((l) => l.outLap).map((l) => (
          <circle key={l.lapId} cx={x(l.lapNo)} cy={H - PAD.b - 4} r={3} className="chart-out" />
        ))}
        {laps.filter((l) => !l.valid && !l.outLap).map((l) => (
          <path key={l.lapId} d={`M${x(l.lapNo) - 4},${H - PAD.b - 8} l8,8 m0,-8 l-8,8`} className="chart-void" />
        ))}
        {valid.filter((l) => improved.has(l.lapNo) && l.lapMs !== best).map((l) => (
          <circle key={l.lapId} cx={x(l.lapNo)} cy={y(l.lapMs)} r={3} className="chart-dot" />
        ))}
        {valid.filter((l) => l.lapMs === best).slice(0, 1).map((l) => (
          <g key={l.lapId}>
            <circle cx={x(l.lapNo)} cy={y(l.lapMs)} r={5} className="chart-dot best" />
            <text x={x(l.lapNo) + (l.lapNo > n * 0.8 ? -10 : 10)} y={y(l.lapMs) + 4} textAnchor={l.lapNo > n * 0.8 ? 'end' : 'start'} className="chart-label">{formatLapTime(best)}</text>
          </g>
        ))}

        {hv && (
          <g pointerEvents="none">
            <line x1={x(hv.lapNo)} x2={x(hv.lapNo)} y1={PAD.t} y2={H - PAD.b} className="chart-cursor" />
            {hv.valid && !hv.outLap && <circle cx={x(hv.lapNo)} cy={y(hv.lapMs)} r={5} className={clipped(hv.lapMs) ? 'chart-ring clipped' : 'chart-ring'} />}
          </g>
        )}
      </svg>
      {hv && (
        <div className="chart-tip" style={{ left: `${(x(hv.lapNo) / W) * 100}%` }} role="status">
          <strong>{t('Vuelta {n}', { n: hv.lapNo })}</strong> · {formatLapTime(hv.lapMs)}
          <span className="muted">{hv.outLap ? ` · ${t('salida de boxes')}` : hv.valid ? (hv.lapMs === best ? ` · ${t('su mejor')}` : ` · ${formatDelta(hv.lapMs - best)}`) : ` · ${t('anulada')}${hv.invalidReason ? ` (${tm(hv.invalidReason)})` : ''}`}</span>
        </div>
      )}
    </div>
  );
}
