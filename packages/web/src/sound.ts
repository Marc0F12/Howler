import { isBuiltinSound, MAX_SOUND_SECONDS, NO_SOUND, type BuiltinSound, type SoundsDto } from '@howler/shared';

/**
 * Sonidos de la web. Los de serie se generan con Web Audio (sin archivos); los personalizados se descargan del servidor.
 * Todo está apagado de serie y es decisión de cada visitante (botón de silencio + volumen, guardados en este navegador).
 * Un navegador no deja sonar nada hasta que la persona toca la página, así que primero hay que activar el sonido con el botón.
 */
const KEY_ON = 'howler.sound', KEY_VOL = 'howler.volume';
const listeners = new Set<() => void>();

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* sin almacenamiento */ } }

export const soundEnabled = (): boolean => typeof window !== 'undefined' && read(KEY_ON) === 'on';
export const soundVolume = (): number => {
  const raw = read(KEY_VOL);
  const v = Number(raw);
  return raw != null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
};
export function setSoundEnabled(on: boolean) { write(KEY_ON, on ? 'on' : 'off'); listeners.forEach((f) => f()); }
export function setSoundVolume(v: number) { write(KEY_VOL, String(Math.min(1, Math.max(0, v)))); listeners.forEach((f) => f()); }
/** Para `useSyncExternalStore`: avisa cuando cambian el silencio o el volumen. */
export function subscribeSound(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx ??= new C();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

type Out = { c: AudioContext; out: GainNode; t0: number };

/** Envolvente: sube, aguanta y se apaga del todo antes de `end`. */
function envelope(g: GainNode, t0: number, attack: number, end: number, peak = 1) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + Math.max(attack, end * 0.55));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
}
function noise(c: AudioContext, secs: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * secs), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}

/** Respaldo sintético (aproximado) del aullido, por si la grabación no carga. ~2,6 s. */
function howlSynth({ c, out, t0 }: Out) {
  const dur = 2.6;
  const body = c.createGain();
  envelope(body, t0, 0.35, dur, 0.9);
  body.connect(out);
  // Cuerda vocal: dientes de sierra que suben y bajan de tono con un temblor
  const grow = c.createGain();
  grow.gain.value = 0.55;
  const lfoGrowl = c.createOscillator();
  lfoGrowl.frequency.value = 27;
  const lfoGrowlDepth = c.createGain();
  lfoGrowlDepth.gain.value = 0.45;
  lfoGrowl.connect(lfoGrowlDepth).connect(grow.gain);
  const vib = c.createOscillator();
  vib.frequency.value = 5.5;
  const vibDepth = c.createGain();
  vibDepth.gain.value = 7;
  vib.connect(vibDepth);
  const voices = [1, 1.005, 2.01].map((mult, i) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95 * mult, t0);
    o.frequency.exponentialRampToValueAtTime(175 * mult, t0 + 0.6);
    o.frequency.exponentialRampToValueAtTime(150 * mult, t0 + 1.8);
    o.frequency.exponentialRampToValueAtTime(80 * mult, t0 + dur);
    vibDepth.connect(o.frequency);
    const g = c.createGain();
    g.gain.value = i === 2 ? 0.25 : 0.6;
    o.connect(g).connect(grow);
    return o;
  });
  // Tracto vocal: tres formantes que se mueven (a-o)
  const F: [number, number, number, number][] = [[620, 900, 640, 6], [1100, 1250, 950, 7], [2500, 2300, 2100, 9]];
  const mix = c.createGain();
  mix.gain.value = 3.2;
  F.forEach(([f0, f1, f2, q], i) => {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.linearRampToValueAtTime(f1, t0 + 0.9);
    bp.frequency.linearRampToValueAtTime(f2, t0 + dur);
    const g = c.createGain();
    g.gain.value = [1, 0.7, 0.3][i]!;
    grow.connect(bp).connect(g).connect(mix);
  });
  mix.connect(body);
  // Aire de la garganta
  const n = noise(c, dur);
  const nb = c.createBiquadFilter();
  nb.type = 'bandpass';
  nb.frequency.value = 1400;
  nb.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.value = 0.16;
  n.connect(nb).connect(ng).connect(body);
  [lfoGrowl, vib, ...voices, n].forEach((s) => { s.start(t0); s.stop(t0 + dur + 0.05); });
}

