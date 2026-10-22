import { badgeViewBox, renderBadge, type BadgeDesign, type IconLookup } from '@howler/shared';
import { addPngText } from './png-text';

export const BADGE_PNG_WIDTH = 1024;

/**
 * Dibuja la insignia en un PNG con transparencia (1024 px de ancho, alto según su proporción), sin sombra.
 * El texto usa una fuente del sistema: un SVG usado como imagen no carga las fuentes de la web.
 * Lleva dentro el diseño (`howler-badge`).
 */
export async function rasterizeBadge(design: BadgeDesign, lookup: IconLookup | undefined): Promise<Blob> {
  const vb = badgeViewBox(design);
  const w = BADGE_PNG_WIDTH, h = Math.round((w * vb.h) / vb.w);
  const svg = renderBadge(design, { uid: 'x', icons: lookup, shadow: false }).replace('<svg ', `<svg width="${w}" height="${h}" `);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');
  ctx.drawImage(img, 0, 0, w, h);
  const raw = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
  if (!raw) throw new Error('No se pudo crear la imagen.');
  const meta: Record<string, string> = { Software: 'Howler badge creator', 'howler-badge': JSON.stringify(design) };
  try {
    return new Blob([addPngText(new Uint8Array(await raw.arrayBuffer()), meta) as BlobPart], { type: 'image/png' });
  } catch {
    return raw; // sin metadatos la imagen sirve igual
  }
}
