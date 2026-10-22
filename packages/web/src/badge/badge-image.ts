import { autoBadge, renderBadge, type BadgeDesign, type IconLookup } from '@howler/shared';

/** SVG como `data:` para un `<img>`: cada insignia queda aislada (sin choques de ids entre varias en la página). */
export function badgeDataUri(design: BadgeDesign, icons?: IconLookup): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderBadge(design, { icons, uid: 'i' }));
}

const cache = new Map<string, string>();
/** Insignia automática de un campeonato sin imagen (la semilla es el nombre y, si hay, los colores de sus equipos). Se guarda en memoria: dibujarla es barato, pero la lista la pide en cada refresco. */
export function autoBadgeUri(name: string, teamColors: readonly string[] = []): string {
  const key = name + '|' + teamColors.join(',');
  let uri = cache.get(key);
  if (!uri) {
    uri = badgeDataUri(autoBadge(name, teamColors));
    if (cache.size > 200) cache.clear();
    cache.set(key, uri);
  }
  return uri;
}
