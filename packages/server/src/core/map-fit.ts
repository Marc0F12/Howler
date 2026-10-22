import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { MapAffine } from '@howler/shared';

/**
 * Autocalibrado del mapa de un circuito. El `map.ini` de AC no siempre describe bien su `map.png` (márgenes, ejes, escala),
 * así que no se fía de él: se decodifica la imagen, se saca dónde está la carretera y se ajusta la línea de referencia
 * (`ai/fast_lane.ai`, en metros del mundo) para que caiga en el centro de esa carretera. Se prueban las 8 orientaciones
 * (giros de 90° y espejos) y se afina traslación y escala. Si el `map.ini` ya encaja, se usa tal cual.
 */

/** `f` = factor de reducción respecto a la imagen original (imágenes enormes se miden a menor resolución). */
export interface Mask { w: number; h: number; inside: Uint8Array; f: number }

/** Descodifica un PNG (sin entrelazado) y devuelve qué píxeles son «carretera»: opacos (con alfa) o distintos del fondo. */
export function pngMask(file: string | Buffer): Mask | null {
  let buf: Buffer;
  try { buf = typeof file === 'string' ? readFileSync(file) : file; } catch { return null; }
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; interlace = data[12]!; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  if (!w || !h || interlace || w * h > 20_000_000) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { return null; }
  const bpp = Math.max(1, (channels * depth) >> 3), stride = Math.ceil((w * channels * depth) / 8);
  if (raw.length < (stride + 1) * h) return null;
  const img = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? img[dst + i - bpp]! : 0;
      const b = y > 0 ? img[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? img[dst - stride + i - bpp]! : 0;
      let v = raw[src + i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) return null;
      img[dst + i] = v & 255;
    }
  }
  // Valor de cada canal de un píxel, llevado a 0..255.
  const sample = (y: number, x: number, ch: number): number => {
    const row = y * stride;
    if (depth === 8) return img[row + x * channels + ch]!;
    if (depth === 16) return img[row + (x * channels + ch) * 2]!;
    const bit = (x * channels + ch) * depth;
    const v = (img[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = (y: number, x: number): [number, number, number, number] => {
    if (type === 3) {
      const i = sample(y, x, 0);
      return palette ? [palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!, trns && i < trns.length ? trns[i]! : 255] : [0, 0, 0, 255];
    }
    if (type === 0) { const g = sample(y, x, 0); return [g, g, g, 255]; }
    if (type === 4) { const g = sample(y, x, 0); return [g, g, g, sample(y, x, 1)]; }
    return [sample(y, x, 0), sample(y, x, 1), sample(y, x, 2), type === 6 ? sample(y, x, 3) : 255];
  };
  const hasAlpha = type === 4 || type === 6 || (type === 3 && !!trns);
  const f = Math.max(1, Math.ceil(Math.sqrt((w * h) / 4_000_000)));
  const mw = Math.floor(w / f), mh = Math.floor(h / f);
  const inside = new Uint8Array(mw * mh);
  const bg = rgba(0, 0);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const p = rgba(Math.min(h - 1, y * f + (f >> 1)), Math.min(w - 1, x * f + (f >> 1)));
      inside[y * mw + x] = hasAlpha ? (p[3] >= 128 ? 1 : 0)
        : Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90 ? 1 : 0;
    }
  }
  return { w: mw, h: mh, inside, f };
}

/** Distancia (aprox. euclídea, chamfer 1/√2) de cada píxel al más cercano donde `target` vale 1. */
function distanceTo(target: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, d = new Float32Array(w * h), D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = target[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + D);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + D);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Campo con signo: profundidad dentro de la carretera (>0) o distancia a ella desde fuera (<0). */
export function signedField(m: Mask): Float32Array {
  const { w, h, inside } = m;
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < outside.length; i++) outside[i] = inside[i] ? 0 : 1;
  const depth = distanceTo(outside, w, h), away = distanceTo(inside, w, h);
  const s = new Float32Array(w * h);
  for (let i = 0; i < s.length; i++) s[i] = inside[i] ? depth[i]! : -away[i]!;
  return s;
}

export interface FitQuality {
  /** Fracción de puntos de la línea que caen sobre la carretera. */
  coverage: number;
  /** Profundidad media dentro de la carretera (px): cuanto más alta, más centrada. */
  depth: number;
}

function evaluate(field: Float32Array, w: number, h: number, xs: number[], zs: number[], af: MapAffine): FitQuality {
  let inside = 0, sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const px = Math.round(af[0] * xs[i]! + af[1] * zs[i]! + af[2]), py = Math.round(af[3] * xs[i]! + af[4] * zs[i]! + af[5]);
    const v = px < 0 || py < 0 || px >= w || py >= h ? -300 : Math.max(-300, field[py * w + px]!);
    if (v > 0) inside++;
    sum += v;
  }
  return { coverage: inside / xs.length, depth: sum / xs.length };
}

