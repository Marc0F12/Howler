import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Foto de perfil de Steam de cada piloto. El servidor la pide a Steam (perfil público, sin clave de API), la guarda
 * en disco y la sirve él mismo: el navegador del visitante nunca habla con Steam, y el Steam ID nunca sale de aquí.
 */

const STEAM_ID = /^\d{17}$/;
const OK_TTL_MS = 7 * 86_400_000;
const MISS_TTL_MS = 60 * 60_000;
const TIMEOUT_MS = 6_000;
const MAX_BYTES = 1_000_000;

/** Solo se descargan imágenes de los dominios de Steam: lo que ponga un perfil no puede llevar al servidor a otro sitio. */
export function isSteamImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && (u.hostname.endsWith('.steamstatic.com') || u.hostname === 'steamcdn-a.akamaihd.net' || u.hostname.endsWith('.akamaihd.net'));
  } catch {
    return false;
  }
}

/** Saca la URL de la imagen grande de la respuesta XML del perfil. */
export function parseAvatarUrl(xml: string): string | null {
  const m = /<avatarFull>\s*(?:<!\[CDATA\[)?\s*([^\]<\s]+)/.exec(xml);
  return m && isSteamImageUrl(m[1]!) ? m[1]! : null;
}

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface AvatarService {
  /** Ruta de la imagen guardada del piloto, o null si no tiene (perfil privado, sin conexión, desactivado...). */
  get(driverId: number, steamId: string | null): Promise<string | null>;
}

export function createAvatarService(opts: { dir: string; enabled?: boolean; fetcher?: Fetcher; now?: () => number }): AvatarService {
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now;
  const pending = new Map<number, Promise<string | null>>();
  mkdirSync(opts.dir, { recursive: true });

  const age = (path: string) => now() - statSync(path).mtimeMs;

  async function download(driverId: number, steamId: string): Promise<string | null> {
    const img = join(opts.dir, `${driverId}.jpg`);
    const miss = join(opts.dir, `${driverId}.none`);
    try {
      const page = await fetcher(`https://steamcommunity.com/profiles/${steamId}?xml=1`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!page.ok) throw new Error(`perfil ${page.status}`);
      const url = parseAvatarUrl(await page.text());
      if (!url) throw new Error('sin avatar');
      const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('no es una imagen');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('tamaño no válido');
      writeFileSync(img, bytes);
      return img;
    } catch {
      writeFileSync(miss, String(now())); // no se vuelve a intentar hasta dentro de un rato
      return existsSync(img) ? img : null; // si ya había una foto antigua, se sigue usando
    }
  }

  return {
    get(driverId, steamId) {
      if (opts.enabled === false || !steamId || !STEAM_ID.test(steamId)) return Promise.resolve(null);
      const img = join(opts.dir, `${driverId}.jpg`);
      const miss = join(opts.dir, `${driverId}.none`);
      if (existsSync(img) && age(img) < OK_TTL_MS) return Promise.resolve(img);
      if (existsSync(miss) && age(miss) < MISS_TTL_MS) return Promise.resolve(existsSync(img) ? img : null);
      const running = pending.get(driverId) ?? download(driverId, steamId).finally(() => pending.delete(driverId));
      pending.set(driverId, running);
      return running;
    },
  };
}

/** Lee la imagen guardada (para los tests y para quien necesite los bytes). */
export const readAvatar = (path: string) => readFileSync(path);
