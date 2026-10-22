import { useEffect, useRef, useState } from 'react';
import type { ChampionshipDto, ChampionshipRoundDto } from '@howler/shared';
import { trackImage, useContentCard, useContentNames } from '../../content';
import { WeatherIcon, weatherKind } from '../weather-icons';
import { describeWeather } from '@howler/shared';
import { t, tm } from '../../i18n';
import { when } from '../championship-parts';
import { countryCode, shortestDelta, wrapIndex } from './cup-math';

const safeHttp = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** Clima que se enseña si la carrera no dice cuál: sol con nubes. */
const DEFAULT_WEATHER = 'FewClouds';

/** La clasificación general como una diapositiva más de la rueda: sin imagen, con diseño propio que sigue al tema. */
function GeneralSlide({ c, on, onPick }: { c: ChampionshipDto; on: boolean; onPick: () => void }) {
  return (
    <div className={`cup-slide general ${on ? 'on' : ''}`}>
      <button type="button" className="cup-slide-main" aria-current={on ? 'true' : undefined} onClick={onPick} aria-label={t('Clasificación general')}>
        <svg className="cup-slide-trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H5v1a3 3 0 0 0 3 3" /><path d="M16 6h3v1a3 3 0 0 1-3 3" /><path d="M12 13v4" /><path d="M9 20h6" /><path d="M10 17h4" /></svg>
        <span className="cup-slide-cc">{t('Resultados')}</span>
        <strong className="cup-slide-name">{t('General')}</strong>
        <span className="cup-slide-state">{t('{played}/{total} carreras', { played: c.played, total: c.rounds })}{c.leader ? ` · ${c.leader.name}` : ''}</span>
      </button>
    </div>
  );
}

function Slide({ c, r, on, onPick }: { c: ChampionshipDto; r: ChampionshipRoundDto; on: boolean; onPick: () => void }) {
  const { trackName } = useContentNames();
  const card = useContentCard('track', r.track, r.layout);
  const trackMod = [...r.mods, ...c.mods].find((m) => m.kind === 'track' && safeHttp(m.url));
  const next = c.next?.number === r.number;
  const state = r.played ? 'played' : next ? 'next' : 'later';
  const cc = countryCode(card?.specs['País']);
  const name = trackMod?.name || card?.name || trackName(r.track, r.layout);
  const wxTitle = r.weather ? tm(describeWeather(r.weather)) : t('Sol con nubes');
  return (
    <div className={`cup-slide ${state} ${on ? 'on' : ''}`} data-round={r.number}>
      <button type="button" className="cup-slide-main" aria-current={on ? 'true' : undefined} onClick={onPick} aria-label={`${t('Carrera {n}', { n: r.number })}: ${name}`}>
        <span className="cup-slide-wx" title={wxTitle}><WeatherIcon kind={weatherKind(r.weather ?? DEFAULT_WEATHER)} size={22} /><span className="sr-only">{wxTitle}</span></span>
        <img className="cup-slide-img" src={trackImage(r.track, r.layout)} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <span className="cup-slide-no" aria-hidden="true">{String(r.number).padStart(2, '0')}</span>
        {cc && <span className="cup-slide-cc">{cc}</span>}
        <strong className="cup-slide-name">{name}</strong>
        <span className="cup-slide-state">{r.played ? t('Disputada') : r.raceAt ? when(r.raceAt) : next ? t('Próxima') : t('Pendiente')}</span>
      </button>
      {trackMod && (
        <a className="cup-slide-dl" href={safeHttp(trackMod.url)} target="_blank" rel="noopener noreferrer nofollow" title={t('Descargar el circuito: {name}', { name: trackMod.name })} aria-label={t('Descargar el circuito: {name}', { name: trackMod.name })}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>
        </a>
      )}
    </div>
  );
}

/** Rueda de las carreras: sin principio ni final, siempre hay carreras a los dos lados (si hay pocas, se repiten alrededor). Arrastrar, flechas, rueda horizontal, puntos o teclado giran la rueda. */
const SIDE = 3;
export function RoundCarousel({ c, index, onSelect }: { c: ChampionshipDto; index: number; onSelect: (i: number) => void }) {
  const rounds = c.roundList;
  const n = rounds.length + 1; // las carreras y, al final, la clasificación general
  const [pos, setPos] = useState(index);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; at: number; moved: boolean } | null>(null);
  const lastWheel = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;

  const current = wrapIndex(pos, n);
  // Cuando la carrera cambia desde fuera (resultados), la rueda gira por el camino más corto.
  useEffect(() => { if (index !== wrapIndex(posRef.current, n)) setPos((p) => p + shortestDelta(wrapIndex(p, n), index, n)); }, [index, n]);
  const turn = (to: number) => { setPos(to); onSelect(wrapIndex(to, n)); };
  const go = (d: number) => turn(posRef.current + d);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheel.current < 160) return;
      lastWheel.current = now;
      go(e.deltaX > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = n === 1 ? [pos] : Array.from({ length: SIDE * 2 + 1 }, (_, k) => pos - SIDE + k);
  return (
    <div className="cup-car" role="region" aria-roledescription="carousel" aria-label={t('Carreras')}>
      <div
        ref={root} className="cup-wheel" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, at: posRef.current, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 8 && !d.moved) { d.moved = true; root.current?.setPointerCapture(e.pointerId); }
          if (d.moved) { const to = d.at - Math.round(dx / 120); if (to !== posRef.current) turn(to); }
        }}
        onPointerUp={() => { window.setTimeout(() => { drag.current = null; }, 0); }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {slots.map((v) => {
          const o = v - pos;
          const r = rounds[wrapIndex(v, n)];
          return (
            <div key={v} className="cup-wheel-slot" style={{ ['--o' as string]: o, ['--a' as string]: Math.abs(o), zIndex: 10 - Math.abs(o) }}>
              {r
                ? <Slide c={c} r={r} on={o === 0} onPick={() => { if (drag.current?.moved) return; if (o !== 0) turn(v); }} />
                : <GeneralSlide c={c} on={o === 0} onPick={() => { if (drag.current?.moved) return; if (o !== 0) turn(v); }} />}
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="cup-car-arrow prev" onClick={() => go(-1)} aria-label={t('Carrera anterior')}>‹</button>
          <button type="button" className="cup-car-arrow next" onClick={() => go(1)} aria-label={t('Carrera siguiente')}>›</button>
          <div className="cup-car-dots" role="tablist" aria-label={t('Elegir carrera')}>
            {Array.from({ length: n }, (_, i) => <button key={i} type="button" role="tab" aria-selected={i === current} className={i === current ? 'on' : ''} onClick={() => turn(posRef.current + shortestDelta(current, i, n))} aria-label={rounds[i] ? t('Carrera {n}', { n: rounds[i]!.number }) : t('Clasificación general')} />)}
          </div>
        </>
      )}
    </div>
  );
}
