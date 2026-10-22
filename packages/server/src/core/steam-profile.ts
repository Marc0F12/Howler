/**
 * Resuelve un enlace de perfil de Steam (o un SteamID64 pelado) al SteamID64 y al nombre público, para inscribir en un
 * campeonato a quien aún no ha pasado por el servidor. Perfil público, sin clave de API; solo se habla con steamcommunity.com.
 * El Steam ID se queda en el servidor: quien llama solo devuelve el id interno del piloto.
 */

const STEAM_ID = /^\d{17}$/;
const VANITY = /^[A-Za-z0-9_-]{2,64}$/;
const TIMEOUT_MS = 6_000;

export type SteamTarget = { kind: 'profiles' | 'id'; value: string };

/** Entiende `https://steamcommunity.com/profiles/<id>`, `.../id/<nombre>` o un SteamID64. `null` si no es nada de eso. */
export function parseSteamLink(raw: string): SteamTarget | null {
  const text = raw.trim();
  if (STEAM_ID.test(text)) return { kind: 'profiles', value: text };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname !== 'steamcommunity.com' && u.hostname !== 'www.steamcommunity.com') return null;
  const m = /^\/(profiles|id)\/([^/]+)/.exec(u.pathname);
  if (!m) return null;
  let value: string;
  try { value = decodeURIComponent(m[2]!); } catch { return null; }
  if (m[1] === 'profiles') return STEAM_ID.test(value) ? { kind: 'profiles', value } : null;
  return VANITY.test(value) ? { kind: 'id', value } : null;
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${name}>`).exec(xml);
  return m ? m[1]!.trim() : null;
};

/** Saca SteamID64 y nombre de la respuesta XML del perfil. */
export function parseProfileXml(xml: string): { steamId: string; name: string } | null {
  const steamId = tag(xml, 'steamID64');
  if (!steamId || !STEAM_ID.test(steamId)) return null;
  return { steamId, name: (tag(xml, 'steamID') ?? '').slice(0, 64) || `Steam ${steamId.slice(-4)}` };
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export async function resolveSteamProfile(raw: string, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<{ steamId: string; name: string }> {
  const t = parseSteamLink(raw);
  if (!t) throw new Error('No parece un enlace de perfil de Steam (steamcommunity.com/id/... o /profiles/...).');
  const res = await fetcher(`https://steamcommunity.com/${t.kind}/${encodeURIComponent(t.value)}?xml=1`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (!res || !res.ok) throw new Error('No se pudo consultar Steam. Prueba otra vez o revisa el enlace.');
  const p = parseProfileXml(await res.text());
  if (!p) throw new Error('Ese perfil no existe o es privado.');
  return p;
}
