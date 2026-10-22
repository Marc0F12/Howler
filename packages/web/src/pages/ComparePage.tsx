import { speedText, speedValue, speedUnit } from '../prefs';
import { useEffect, useMemo, useState } from 'react';
import { formatDelta, formatLapTime, type MapInfoDto, type ReplayLapDto } from '@howler/shared';
import { api } from '../api';
import { t } from '../i18n';
import { CompareChart, type CompareSeries, type CurveBand } from '../components/CompareChart';
import { followView, fullView, zoomView, type View } from '../components/chart-zoom';
import { compareLaps, gripPct, indexAtTime } from '../components/compare-math';
import { cornerStats, detectCorners, extremeCorner } from '../components/compare-corners';
import { CompareCorners } from '../components/CompareCorners';
import { CarLink, DriverLink } from '../components/links';
import { CompareMap } from '../components/CompareMap';
import { CompareReadout } from '../components/CompareReadout';
import { ForcesChart } from '../components/ForcesChart';
import { CompareTyres } from '../components/CompareTyres';
import { OrderedCharts } from '../components/ChartOrder';
import { useChartOrder } from '../hooks/useChartOrder';
import { Section } from '../components/profile-parts';
import { useContentNames } from '../content';

/** Dos colores fijos (cian y amarillo, un tercero rosa) por orden de tiempo, repetidos en tarjeta, curvas, mapa y lectura, y un trazo distinto para cada una, por si no se distinguen los colores. */
const SLOT = ['var(--lap-1)', 'var(--lap-2)', 'var(--lap-3)'] as const;
const DASH = [undefined, '7 4', '2 4'] as const;

/** Gráficas que se pueden mostrar u ocultar; lo elegido se recuerda en este navegador. */
const CHANNELS = ['delta', 'speed', 'gas', 'brake', 'steer', 'gear', 'rpm', 'slip', 'glat', 'glon', 'tyres'] as const;
type Channel = (typeof CHANNELS)[number];
const DEFAULT_SHOW: Record<Channel, boolean> = { delta: true, speed: true, gas: true, brake: true, steer: false, gear: false, rpm: false, slip: false, glat: false, glon: false, tyres: false };
const SHOW_KEY = 'howler.compare.channels';
/** Orden por defecto de las gráficas; cada visitante puede cambiarlo con las flechas de cada gráfica. */
const ORDER_DEFAULT = ['delta', 'speed', 'gas', 'brake', 'steer', 'gear', 'rpm', 'slip', 'glat', 'glon', 'tyres'] as const;
const loadShow = (): Record<Channel, boolean> => {
  try { return { ...DEFAULT_SHOW, ...(JSON.parse(localStorage.getItem(SHOW_KEY) ?? '{}') as Partial<Record<Channel, boolean>>) }; } catch { return DEFAULT_SHOW; }
};

/**
 * Comparador de vueltas: la mejor vuelta de 2 o 3 pilotos superpuestas por distancia recorrida. Resumen arriba; a la izquierda
 * (fijos al desplazar) las vueltas, el mapa con las curvas numeradas y la lectura del cursor; a la derecha las gráficas
 * (la diferencia de tiempo primero) con zoom y cursor compartidos, y debajo la tabla curva a curva y los sectores.
 */
