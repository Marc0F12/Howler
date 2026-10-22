import type { MapInfoDto } from '@howler/shared';

/** Del mundo de AC (x, z en metros) al píxel de la imagen del mapa. Si el servidor calibró el mapa (`affine`) se usa esa transformación; si no, la del map.ini. */
export const toPixel = (m: MapInfoDto, x: number, z: number) => m.affine
  ? { px: m.affine[0] * x + m.affine[1] * z + m.affine[2], py: m.affine[3] * x + m.affine[4] * z + m.affine[5] }
  : { px: (x + m.xOffset) / m.scale + m.margin, py: (z + m.zOffset) / m.scale + m.margin };

/** Tamaño real de la imagen del mapa (incluye el margen). */
export const imageSize = (m: MapInfoDto) => ({ w: m.width + 2 * m.margin, h: m.height + 2 * m.margin });

/**
 * Hacia dónde apunta un coche EN LA IMAGEN del mapa (grados, 0 = hacia la derecha, positivo = hacia abajo, como `rotate` de SVG).
 * `h` es el rumbo en el mundo de AC (atan2(vz, vx)): se pasa por la misma transformación que la posición, así la flecha sigue siendo
 * correcta aunque el mapa esté girado o espejado respecto al mundo (como pasa con algunos circuitos).
 */
export function headingOnMap(m: MapInfoDto, x: number, z: number, h: number): number {
  const a = toPixel(m, x, z), b = toPixel(m, x + Math.cos(h), z + Math.sin(h));
  return (Math.atan2(b.py - a.py, b.px - a.px) * 180) / Math.PI;
}
