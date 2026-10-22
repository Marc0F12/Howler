import type { MouseEvent } from 'react';

export const driverHref = (id: number) => `#/driver/${id}`;
export const trackHref = (track: string, layout: string) => `#/track/${encodeURIComponent(`${track}|${layout}`)}`;
export const carHref = (car: string) => `#/car/${encodeURIComponent(car)}`;
/** Una vuelta a comparar: el mejor tiempo de un piloto con un coche (`idPiloto~coche`). */
export const pickKey = (driverId: number, car: string) => `${driverId}~${car}`;
export const compareHref = (track: string, layout: string, picks: string[]) =>
  `#/compare/${[encodeURIComponent(`${track}|${layout}`), ...picks.map(encodeURIComponent)].join('/')}`;

/** Que pulsar un nombre dentro de una fila clicable lleve a su ficha sin activar además la fila. */
const stop = (e: MouseEvent) => e.stopPropagation();

/** Nombre de un piloto: lleva a su ficha. */
export function DriverLink({ id, name, className = '' }: { id: number; name: string; className?: string }) {
  return <a className={`entity-link ${className}`} href={driverHref(id)} onClick={stop}>{name}</a>;
}

/** Nombre de un circuito: lleva a su ficha. */
export function TrackLink({ track, layout, name, className = '' }: { track: string; layout: string; name: string; className?: string }) {
  return <a className={`entity-link ${className}`} href={trackHref(track, layout)} onClick={stop}>{name}</a>;
}

/** Nombre de un coche: lleva a su ficha. */
export function CarLink({ car, name, className = '' }: { car: string; name: string; className?: string }) {
  return <a className={`entity-link ${className}`} href={carHref(car)} onClick={stop}>{name}</a>;
}
