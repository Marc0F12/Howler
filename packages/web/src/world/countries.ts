import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { project } from './world-math';

let cache: Promise<string> | null = null;

/** Tierras del mundo (países de Natural Earth, 1:50 millones, dominio público) como un solo trazado SVG en coordenadas de zoom 0. Se carga la primera vez que se abre el mapa. */
export function loadLand(): Promise<string> {
  cache ??= import('world-atlas/countries-50m.json').then((m) => {
    const topo = ((m as { default?: unknown }).default ?? m) as unknown as Topology;
    const fc = feature(topo, topo.objects.countries as GeometryCollection) as unknown as { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
    let d = '';
    const ring = (r: number[][]) => {
      r.forEach(([lon, lat], i) => {
        const p = project(lat!, lon!);
        d += `${i ? 'L' : 'M'}${p.x.toFixed(4)} ${p.y.toFixed(4)}`;
      });
      d += 'Z';
    };
    for (const f of fc.features) {
      if (f.geometry.type === 'Polygon') for (const r of f.geometry.coordinates as number[][][]) ring(r);
      else if (f.geometry.type === 'MultiPolygon') for (const poly of f.geometry.coordinates as number[][][][]) for (const r of poly) ring(r);
    }
    return d;
  });
  return cache;
}
