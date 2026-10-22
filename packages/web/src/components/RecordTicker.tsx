import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatLapTime, type RecordDto } from '@howler/shared';
import { api, useLive } from '../api';
import { useContentNames } from '../content';
import { t } from '../i18n';

/** La tira de «nuevo récord» se ve este tiempo (ms) desde que ocurre el récord, y luego desaparece. */
export const TICKER_MS = 20_000;

/**
 * Cuándo empezó a contar la tira (hora de este navegador) o null si no hay que enseñarla.
 * - Al abrir la página (`first`): solo si el récord acaba de ocurrir (menos de `TICKER_MS`); cuenta desde que ocurrió.
 * - Con la página abierta: si llega un récord distinto (`changed`), empieza ahora. No depende de que el reloj del servidor y el del
 *   navegador vayan a la par.
 * - La primera vuelta de una combinación (sin tiempo anterior) no es un récord que anunciar.
 */
export function tickerStart(first: boolean, changed: boolean, ageMs: number, hasPrevious: boolean, now: number): number | null {
  if (!hasPrevious) return null;
  if (first) return ageMs >= 0 && ageMs < TICKER_MS ? now - ageMs : null;
  return changed ? now : null;
}

/** Texto troceado en caracteres para animarlos uno a uno (`--i` = orden, para el escalonado). Solo decorativo: el lector lee el `aria-label`. */
function Kinetic({ text, from = 0 }: { text: string; from?: number }) {
  return <>{[...text].map((ch, i) => <span key={i} className="kin-ch" style={{ '--i': from + i } as CSSProperties}><span>{ch === ' ' ? ' ' : ch}</span></span>)}</>;
}

/** Solo en desarrollo: `?ticker=demo` en la dirección enseña un récord inventado, de nuevo cada `TICKER_MS` + 4 s, sin esperar a uno real. */
const DEMO: RecordDto = { lapId: 0, driverId: 0, driverName: 'Marc', track: 'demo', layout: '', car: 'demo', lapMs: 83_456, previousMs: 83_777, previousDriverName: 'Lucía', at: '' };
const demoOn = () => import.meta.env.DEV && new URLSearchParams(location.search).get('ticker') === 'demo';

export function RecordTicker() {
  const { carName, trackName } = useContentNames();
  const { data: live } = useLive(() => api.latestRecords(1), [], (e) => e.type === 'lap' || e.type === 'results');
  const [demoTick, setDemoTick] = useState(0);
  useEffect(() => {
    if (!demoOn()) return;
    const id = setInterval(() => setDemoTick((n) => n + 1), TICKER_MS + 4_000);
    return () => clearInterval(id);
  }, []);
  const demo = demoOn();
  const demoRecord = useMemo(() => ({ ...DEMO, at: new Date().toISOString() }), [demoTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = demo ? [demoRecord] : live;
  const r = data?.[0];
  const key = r ? `${r.at}|${r.driverName}|${r.lapMs}|${r.track}|${r.layout}|${r.car}` : null;
  const seen = useRef<string | null | undefined>(undefined); // undefined = aún no se ha cargado nada
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    const first = seen.current === undefined;
    const changed = !first && key !== seen.current;
    seen.current = key;
    if (!r) return;
    const start = tickerStart(first, changed, Date.now() - new Date(r.at).getTime(), r.previousMs != null, Date.now());
    if (start != null) setStartedAt(start);
  }, [key, data === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pasado el tiempo, la tira se quita sola.
  useEffect(() => {
    if (startedAt == null) return;
    const id = setTimeout(() => setStartedAt(null), Math.max(0, TICKER_MS - (Date.now() - startedAt)));
    return () => clearTimeout(id);
  }, [startedAt]);

  const left = useMemo(() => (startedAt == null ? 0 : Math.max(0, TICKER_MS - (Date.now() - startedAt))), [startedAt]);
  if (!r || startedAt == null) return null;
  const where = demo ? 'Circuito' : trackName(r.track, r.layout);
  const what = demo ? 'Coche' : carName(r.car);
  // `key` = momento de inicio: un récord nuevo reinicia la animación de entrada y la de salida.
  return <RecordBand key={startedAt} r={r} where={where} what={what} left={left} />;
}

/** La banda en sí (sin lógica de cuándo salir): la usa la tira real y la muestra de los ajustes de color. `left` = ms hasta que se retira. */
export function RecordBand({ r, where, what, left, style }: { r: Pick<RecordDto, 'driverName' | 'lapMs' | 'previousMs' | 'previousDriverName'>; where: string; what: string; left: number; style?: CSSProperties }) {
  const title = t('NUEVO RÉCORD');
  const words = title.split(' ');
  const time = formatLapTime(r.lapMs);
  const gain = r.previousMs != null ? ((r.previousMs - r.lapMs) / 1000).toFixed(3) : null;
  const items = [r.driverName, where, what, ...(r.previousDriverName && gain ? [t('Sustituye a {name} · −{gain} s', { name: r.previousDriverName, gain })] : [])];
  const text = `${title} · ${time} · ${items.join(' · ')}`;
  return (
    <div className="record-ticker" role="status" aria-label={text} style={{ ...style, '--ticker-left': `${left}ms` } as CSSProperties}>
      <div className="rt-head" aria-hidden="true">
        <span className="rt-title">{words.map((w, n) => <span className="rt-word" key={n}><Kinetic text={w} from={words.slice(0, n).join('').length} /></span>)}</span>
        <span className="rt-time"><Kinetic text={time} from={words.join('').length} /></span>
      </div>
      <div className="rt-run" aria-hidden="true">
        <div className="rt-track">
          {[0, 1].map((k) => <span className="rt-half" key={k}>{[0, 1, 2].map((j) => <span className="rt-set" key={j}>{items.map((x, n) => <span key={n}>{x}</span>)}</span>)}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Récord de ejemplo para enseñar la banda sin esperar a uno real. */
export const SAMPLE_RECORD = DEMO;
