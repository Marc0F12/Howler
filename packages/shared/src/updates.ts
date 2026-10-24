// Actualizaciones: versión, comparación y tipos que ve el panel. Las notas vienen de las Releases de GitHub.

/** Versión de esta compilación. Debe coincidir con la de package.json (hay un test que lo comprueba). */
export const HOWLER_VERSION = '0.1.6';

export interface UpdateAssetDto { name: string; sizeBytes: number }

export interface UpdateInfoDto {
  version: string;
  name: string;
  /** Notas del parche en el idioma pedido (Markdown). */
  notes: string;
  publishedAt: string;
  /** Página de la release en GitHub. */
  url: string;
  prerelease: boolean;
  assets: UpdateAssetDto[];
  /** ¿Hay un instalador con su suma de comprobación para instalar desde aquí? */
  installable: boolean;
}

export interface UpdateStateDto {
  current: string;
  /** Última versión publicada, aunque no sea más nueva que la actual. */
  latest: UpdateInfoDto | null;
  /** Hay una versión más nueva que la actual. */
  available: boolean;
  /** El usuario dijo «ahora no» a esta versión: no sale el aviso grande, pero sigue disponible en Ajustes. */
  dismissed: boolean;
  checkedAt: string | null;
  checking: boolean;
  error: string | null;
  settings: { check: boolean; channel: 'stable' | 'beta' };
  /** Estado de una descarga/instalación en curso. */
  install: { state: 'idle' | 'downloading' | 'ready' | 'error'; percent: number; error: string | null };
}

/** `v1.2.3-beta.1` → [1, 2, 3, ['beta', 1]]; null si no es una versión. */
export function parseVersion(v: string): { nums: [number, number, number]; pre: (string | number)[] } | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return null;
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)],
    pre: m[4] ? m[4].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [],
  };
}

/** <0 si a es anterior a b, 0 si iguales, >0 si a es posterior (reglas de semver: una pre-versión es anterior a su versión final). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * Las notas de una release pueden venir en varios idiomas separadas por marcadores `<!-- lang:es -->` y `<!-- lang:en -->`.
 * Se devuelve el trozo del idioma pedido (o, si no hay, el español, o el texto entero si no hay marcadores).
 */
export function pickNotes(body: string, lang: 'es' | 'en'): string {
  const re = /<!--\s*lang:(es|en)\s*-->/gi;
  const marks = [...body.matchAll(re)];
  if (marks.length === 0) return body.trim();
  const parts = new Map<string, string>();
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? body.length;
    parts.set(m[1]!.toLowerCase(), body.slice(m.index! + m[0].length, end).trim());
  });
  const intro = body.slice(0, marks[0]!.index).trim();
  const text = parts.get(lang) ?? parts.get('es') ?? parts.get('en') ?? '';
  return [intro, text].filter(Boolean).join('\n\n');
}
