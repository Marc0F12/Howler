const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (r: number[]) => '#' + r.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

export const mix = (h: string, t: string, k: number): string => { const a = rgb(h), b = rgb(t); return toHex(a.map((v, i) => lerp(v, b[i]!, k))); };
export const lighten = (h: string, k: number): string => mix(h, '#ffffff', k);
export const darken = (h: string, k: number): string => mix(h, '#000000', k);
