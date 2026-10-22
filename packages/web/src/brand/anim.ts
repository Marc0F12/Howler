// Animaciones de marca (tiempos y curvas en brand/logo.json). Se reproducen con la Web Animations API y se quedan quietas con movimiento reducido.
import LOGO from './logo.json';

type Key = [number, unknown, string?];
const L = LOGO as unknown as {
  easings: Record<string, string | number[]>;
  layers: Record<string, { pivot?: number[] }>;
  animations: Record<string, any>;
};

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const ease = (n?: string) => {
  if (!n) return 'linear';
  const e = L.easings[n];
  return !e ? 'linear' : typeof e === 'string' ? e : `cubic-bezier(${e.join(',')})`;
};

const css = (prop: string, v: any): Keyframe => {
  switch (prop) {
    case 'rotate': return { transform: `rotate(${v}deg)` };
    case 'scale': return { transform: Array.isArray(v) ? `scale(${v[0]},${v[1]})` : `scale(${v})` };
    case 'translate': return { transform: `translate(${v[0]}px,${v[1]}px)` };
    case 'translateX': return { transform: `translateX(${v}px)` };
    case 'translateY': return { transform: `translateY(${v}px)` };
    default: return { opacity: v };
  }
};

/** Convierte una pista [[t, valor, curva]] en fotogramas; con `fractional` el tiempo ya viene en fracción de la duración. */
export function keyframes(prop: string, keys: Key[], T: number, fractional = false): Keyframe[] {
  const out: Keyframe[] = keys.map(([t, v, e]) => ({ ...css(prop, v), offset: Math.min(1, fractional ? t : t / T), ...(e ? { easing: ease(e) } : {}) }));
  // Si la pista acaba antes del final, se mantiene el último valor (si no, el navegador vuelve al valor de partida del elemento).
  const last = out[out.length - 1]!;
  if ((last.offset as number) < 1) out.push({ ...css(prop, keys[keys.length - 1]![1]), offset: 1 });
  return out;
}

/** Deja el elemento girando sobre su punto de giro. */
function pivot(el: Element, layer: string) {
  const p = L.layers[layer]?.pivot;
  if (!p) return;
  const s = (el as SVGElement).style;
  s.transformBox = 'view-box';
  s.transformOrigin = `${p[0]}px ${p[1]}px`;
}

const part = (svg: Element, id: string) => svg.querySelector<SVGElement>('#' + id);

/** Bucle de latido mientras hay sesión en directo. */
export function playLatido(svg: Element, duration = L.animations.latido.duration as number): Animation[] {
  if (reducedMotion()) return [];
  const tr = L.animations.latido.tracks as Record<string, Key[]>;
  const out: Animation[] = [];
  for (const k of ['saco.scale', 'saco-sombra.opacity', 'cabeza.rotate', 'cuerpo.rotate']) {
    const [id, prop] = k.split('.') as [string, string];
    const el = part(svg, id);
    if (!el) continue;
    pivot(el, id);
    out.push(el.animate(keyframes(prop, tr[k]!, duration, true), { duration, iterations: Infinity }));
  }
  return out;
}

/** Un aullido: golpe de cabeza, cuerpo que la sigue y tres ondas. `at` retrasa el inicio y `amp` lo hace más fuerte. */
export function playAullido(svg: Element, at = 0, amp = 1): Animation[] {
  if (reducedMotion()) return [];
  const A = L.animations.aullido;
  const T = A.duration as number;
  const out: Animation[] = [];
  const head = (A.tracks['cabeza.rotate'] as Key[]).map(([t, v, e]): Key => [t, (v as number) * amp, e]);
  const cab = part(svg, 'cabeza');
  const cue = part(svg, 'cuerpo');
  if (cab) { pivot(cab, 'cabeza'); out.push(cab.animate(keyframes('rotate', head, T), { duration: T, delay: at })); }
  if (cue) {
    pivot(cue, 'cuerpo');
    const f = A.tracks['cuerpo.rotate'] as { factor: number; delay: number };
    out.push(cue.animate(keyframes('rotate', head.map(([t, v, e]): Key => [t, (v as number) * f.factor, e]), T), { duration: T, delay: at + f.delay }));
  }
  const w = A.tracks['onda-n'] as { start: number; stagger: number; duration: number; keys: [number, { opacity: number; scale: number }, string?][] };
  svg.querySelectorAll<SVGElement>('#ondas > *').forEach((el, i) => {
    el.style.transformBox = 'view-box';
    el.style.transformOrigin = (L.layers.ondas!.pivot as number[]).map((n) => n + 'px').join(' ');
    const kf: Keyframe[] = w.keys.map(([t, v, e]) => ({ opacity: v.opacity, transform: `scale(${v.scale})`, offset: t, ...(e ? { easing: ease(e) } : {}) }));
    out.push(el.animate(kf, { duration: w.duration, delay: at + w.start + i * w.stagger, fill: 'backwards' }));
  });
  return out;
}

/** Aullido de récord: el absoluto aúlla dos veces (el segundo golpe más fuerte), el personal una. */
export function playRecord(svg: Element, kind: 'absoluto' | 'personal'): Animation[] {
  const v = L.animations.record.variants[kind] as { beats: number[]; amplitude: number[] };
  return v.beats.flatMap((t, i) => playAullido(svg, t, v.amplitude[i]));
}

/**
 * Entrada de la aplicación («zoom desde la boca»): la cámara sale de la boca abierta hasta la placa entera, el mono aúlla y la palabra cae encima
 * (se aplasta al tocar y la placa tiembla). `placa` es el contenedor de la placa, `escenario` el que la envuelve y `svg` el dibujo con #palabra.
 */
export function playEntrance(placa: HTMLElement, escenario: HTMLElement, svg: Element): { total: number; cancel: () => void } {
  const E = L.animations['entrada-zoom'];
  const T = E.duration as number;
  const anims: Animation[] = [];
  anims.push(placa.animate(keyframes('scale', E.tracks['placa.scale'] as Key[], T), { duration: T, fill: 'both' }));
  anims.push(...playAullido(svg, E.tracks.aullido.at as number));
  const word = svg.querySelector<SVGElement>('#palabra');
  const lt = L.animations.letras;
  const at = E.tracks.letras.at as number;
  if (word) {
    word.style.transformBox = 'view-box';
    word.style.transformOrigin = '500px 1201.6px';
    for (const k of ['palabra.opacity', 'palabra.scale']) {
      const [, prop] = k.split('.') as [string, string];
      anims.push(word.animate(keyframes(prop, lt.tracks[k] as Key[], lt.duration), { duration: lt.duration, delay: at, fill: 'both' }));
    }
  }
  anims.push(escenario.animate(keyframes('translateY', lt.tracks['escenario.translateY'] as Key[], lt.duration), { duration: lt.duration, delay: at, fill: 'both' }));
  return { total: at + lt.duration, cancel: () => anims.forEach((a) => a.cancel()) };
}