export function ComparePage({ track, layout, picks }: { track: string; layout: string; picks: string[] }) {
  const { carName, trackName } = useContentNames();
  const [data, setData] = useState<{ map: MapInfoDto | null; laps: ReplayLapDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [show, setShow] = useState(loadShow);
  const chartOrder = useChartOrder('howler.compare.order', ORDER_DEFAULT);
  // Reproducción (los «fantasmas» dentro del comparador): `clock` son los ms desde la salida; 0 = sin reproducir.
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setClock(0);
    setPlaying(false);
    Promise.all([
      fetch(`/api/map?${new URLSearchParams({ track, layout })}`).then((r) => (r.ok ? (r.json() as Promise<MapInfoDto>) : null)),
      api.compare(track, layout, picks),
    ]).then(
      ([map, replay]) => { if (!cancelled) setData({ map, laps: replay.laps }); },
      () => { if (!cancelled) setError(t('No hay vueltas válidas que comparar con esa selección.')); },
    );
    return () => { cancelled = true; };
  }, [track, layout, picks.join('/')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Las vueltas con trayectoria, de más rápida a más lenta: ese orden decide el color y el trazo de cada una.
  const usable = useMemo(
    () => (data?.laps ?? []).filter((l) => l.trace && l.trace.t.length > 1).sort((a, b) => a.lapMs - b.lapMs),
    [data],
  );
  const missing = (data?.laps ?? []).filter((l) => !l.trace || l.trace.t.length < 2);
  const cmp = useMemo(() => (usable.length >= 2 ? compareLaps(usable.map((l) => ({ trace: l.trace!, lapMs: l.lapMs }))) : null), [usable]);
  const corners = useMemo(() => (cmp ? detectCorners(cmp.speed[cmp.ref]!, cmp.laps[cmp.ref]!.lengthM) : []), [cmp]);
  const stats = useMemo(() => (cmp ? cornerStats(cmp, corners) : []), [cmp, corners]);
  const endMs = cmp ? Math.max(...usable.map((l) => l.lapMs)) + 1500 : 0;
  // Con zoom, las gráficas siguen al coche que va primero mientras se reproduce (si el puntero no está sobre ellas).
  useEffect(() => {
    if (!cmp || clock <= 0 || view == null || hover != null) return;
    const lead = Math.max(...cmp.laps.map((l) => indexAtTime(l.t, clock)));
    const next = followView(view, cmp.speed[0]!.length, lead);
    if (next) setView(next);
  }, [clock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || !cmp) return;
    const id = setInterval(() => setClock((c) => { const n = c + 50 * speed; if (n >= endMs) { setPlaying(false); return endMs; } return n; }), 50);
    return () => clearInterval(id);
  }, [playing, cmp, speed, endMs]);
  // Barra espaciadora = reproducir / pausa (salvo si se está escribiendo o hay un botón enfocado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== ' ' || !cmp || (el && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName))) return;
      e.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmp]);

  // Etiqueta de cada vuelta: el piloto, y con el coche si el mismo piloto sale dos veces.
  const labels = usable.map((l) => (usable.filter((o) => o.driverId === l.driverId).length > 1 ? `${l.driverName} · ${carName(l.car)}` : l.driverName));
  const title = trackName(track, layout);
  const back = <a className="more" href="#/records">← {t('Volver a los tiempos')}</a>;

  if (error) return <section className="panel"><div className="panel-head"><h2>{t('Comparar vueltas')}</h2>{back}</div><p className="empty">{error}</p></section>;
  if (!data) return <p className="empty">{t('Cargando las vueltas…')}</p>;

  const nPoints = cmp ? cmp.speed[0]!.length : 0;
  const chartView: View = view ?? fullView(nPoints);
  const zoomed = view != null && chartView[1] - chartView[0] < nPoints - 1 - 1e-6;
  const best = usable[0]?.lapMs ?? 0;
  const sectorCount = Math.max(0, ...data.laps.map((l) => l.sectorsMs.length));
  const bestSector = Array.from({ length: sectorCount }, (_, i) => Math.min(...data.laps.map((l) => l.sectorsMs[i] ?? Infinity)));
  const optimal = sectorCount > 0 && bestSector.every(Number.isFinite) ? bestSector.reduce((a, b) => a + b, 0) : null;
  const colors = usable.map((_, i) => SLOT[i]!);

  const lengthM = cmp ? cmp.laps[cmp.ref]!.lengthM : 0;
  const speedSeries: CompareSeries[] = cmp ? usable.map((_, i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: cmp.speed[i]! })) : [];
  const channel = (values: number[][] | undefined): CompareSeries[] =>
    values ? usable.map((_, i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: values[i]!.map((v) => v * 100) })) : [];
  const pct = (v: number) => `${Math.round(v)} %`;
  const plain = (values: number[][] | undefined, f: (v: number) => number = (v) => v): CompareSeries[] =>
    values ? usable.map((_, i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: values[i]!.map(f) })) : [];
  const bands: CurveBand[] = corners.map((c) => ({ i0: c.i0, i1: c.i1, label: String(c.n), hot: hot === c.n }));

  // Diferencia de tiempo: «arriba» = la vuelta más rápida va por delante. Con dos vueltas, relleno del color de quien va por delante.
  const two = usable.length === 2;
  const sec = (ms: number) => `${ms >= 0 ? '+' : '−'}${Math.abs(ms / 1000).toFixed(3)} s`;
  const deltaSeries: CompareSeries[] = !cmp ? [] : two
    ? [{ label: t('Diferencia'), color: 'var(--text)', values: cmp.deltaMs[1 - cmp.ref]!.map((d) => d / 1000) }]
    : usable.map((_, i) => i).filter((i) => i !== cmp.ref).map((i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: cmp.deltaMs[i]!.map((d) => d / 1000) }));
  const deltaRead = (i: number) => (two ? `${cmp!.deltaMs[1 - cmp!.ref]![i]! >= 0 ? labels[cmp!.ref] : labels[1 - cmp!.ref]} ${sec(Math.abs(cmp!.deltaMs[1 - cmp!.ref]![i]!))}` : '');

  const available: Channel[] = CHANNELS.filter((c) => (c === 'gas' || c === 'brake' || c === 'steer' ? !!cmp?.gas : c === 'slip' ? !!cmp?.slip : c === 'glat' || c === 'glon' ? !!cmp?.latG : c === 'tyres' ? !!(cmp?.temp && cmp?.pres) : true));
  const chLabel: Record<Channel, string> = { delta: t('Diferencia'), speed: t('Velocidad'), gas: t('Acelerador'), brake: t('Freno'), steer: t('Volante'), gear: t('Marcha'), rpm: t('Revoluciones'), slip: t('Agarre'), glat: t('G lateral'), glon: t('G longitudinal'), tyres: t('Neumáticos') };
  const toggle = (c: Channel) => setShow((s) => { const n = { ...s, [c]: !s[c] }; try { localStorage.setItem(SHOW_KEY, JSON.stringify(n)); } catch { /* sin almacenamiento */ } return n; });
  // Punto en que va cada vuelta en la reproducción (null = sin reproducir).
  const playIdx = cmp && clock > 0 ? cmp.laps.map((l) => indexAtTime(l.t, clock)) : null;
  const common = { lengthM, hover, onHover: setHover, view: chartView, onView: setView, bands, cursors: playIdx ?? undefined } as const;
  const deltaCursors = playIdx && cmp ? (two ? [Math.max(...playIdx)] : usable.map((_, i) => i).filter((i) => i !== cmp.ref).map((i) => playIdx[i]!)) : undefined;
  const togglePlay = () => { if (clock >= endMs) setClock(0); setPlaying((p) => !p); };
  const anyOn = (v?: number[][]) => !!v && v.some((a) => a.some((x) => x > 0.5));


  // Resumen: quién gana y dónde se pierde y se recupera más tiempo.
  const rival = cmp ? usable.findIndex((_, i) => i !== cmp.ref) : -1;
  const lose = cmp && rival >= 0 ? extremeCorner(stats, rival) : null;
  const gain = cmp && rival >= 0 ? extremeCorner(stats, rival, true) : null;

  const cards = (
    <ul className="compare-cards">
      {[...usable, ...missing].map((l) => {
        const i = usable.indexOf(l);
        const has = i >= 0;
        return (
          <li key={l.lapId} className={`lap-card ${has ? '' : 'nodata'}`} style={{ ['--lapc' as string]: has ? SLOT[i] : 'var(--line)' }}>
            <div className="lap-card-bar">
              <span>{has ? t('Vuelta {n}', { n: i + 1 }) : '–'}</span>
              <span className="num lap-card-time">{formatLapTime(l.lapMs)}</span>
            </div>
            <div className="lap-card-body">
              <span className="ghost-name"><DriverLink id={l.driverId} name={l.driverName} /></span>
              <span className="ghost-car"><CarLink car={l.car} name={carName(l.car)} /></span>
              <span className="ghost-live">
                {has && i > 0 && <span className="num">{formatDelta(l.lapMs - best)}</span>}
                {l.maxSpeedKmh != null && <span className="num muted">{t('Máx.')} {speedText(l.maxSpeedKmh)}</span>}
                {!has && <span className="muted">{t('Sin trayectoria grabada de esta vuelta (se graba en las vueltas nuevas, salvo la primera tras conectarse)')}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <header className="profile-head">
        <div className="profile-title">
          <span className="profile-kicker">{t('Comparador de vueltas')}</span>
          <h2>{title}</h2>
          <p className="muted">{back}</p>
        </div>
      </header>

      {!cmp ? (
        <>
          {cards}
          <section className="panel"><p className="empty">{t('Hacen falta al menos dos vueltas con trayectoria grabada para comparar. Las trayectorias se graban en las vueltas nuevas (la mejor de cada piloto): cuando haya dos, aparecerán aquí las gráficas.')}</p></section>
        </>
      ) : (
        <>
          <div className="cmp-summary">
            <strong>{t('{name} gana por {gap}', { name: labels[cmp.ref]!, gap: `${((usable[rival]!.lapMs - best) / 1000).toFixed(3)} s` })}</strong>
            {lose && gain && lose.loseMs[rival]! > 0 && (
              <span className="muted">{t('{name} pierde más en la curva {a} ({x}) y recupera más en la curva {b} ({y}).', {
                name: labels[rival]!, a: lose.corner.n, x: sec(lose.loseMs[rival]!), b: gain.corner.n, y: sec(gain.loseMs[rival]!),
              })}</span>
            )}
          </div>

          <div className="cmp-cols">
            <aside className="cmp-side" aria-label={t('Vueltas y mapa')}>
              {cards}
              {data.map && <CompareMap map={data.map} track={track} layout={layout} cmp={cmp} colors={colors} names={labels} hover={hover} corners={corners} hotCorner={hot} onHotCorner={setHot} visible={zoomed ? chartView : null} cursors={playIdx} />}
              <CompareReadout cmp={cmp} names={labels} colors={colors} hover={hover} cursors={playIdx} clockMs={clock} />
              {cmp.latG && cmp.lonG && (
                <div className="cmp-forces">
                  <div className="cmp-forces-head"><strong>{t('Fuerzas')}</strong><span className="muted">{t('Medidas por el juego')}</span></div>
                  <ForcesChart cmp={cmp} names={labels} colors={colors} hover={hover} cursors={playIdx} />
                </div>
              )}
            </aside>

            <div className="cmp-main">
              <div className="cmp-toolbar">
                <div className="lens" role="group" aria-label={t('Gráficas visibles')}>
                  {available.map((c) => <button key={c} type="button" className="tog" aria-pressed={show[c]} onClick={() => toggle(c)}>{chLabel[c]}</button>)}
                </div>
                <div className="play-bar" role="group" aria-label={t('Reproducción')}>
                  <button type="button" className="btn small primary" onClick={togglePlay}>{playing ? `❚❚ ${t('Pausa')}` : `▶ ${t('Reproducir')}`}</button>
                  <button type="button" className="btn small" onClick={() => { setClock(0); setPlaying(false); }} disabled={clock === 0}>{t('Inicio')}</button>
                  <input type="range" min={0} max={endMs} step={50} value={clock} onChange={(e) => setClock(Number(e.target.value))} aria-label={t('Tiempo')} />
                  <span className="num play-clock">{formatLapTime(Math.min(clock, best > 0 ? Math.max(...usable.map((l) => l.lapMs)) : clock))}</span>
                  <span className="lens" role="group" aria-label={t('Velocidad de reproducción')}>
                    {[0.25, 0.5, 1, 2, 4].map((s) => <button key={s} type="button" className="tog" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
                  </span>
                </div>
                <div className="chart-zoombar" role="group" aria-label={t('Zoom de las gráficas')}>
                  <button type="button" className="btn small" onClick={() => setView(zoomView(chartView, nPoints, 1.6, 0.5))} aria-label={t('Acercar')}>＋</button>
                  <button type="button" className="btn small" onClick={() => setView(zoomView(chartView, nPoints, 1 / 1.6, 0.5))} aria-label={t('Alejar')} disabled={!zoomed}>－</button>
                  <button type="button" className="btn small" onClick={() => setView(null)} disabled={!zoomed}>{t('Todo')}</button>
                  {chartOrder.changed && <button type="button" className="btn small" onClick={chartOrder.reset}>{t('Orden original')}</button>}
                  <span className="muted">{t('Rueda = zoom en todas; arrastrar = mover; doble clic = todo.')}</span>
                </div>
              </div>

              <div className="compare-charts">
                <OrderedCharts order={chartOrder.order} onSwap={chartOrder.swap} onHide={(id) => { if (id in show) toggle(id as Channel); }}>
                {show.delta && (
                  <CompareChart key="delta" title={t('Diferencia')} subtitle={two ? `▲ ${labels[cmp.ref]!} · ▼ ${labels[1 - cmp.ref]!}` : t('Arriba: va por delante la más rápida')} series={deltaSeries} {...common} cursors={deltaCursors} height={230} bandLabels
                    format={sec} tickFormat={(v) => (Math.abs(v) < 0.005 ? '0' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`)} zeroLine symmetric
                    fill={two ? { above: SLOT[cmp.ref]!, below: SLOT[1 - cmp.ref]! } : undefined} readout={two ? deltaRead : undefined} />
                )}
                {show.speed && <CompareChart key="speed" title={t('Velocidad')} subtitle={speedUnit()} series={speedSeries} {...common} height={200} bandLabels format={(v) => speedText(v)} tickFormat={(v) => String(Math.round(speedValue(v)))} />}
                {cmp.gas && show.gas && <CompareChart key="gas" title={t('Acelerador')} subtitle={anyOn(cmp.tc) ? `% · ${t('marcas: control de tracción')}` : '%'} series={channel(cmp.gas)} {...common} marks={anyOn(cmp.tc) ? usable.map((_, i) => ({ values: cmp.tc![i]!, color: SLOT[i]! })) : undefined} height={120} format={pct} tickFormat={(v) => String(Math.round(v))} />}
                {cmp.gas && show.brake && (cmp.brakeAnalog
                  ? <CompareChart key="brake" title={t('Freno')} subtitle={anyOn(cmp.abs) ? `% · ${t('marcas: ABS')}` : '%'} series={channel(cmp.brake)} {...common} marks={anyOn(cmp.abs) ? usable.map((_, i) => ({ values: cmp.abs![i]!, color: SLOT[i]! })) : undefined} height={120} format={pct} tickFormat={(v) => String(Math.round(v))} />
                  : <CompareChart key="brake" title={t('Freno')} subtitle={t('Solo encendido/apagado')} series={channel(cmp.brake)} {...common} height={100} format={(v) => (v >= 50 ? t('frenando') : t('sin frenar'))} tickFormat={(v) => (v >= 50 ? t('sí') : v < 10 ? t('no') : '')} />)}
                {cmp.gas && show.steer && <CompareChart key="steer" title={t('Volante')} subtitle="%" series={channel(cmp.steer)} {...common} height={120} format={pct} tickFormat={(v) => String(Math.round(v))} zeroLine />}
                {show.gear && <CompareChart key="gear" title={t('Marcha')} series={usable.map((_, i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: cmp.gear[i]!.map((g) => Math.max(0, g - 1)) }))} {...common} height={110} format={(v) => (v < 0.5 ? 'N' : t('{n}ª', { n: Math.round(v) }))} tickFormat={(v) => String(Math.round(v))} />}
                {show.rpm && <CompareChart key="rpm" title={t('Revoluciones')} subtitle="rpm" series={usable.map((_, i) => ({ label: labels[i]!, color: SLOT[i]!, dash: DASH[i], values: cmp.rpm[i]! }))} {...common} height={120} format={(v) => `${Math.round(v)} rpm`} tickFormat={(v) => String(Math.round(v / 100) * 100)} />}
                {cmp.slip && show.slip && <CompareChart key="slip" title={t('Agarre')} subtitle={cmp.brakeAnalog ? undefined : t('Aproximado')} series={channel(cmp.slip.map((a) => a.map((x) => gripPct(x) / 100)))} {...common} height={110} format={pct} tickFormat={(v) => String(Math.round(v))} range={[0, 100]} />}
                {cmp.latG && show.glat && <CompareChart key="glat" title={t('G lateral')} subtitle="g" series={plain(cmp.latG)} {...common} height={110} format={(v) => `${v.toFixed(2)} g`} tickFormat={(v) => v.toFixed(1)} zeroLine />}
                {cmp.lonG && show.glon && <CompareChart key="glon" title={t('G longitudinal')} subtitle={t('+ acelera · − frena')} series={plain(cmp.lonG)} {...common} height={110} format={(v) => `${v.toFixed(2)} g`} tickFormat={(v) => v.toFixed(1)} zeroLine />}
                {cmp.temp && cmp.pres && show.tyres && (
                  <CompareTyres key="tyres" cmp={cmp} names={labels} colors={colors} dashes={[...DASH]} hover={hover} cursors={playIdx ?? undefined} chart={common} />
                )}
                {!cmp.gas && <p className="note">{t('Acelerador, freno y volante aparecen en las vueltas grabadas con el plugin de Howler actualizado.')}</p>}
                </OrderedCharts>
              </div>

              {stats.length > 0 && (
                <Section title={t('Curva a curva')}>
                  <CompareCorners stats={stats} names={labels} colors={colors} refLap={cmp.ref} hot={hot} onHot={setHot} hasBrake={!!cmp.brake} />
                </Section>
              )}
            </div>
          </div>
        </>
      )}

      {sectorCount > 0 && (
        <Section title={t('Sectores')} aside={optimal != null ? <span className="muted">{t('Vuelta óptima de estas vueltas:')} <strong className="mono">{formatLapTime(optimal)}</strong></span> : undefined}>
          <div className="table-scroll">
            <table className="timing">
              <thead><tr><th>{t('Piloto')}</th>{Array.from({ length: sectorCount }, (_, i) => <th key={i} className="num">S{i + 1}</th>)}<th className="num">{t('Vuelta')}</th></tr></thead>
              <tbody>
                {data.laps.map((l) => (
                  <tr key={l.lapId}>
                    <td className="driver">{l.driverName}</td>
                    {Array.from({ length: sectorCount }, (_, i) => {
                      const ms = l.sectorsMs[i] ?? null;
                      const isBest = ms != null && ms === bestSector[i];
                      return (
                        <td key={i} className={`num sector ${isBest ? 'best' : ''} ${ms != null && !l.sectorsExact ? 'est' : ''}`}>
                          {formatLapTime(ms)}
                          {ms != null && !isBest && <span className="of"> +{((ms - bestSector[i]!) / 1000).toFixed(3)}</span>}
                        </td>
                      );
                    })}
                    <td className="num lap">{formatLapTime(l.lapMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{t('El mejor sector de cada columna va en morado.')} {missing.length > 0 && t('Los sectores salen aunque la vuelta no tenga trayectoria grabada.')}</p>
        </Section>
      )}
    </>
  );
}
