import { useRef, useState, useSyncExternalStore } from 'react';
import { setSoundVolume, soundVolume, subscribeSound } from '../sound';
import { t } from '../i18n';
import { ROULETTE_SLOTS, rouletteSlot, slotAt, slotOfVolume, slotVolume, spinTarget, stepVolumeKey } from './banana-math';

const R = 64, C = 70;
const seg = 360 / ROULETTE_SLOTS;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pt = (deg: number, r: number) => ({ x: C + r * Math.sin((deg * Math.PI) / 180), y: C - r * Math.cos((deg * Math.PI) / 180) });

/** Control de volumen jugable: se gira la ruleta y el volumen es la casilla donde se para (de 0 % a 100 %, de 10 en 10). */
export function RouletteVolume() {
  const vol = useSyncExternalStore(subscribeSound, soundVolume, () => 0.7);
  const [deg, setDeg] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [ms, setMs] = useState(0);
  const target = useRef(0);
  const pct = Math.round(vol * 100);

  const spin = () => {
    if (spinning) return;
    const k = rouletteSlot(Math.random());
    const end = spinTarget(deg, k, 3 + Math.floor(Math.random() * 3));
    target.current = k;
    if (reduced()) { setMs(0); setDeg(end); setSoundVolume(slotVolume(k)); return; }
    setMs(2600 + Math.round(Math.random() * 1200));
    setSpinning(true);
    setDeg(end);
  };
  const done = () => { if (!spinning) return; setSpinning(false); setSoundVolume(slotVolume(slotAt(deg))); };

  return (
    <div
      className="vol-game vol-roulette" role="slider" tabIndex={0} aria-label={t('Volumen del aviso')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} %`}
      onKeyDown={(e) => { const v = stepVolumeKey(e.key, vol); if (v != null) { e.preventDefault(); setSoundVolume(slotVolume(slotOfVolume(v))); } }}
    >
      <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${C}px ${C}px`, transition: ms ? `transform ${ms}ms cubic-bezier(.12,.62,.1,1)` : 'none' }} onTransitionEnd={done}>
          {Array.from({ length: ROULETTE_SLOTS }, (_, k) => {
            const a = pt(k * seg, R), b = pt((k + 1) * seg, R), mid = pt((k + 0.5) * seg, R * 0.74);
            return (
              <g key={k}>
                <path d={`M${C},${C} L${a.x},${a.y} A${R},${R} 0 0 1 ${b.x},${b.y} Z`} fill={`color-mix(in srgb, var(--accent) ${k * 10}%, var(--surface-2))`} stroke="var(--bg)" strokeWidth="1.5" />
                <text x={mid.x} y={mid.y} textAnchor="middle" dominantBaseline="central" transform={`rotate(${(k + 0.5) * seg} ${mid.x} ${mid.y})`} className="vol-slot">{k * 10}</text>
              </g>
            );
          })}
          <circle cx={C} cy={C} r="9" fill="var(--bg)" stroke="var(--line)" />
        </g>
        <path d={`M${C - 6},3 L${C + 6},3 L${C},15 Z`} fill="var(--text)" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <div className="vol-side">
        <strong className="vol-big num">{pct}%</strong>
        <button type="button" className="btn" disabled={spinning} onClick={spin}>{spinning ? t('Girando…') : t('Girar la ruleta')}</button>
      </div>
    </div>
  );
}