/** Las 8 orientaciones posibles de (x, z) → (u, v): giros de 90° y espejos. */
const ORIENTATIONS: [number, number, number, number][] = [
  [1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1],
  [0, 1, 1, 0], [0, -1, 1, 0], [0, 1, -1, 0], [0, -1, -1, 0],
];

export interface MapFitResult {
  affine: MapAffine;
  /** 'ini' si el map.ini ya encajaba, 'fitted' si hubo que ajustar, 'unreliable' si ni uno ni otro encajan (se deja el map.ini). */
  source: 'ini' | 'fitted' | 'unreliable';
  fitted: FitQuality;
  ini: FitQuality | null;
}

function subsample(x: number[], z: number[], max: number): [number[], number[]] {
  const step = Math.max(1, Math.floor(x.length / max));
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < x.length; i += step) { xs.push(x[i]!); zs.push(z[i]!); }
  return [xs, zs];
}

/**
 * Busca la transformación mundo → píxel que mejor centra la línea `spline` en la carretera de la imagen.
 * `ini` es la que dice el map.ini (se prefiere mientras encaje casi igual de bien).
 */
export function fitMap(mask: Mask, spline: { x: number[]; z: number[] }, iniFull: MapAffine | null): MapFitResult | null {
  const { w, h, inside, f } = mask;
  const ini = iniFull ? (iniFull.map((v) => v / f) as MapAffine) : null;
  const up = (a: MapAffine) => a.map((v) => v * f) as MapAffine;
  let x0 = w, x1 = -1, y0 = h, y1 = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside[y * w + x]) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (count < 50 || spline.x.length < 10) return null;
  const field = signedField(mask);
  const [xs, zs] = subsample(spline.x, spline.z, 700);
  const iniQ = ini ? evaluate(field, w, h, xs, zs, ini) : null;
  const mw = x1 - x0, mh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  let best: { af: MapAffine; q: FitQuality } | null = null;
  const objective = (q: FitQuality) => q.depth;
  for (const [ux, uz, vx, vz] of ORIENTATIONS) {
    const us = xs.map((x, i) => ux * x + uz * zs[i]!), vs = xs.map((x, i) => vx * x + vz * zs[i]!);
    const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
    const sw = umax - umin || 1, sh = vmax - vmin || 1;
    const ks = new Set<number>([mw / sw, mh / sh, Math.min(mw / sw, mh / sh) * 0.95, ini ? Math.abs(ini[0]) : 0].filter((k) => k > 0));
    for (const k0 of ks) {
      let k = k0, tx = cx - k * (umin + umax) / 2, ty = cy - k * (vmin + vmax) / 2;
      const make = (kk: number, a: number, b: number): MapAffine => [kk * ux, kk * uz, a, kk * vx, kk * vz, b];
      let cur = evaluate(field, w, h, xs, zs, make(k, tx, ty));
      for (let step = 32; step >= 0.5; step /= 2) {
        for (let pass = 0; pass < 6; pass++) {
          let moved = false;
          for (const [dk, dx, dy] of [[0, step, 0], [0, -step, 0], [0, 0, step], [0, 0, -step], [step / 400, 0, 0], [-step / 400, 0, 0]] as const) {
            const kk = k * (1 + dk), q = evaluate(field, w, h, xs, zs, make(kk, tx + dx, ty + dy));
            if (objective(q) > objective(cur) + 1e-6) { cur = q; k = kk; tx += dx; ty += dy; moved = true; }
          }
          if (!moved) break;
        }
      }
      if (!best || objective(cur) > objective(best.q)) best = { af: make(k, tx, ty), q: cur };
    }
  }
  if (!best) return null;
  // El map.ini manda mientras la línea caiga dentro de la carretera casi igual de centrada que en el mejor ajuste.
  const scale = (q: FitQuality): FitQuality => ({ coverage: q.coverage, depth: q.depth * f });
  if (ini && iniQ && iniQ.coverage >= 0.85 && iniQ.depth >= 0.6 * best.q.depth) return { affine: iniFull!, source: 'ini', fitted: scale(best.q), ini: scale(iniQ) };
  // Un ajuste que tampoco deja la línea sobre la carretera no es de fiar (línea de AC que no sigue la carretera): se queda el map.ini.
  const reliable = best.q.coverage >= 0.6 && (!iniQ || best.q.depth > iniQ.depth);
  if (!reliable) return { affine: iniFull ?? up(best.af), source: iniFull ? 'unreliable' : 'fitted', fitted: scale(best.q), ini: iniQ && scale(iniQ) };
  return { affine: up(best.af), source: 'fitted', fitted: scale(best.q), ini: iniQ && scale(iniQ) };
}
