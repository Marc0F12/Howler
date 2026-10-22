import type { WeatherLook } from './weather-look';

const W = 320;
const CLOUD = 'M0 14h30a9 9 0 0 0 1-17.9A12.5 12.5 0 0 0 8 -1.5 10.5 10.5 0 0 0 0 14z';
/** Dónde van las nubes, de la más importante a la menos: con poca cobertura salen las primeras. */
const SLOTS: [number, number, number][] = [[120, 8, 1.5], [228, 18, 1.2], [18, 14, 1.3], [168, 30, 1], [72, 30, 0.9], [270, 32, 0.9], [-8, 28, 1.1]];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const grey = (d: number) => { const a = hex('#ffffff'), b = hex('#38414d'); return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * d)).join(',')})`; };

/**
 * Capas animadas de un clima, dibujadas dentro de un <svg> de 320 de ancho: nubes (más o menos y más o menos oscuras), niebla,
 * calima, lluvia o llovizna, nieve, aguanieve, tormenta, viento y partículas (arena, polvo, humo). Cada tipo de clima sale distinto.
 * Con «reducir movimiento» queda quieto (las animaciones se desactivan en el CSS).
 */
export function WeatherLayer({ look }: { look: WeatherLook }) {
  const clouds = Math.ceil(look.cover * SLOTS.length);
  const dark = Math.max(look.rain * 0.8, look.thunder, look.cover > 0.85 ? 0.4 : 0);
  const drops = look.rain > 0 ? Array.from({ length: Math.round(8 + look.rain * 38) }, (_, i) => ({ x: (i * 37 + i * i * 3) % W, d: (i % 7) * 0.15 })) : [];
  const len = look.drizzle ? 6 : 10 + look.rain * 8;
  const slant = look.drizzle ? 2 : 4 + look.rain * 3;
  const dropSecs = look.drizzle ? 1.3 : 1 - look.rain * 0.45;
  const flakes = look.snow > 0 ? Array.from({ length: Math.round(6 + look.snow * 34) }, (_, i) => ({ x: (i * 53 + i * i) % W, d: (i % 7) * 0.45, r: 1.1 + (i % 3) * 0.7 + look.snow * 0.5 })) : [];
  const bands = look.fog > 0 ? 2 + Math.round(look.fog * 3) : 0;
  return (
    <>
      {look.haze > 0 && <rect x="0" y="0" width={W} height="112" fill="#d9c9a3" opacity={look.haze * 0.42} />}
      {SLOTS.slice(0, clouds).map(([x, y, s], i) => (
        <path key={i} className="wxs-cloud" d={CLOUD} transform={`translate(${x} ${y}) scale(${s})`} fill={grey(dark)} opacity={Math.min(1, 0.7 + look.cover * 0.3)} />
      ))}
      {Array.from({ length: bands }, (_, i) => (
        <rect key={i} className="wxs-fog" x={-20} y={34 + i * 11} width={W + 40} height="11" rx="5.5" fill="#fff" opacity={Math.max(0.1, look.fog * 0.62 - i * 0.05)} style={{ animationDelay: `${i * -2}s` }} />
      ))}
      {drops.map((d, i) => (
        <line key={i} className="wxs-drop" x1={d.x} y1={30} x2={d.x - slant} y2={30 + len} stroke="#cfe4ff" strokeWidth={look.drizzle ? 0.9 : 1.2 + look.rain * 0.6} strokeLinecap="round" opacity={look.drizzle ? 0.8 : 1} style={{ animationDelay: `${-d.d}s`, animationDuration: `${dropSecs}s` }} />
      ))}
      {flakes.map((f, i) => <circle key={i} className="wxs-flake" cx={f.x} cy={30} r={f.r} fill="#fff" style={{ animationDelay: `${-f.d}s` }} />)}
      {look.thunder > 0 && <path className="wxs-bolt" d="M170 30l-14 24h11l-8 22 22-30h-12z" fill="#ffe27a" style={{ animationDuration: `${5 - look.thunder * 2.6}s` }} />}
      {look.thunder > 0.6 && <path className="wxs-bolt" d="M70 30l-10 18h8l-6 17 17-23h-9z" fill="#ffe27a" style={{ animationDuration: `${5 - look.thunder * 2.6}s`, animationDelay: '-1.4s' }} />}
      {look.wind > 0 && [30, 48, 64].map((y, i) => <path key={y} className="wxs-gust" d={`M10 ${y}h${70 - i * 10}a6 6 0 1 0-5-9`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity={0.35 + look.wind * 0.45} style={{ animationDelay: `${i * -0.9}s` }} />)}
      {look.particles === 'sand' && Array.from({ length: 26 }, (_, i) => <line key={i} className="wxs-streak" x1={(i * 41) % W} y1={24 + (i % 9) * 7} x2={((i * 41) % W) + 16} y2={24 + (i % 9) * 7} stroke="#d9a35a" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" style={{ animationDelay: `${-(i % 6) * 0.25}s` }} />)}
      {look.particles === 'dust' && Array.from({ length: 22 }, (_, i) => <circle key={i} className="wxs-mote" cx={(i * 47) % W} cy={20 + (i % 8) * 8} r={1 + (i % 3) * 0.6} fill="#c9b690" opacity="0.7" style={{ animationDelay: `${-(i % 7) * 0.7}s` }} />)}
      {look.particles === 'smoke' && [30, 110, 190, 260].map((x, i) => <circle key={x} className="wxs-fog" cx={x} cy={44 + (i % 2) * 14} r={26 + (i % 3) * 6} fill="#3a3835" opacity="0.34" style={{ animationDelay: `${i * -2.5}s` }} />)}
    </>
  );
}