function tone(o: Out, type: OscillatorType, freq: number, at: number, len: number, peak = 0.5, cutoff = 4000) {
  const { c, out, t0 } = o;
  const osc = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
  osc.type = type;
  osc.frequency.value = freq;
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  envelope(g, t0 + at, Math.min(0.02, len / 4), len, peak);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t0 + at);
  osc.stop(t0 + at + len + 0.05);
}
const horn = (o: Out) => { tone(o, 'sawtooth', 233, 0, 1.1, 0.5, 1400); tone(o, 'sawtooth', 294, 0, 1.1, 0.4, 1400); tone(o, 'sawtooth', 349, 0, 1.1, 0.3, 1400); };
const chime = (o: Out) => { [880, 1320, 1760].forEach((f, i) => tone(o, 'sine', f, i * 0.12, 1.4 - i * 0.2, 0.35 / (i + 1))); };
const fanfare = (o: Out) => { [523, 659, 784, 1047].forEach((f, i) => tone(o, 'square', f, i * 0.14, i === 3 ? 0.9 : 0.22, 0.28, 2600)); };
const blip = (o: Out) => { tone(o, 'triangle', 880, 0, 0.12, 0.5); tone(o, 'triangle', 1320, 0.1, 0.18, 0.5); };
/** Canto de gibón real (grabación de Bidone en Freesound, CC0 / dominio público: no exige crédito). Se descarga una vez y se guarda decodificado. */
let howlBuffer: Promise<AudioBuffer> | null = null;
function howl(o: Out) {
  howlBuffer ??= fetch('/howl.ogg').then((r) => r.arrayBuffer()).then((b) => o.c.decodeAudioData(b));
  howlBuffer.then((buf) => {
    const src = o.c.createBufferSource();
    src.buffer = buf;
    src.connect(o.out);
    src.start(o.t0);
  }).catch(() => { howlBuffer = null; howlSynth(o); });
}
/** «Destello»: dos notas suaves que suben, con un brillo apenas audible; sutil, para oír cada récord muchas veces sin cansar. ~1,3 s. */
const soft = (o: Out) => { tone(o, 'sine', 523.25, 0, 0.9, 0.22, 2500); tone(o, 'sine', 783.99, 0.14, 1.1, 0.2, 2800); tone(o, 'sine', 1046.5, 0.14, 0.8, 0.05, 3200); };
const BUILTIN: Record<BuiltinSound, (o: Out) => void> = { soft, howl, horn, chime, fanfare, blip };

/** Los sonidos de serie, con su nombre para mostrar. */
export const builtinLabels = (tr: (s: string) => string): Record<BuiltinSound, string> => ({
  soft: tr('Destello'), howl: tr('Canto de gibón'), horn: tr('Bocina'), chime: tr('Campanilla'), fanfare: tr('Fanfarria'), blip: tr('Pitido corto'),
});

/** Suena el sonido pedido (de serie o personalizado de la lista). No hace nada si está en silencio, salvo con `force` (para probar). */
export async function playSound(id: string, sounds: SoundsDto | null, opts: { force?: boolean } = {}): Promise<void> {
  if (id === NO_SOUND || (!opts.force && !soundEnabled())) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const out = c.createGain();
  out.gain.value = soundVolume();
  // Compresor de seguridad: nunca satura ni da un golpe de volumen, suene lo que suene
  const comp = c.createDynamicsCompressor();
  out.connect(comp).connect(c.destination);
  const t0 = c.currentTime + 0.03;
  if (isBuiltinSound(id)) { BUILTIN[id]({ c, out, t0 }); return; }
  const custom = sounds?.custom.find((s) => s.id === id);
  if (!custom) return;
  try {
    const buf = await c.decodeAudioData(await (await fetch(custom.url)).arrayBuffer());
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    const max = Math.min(sounds?.maxSeconds ?? MAX_SOUND_SECONDS, MAX_SOUND_SECONDS);
    src.start(t0);
    src.stop(t0 + max); // tope duro: aunque el archivo dure más, no suena más de la cuenta
  } catch { /* archivo ilegible: sin sonido */ }
}

/** Duración en segundos de un archivo de audio, medida en el navegador antes de subirlo; null si no se puede leer. */
export async function audioSeconds(file: File): Promise<number | null> {
  const c = audio();
  if (!c) return null;
  try { return (await c.decodeAudioData(await file.arrayBuffer())).duration; } catch { return null; }
}
