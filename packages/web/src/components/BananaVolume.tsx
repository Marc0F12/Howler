import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { setSoundVolume, soundVolume, subscribeSound } from '../sound';
import { t } from '../i18n';
import { flightMs, flightPoint, powerFromHold, stepVolume, volumeFromPower } from './banana-math';

const X0 = 52, X1 = 244, GROUND = 78; // 0 % y 100 % sobre el suelo
const xOf = (v: number) => X0 + (X1 - X0) * v;
const HAND = { x: 40, y: 44 };
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Banana({ x, y, rot = 0, s = 1 }: { x: number; y: number; rot?: number; s?: number }) {
  return <path d="M-8,3 Q-1,-10 9,-3 Q0,-4 -8,3 Z" transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} fill="var(--medal-gold)" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round" />;
}

/**
 * Control de volumen jugable: un mono lanza una banana; cuanto más tiempo mantengas pulsado, más lejos llega, y donde
 * cae es el volumen (de 0 % a 100 %). Con el teclado, las flechas suben y bajan de 5 en 5.
 */
export function BananaVolume() {
  const vol = useSyncExternalStore(subscribeSound, soundVolume, () => 0.7);
  const [power, setPower] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'charging' | 'flying'>('idle');
  const [fly, setFly] = useState<{ x: number; y: number; rot: number } | null>(null);
  const t0 = useRef(0), raf = useRef(0), phaseRef = useRef<'idle' | 'charging' | 'flying'>('idle');
  const go = (p: 'idle' | 'charging' | 'flying') => { phaseRef.current = p; setPhase(p); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const start = () => {
    if (phaseRef.current !== 'idle') return;
    go('charging');
    t0.current = performance.now();
    const tick = () => { setPower(powerFromHold(performance.now() - t0.current)); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
  };
  const cancel = () => { cancelAnimationFrame(raf.current); setPower(0); go('idle'); };
  const release = () => {
    if (phaseRef.current !== 'charging') return;
    cancelAnimationFrame(raf.current);
    const p = powerFromHold(performance.now() - t0.current);
    if (p < 0.03) return cancel(); // un toque sin mantener no lanza nada
    const target = volumeFromPower(p);
    if (reduced()) { setSoundVolume(target); setPower(0); go('idle'); return; }
    go('flying');
    const from = { x: HAND.x + 8, y: HAND.y - 4 }, to = { x: xOf(target), y: GROUND - 4 }, dur = flightMs(p), begin = performance.now();
    const step = () => {
      const k = (performance.now() - begin) / dur;
      if (k >= 1) { setFly(null); setPower(0); setSoundVolume(target); go('idle'); return; }
      const pt = flightPoint(from, to, 16 + 38 * p, k);
      setFly({ ...pt, rot: k * 720 });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const armAngle = phase === 'charging' ? -30 - 110 * power : phase === 'flying' ? 50 : 10;
  const pct = Math.round(vol * 100);
  return (
    <div
      className="vol-game" role="slider" tabIndex={0} aria-label={t('Volumen del aviso')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} %`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setSoundVolume(stepVolume(vol, 1)); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setSoundVolume(stepVolume(vol, -1)); }
      }}
    >
      <svg viewBox="0 0 260 96" width="260" height="96" aria-hidden="true">
        <line x1={X0} x2={X1} y1={GROUND} y2={GROUND} stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}><line x1={xOf(v)} x2={xOf(v)} y1={GROUND - 3} y2={GROUND + 3} stroke="var(--muted)" /><text x={xOf(v)} y={GROUND + 14} textAnchor="middle" className="vol-tick">{Math.round(v * 100)}</text></g>
        ))}
        {/* Mono */}
        <g className="vol-monkey">
          <ellipse cx="26" cy="60" rx="11" ry="14" fill="var(--muted)" />
          <path d="M16,66 q-12,4 -6,16" fill="none" stroke="var(--muted)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="26" cy="40" r="10" fill="var(--muted)" />
          <ellipse cx="29" cy="42" rx="6" ry="5" fill="var(--text)" opacity="0.85" />
          <circle cx="29" cy="38" r="1.4" fill="var(--ink)" />
          <circle cx="34" cy="39" r="1.4" fill="var(--ink)" />
          <g transform={`rotate(${armAngle} 32 50)`}>
            <line x1="32" y1="50" x2="46" y2="50" stroke="var(--muted)" strokeWidth="5" strokeLinecap="round" />
            {phase !== 'flying' && <Banana x={49} y={46} rot={-15} />}
          </g>
        </g>
        {/* Banana en el suelo = volumen actual */}
        {phase !== 'flying' && <><Banana x={xOf(vol)} y={GROUND - 4} s={0.9} /><text x={xOf(vol)} y={GROUND - 14} textAnchor="middle" className="vol-pct">{pct}%</text></>}
        {fly && <Banana x={fly.x} y={fly.y} rot={fly.rot} />}
        {/* Fuerza */}
        <rect x={X0} y={4} width={X1 - X0} height="5" rx="2.5" fill="var(--surface-2)" />
        <rect x={X0} y={4} width={(X1 - X0) * power} height="5" rx="2.5" fill="var(--accent)" />
      </svg>
      <button
        type="button" className="btn vol-throw" disabled={phase === 'flying'}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start(); }}
        onPointerUp={release} onPointerCancel={cancel}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); start(); } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release(); } }}
        onBlur={() => { if (phaseRef.current === 'charging') cancel(); }}
      >
        {phase === 'charging' ? t('¡Suelta para lanzar!') : t('Mantén pulsado para lanzar')}
      </button>
    </div>
  );
}
