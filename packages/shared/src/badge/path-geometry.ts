/**
 * Geometría de trazados SVG sin DOM: aplana un `d` en puntos para medir su caja y repartir puntos por el contorno.
 * Sustituye a getBBox/getPointAtLength, así el dibujo de las insignias es determinista y se prueba en Node.
 */
export type Pt = [number, number];

const CMD_ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Los indicadores de arco (0/1) pueden venir pegados al siguiente número («a1 1 0 011 2»); aquí ya vienen separados porque los iconos usados no lo hacen. */
function arcPoints(x0: number, y0: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number, steps: number): Pt[] {
  if (rx === 0 || ry === 0) return [[x, y]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx;
  const cx = cp * cxp - sp * cyp + (x0 + x) / 2, cy = sp * cxp + cp * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(steps, Math.ceil((Math.abs(dth) / (2 * Math.PI)) * steps));
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = th1 + (dth * i) / n, ct = Math.cos(t), st = Math.sin(t);
    pts.push([cp * rx * ct - sp * ry * st + cx, sp * rx * ct + cp * ry * st + cy]);
  }
  pts[pts.length - 1] = [x, y];
  return pts;
}

/** Aplana el trazado: una lista de puntos por subtrazado (`closed` si acaba en Z). */
export function flattenPath(d: string, steps = 16): { pts: Pt[]; closed: boolean }[] {
  const tk = tokenize(d);
  const subs: { pts: Pt[]; closed: boolean }[] = [];
  let cur: { pts: Pt[]; closed: boolean } | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', lastC: Pt | null = null, lastQ: Pt | null = null;
  let i = 0;
  const num = () => { const v = tk[i++]; return typeof v === 'number' ? v : 0; };
  const add = (px: number, py: number) => { if (!cur) { cur = { pts: [[x, y]], closed: false }; subs.push(cur); } cur.pts.push([px, py]); x = px; y = py; };
  while (i < tk.length) {
    const t = tk[i];
    if (typeof t === 'string') { cmd = t; i++; if (cmd === 'z' || cmd === 'Z') { if (cur) { (cur as { closed: boolean }).closed = true; } x = sx; y = sy; cur = null; lastC = lastQ = null; } continue; }
    if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), c = cmd.toLowerCase();
    if (CMD_ARGS[c] === undefined || c === 'z') { i++; continue; }
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (c === 'm') {
      x = ox + num(); y = oy + num(); sx = x; sy = y;
      cur = { pts: [[x, y]], closed: false }; subs.push(cur);
      cmd = rel ? 'l' : 'L'; lastC = lastQ = null;
    } else if (c === 'l') { add(ox + num(), oy + num()); lastC = lastQ = null; }
    else if (c === 'h') { add(rel ? x + num() : num(), y); lastC = lastQ = null; }
    else if (c === 'v') { add(x, rel ? y + num() : num()); lastC = lastQ = null; }
    else if (c === 'c' || c === 's') {
      let x1: number, y1: number;
      if (c === 'c') { x1 = ox + num(); y1 = oy + num(); } else { x1 = lastC ? 2 * x - lastC[0] : x; y1 = lastC ? 2 * y - lastC[1] : y; }
      const x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num();
      const x0 = x, y0 = y;
      for (let k = 1; k <= steps; k++) {
        const u = k / steps, v = 1 - u;
        add(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * ex, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * ey);
      }
      lastC = [x2, y2]; lastQ = null;
    } else if (c === 'q' || c === 't') {
      let x1: number, y1: number;
      if (c === 'q') { x1 = ox + num(); y1 = oy + num(); } else { x1 = lastQ ? 2 * x - lastQ[0] : x; y1 = lastQ ? 2 * y - lastQ[1] : y; }
      const ex = ox + num(), ey = oy + num(), x0 = x, y0 = y;
      for (let k = 1; k <= steps; k++) { const u = k / steps, v = 1 - u; add(v * v * x0 + 2 * v * u * x1 + u * u * ex, v * v * y0 + 2 * v * u * y1 + u * u * ey); }
      lastQ = [x1, y1]; lastC = null;
    } else if (c === 'a') {
      const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), ex = ox + num(), ey = oy + num();
      const x0 = x, y0 = y;
      for (const p of arcPoints(x0, y0, rx, ry, rot, la !== 0, sw !== 0, ex, ey, steps)) add(p[0], p[1]);
      lastC = lastQ = null;
    }
  }
  return subs;
}

export interface Box { x: number; y: number; w: number; h: number }

/** Caja que envuelve la geometría (sin trazo), como getBBox. Mínimo 1 de ancho/alto. */
export function pathBBox(d: string): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of flattenPath(d, 24)) for (const [px, py] of s.pts) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

/** `n` puntos repartidos a partes iguales por el contorno (empezando por el inicio del trazado), encogidos hacia el centro (100,100) por `scale`. */
export function pointsAlong(d: string, n: number, scale: number): Pt[] {
  const subs = flattenPath(d, 64);
  const poly: Pt[] = [];
  for (const s of subs) { poly.push(...s.pts); if (s.closed && s.pts.length) poly.push(s.pts[0]!); }
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1]! + Math.hypot(poly[i]![0] - poly[i - 1]![0], poly[i]![1] - poly[i - 1]![1]));
  const total = cum[cum.length - 1] ?? 0;
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n;
    while (j < cum.length - 1 && cum[j]! < target) j++;
    const a = poly[j - 1]!, b = poly[j]!, seg = cum[j]! - cum[j - 1]!;
    const f = seg > 0 ? (target - cum[j - 1]!) / seg : 0;
    const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f;
    out.push([100 + (px - 100) * scale, 100 + (py - 100) * scale]);
  }
  return out;
}
