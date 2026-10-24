/** Búsqueda de coordenadas por nombre (Nominatim de OpenStreetMap). Solo la usa el panel, cuando el administrador pulsa «Buscar»; el visitante nunca la dispara. */

export interface GeoCandidate { label: string; lat: number; lon: number }

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Howler (+https://github.com/Marc0F12/Howler)';

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Hasta `limit` (3 por defecto) sitios que encajan con el texto; vacío si no hay ninguno. Lanza si el servicio no responde. */
export async function geocode(query: string, lang = 'es', fetchFn: FetchLike = fetch as unknown as FetchLike, limit = 3): Promise<GeoCandidate[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const url = `${ENDPOINT}?${new URLSearchParams({ q, format: 'jsonv2', limit: String(Math.max(1, Math.min(8, limit))), 'accept-language': lang })}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctl.signal, redirect: 'error' });
    if (!r.ok) throw new Error(`El servicio de búsqueda respondió ${r.status}.`);
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    const out: GeoCandidate[] = [];
    for (const row of rows as Record<string, unknown>[]) {
      const lat = Number(row.lat), lon = Number(row.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ label: String(row.display_name ?? q).slice(0, 160), lat, lon });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Qué buscar para un circuito, de más a menos fiable. `approx` = poco seguro: solo coincide el nombre suelto de su carpeta (puede ser un pueblo
 * con ese nombre) o la ciudad de su ficha.
 */
export function geocodeQueries(name: string, subtitle: string | null, folder = ''): { q: string; approx: boolean }[] {
  const place = folder.replace(/^ks_/, '').replace(/[_-]+/g, ' ').trim();
  const list: { q: string; approx: boolean }[] = [{ q: name, approx: false }];
  if (subtitle && place) list.push({ q: `${place} circuit, ${subtitle}`, approx: false });
  if (subtitle) list.push({ q: `${name}, ${subtitle}`, approx: false });
  if (place && place.toLowerCase() !== name.toLowerCase()) list.push({ q: place, approx: true });
  if (subtitle) list.push({ q: subtitle, approx: true });
  const seen = new Set<string>();
  return list.map((e) => ({ ...e, q: e.q.trim() })).filter((e) => e.q && !seen.has(e.q.toLowerCase()) && !!seen.add(e.q.toLowerCase()));
}
