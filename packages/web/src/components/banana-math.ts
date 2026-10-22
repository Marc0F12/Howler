/** Tiempo que hay que mantener pulsado para llegar al 100 % (el lanzamiento más largo). */
export const FULL_CHARGE_MS = 1600;

/** Fuerza del lanzamiento (0..1) según cuánto tiempo se mantuvo pulsado. */
export const powerFromHold = (ms: number): number => Math.min(1, Math.max(0, ms / FULL_CHARGE_MS));

/** Volumen guardado (0..1) a partir de dónde cae la banana: un paso del 5 % para que sea fácil acertar. */
export const volumeFromPower = (power: number): number => Math.round(Math.min(1, Math.max(0, power)) * 20) / 20;

/** Lo que dura el vuelo: más corto para lanzamientos cortos, nunca más de un segundo. */
export const flightMs = (power: number): number => Math.round(380 + 560 * Math.min(1, Math.max(0, power)));

/** Posición de la banana en pleno vuelo (t de 0 a 1): sube y baja describiendo una parábola; `peak` es la altura máxima. */
export function flightPoint(from: { x: number; y: number }, to: { x: number; y: number }, peak: number, t: number): { x: number; y: number } {
  const k = Math.min(1, Math.max(0, t));
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k - 4 * peak * k * (1 - k) };
}

/** Un paso con las flechas del teclado, para quien no puede o no quiere mantener pulsado. */
export const stepVolume = (v: number, dir: 1 | -1): number => volumeFromPower(v + dir * 0.05);

/** Ruleta: casillas de volumen del 0 % al 100 % de 10 en 10. */
export const ROULETTE_SLOTS = 11;
export const slotVolume = (k: number): number => k / (ROULETTE_SLOTS - 1);
export const slotOfVolume = (v: number): number => Math.min(ROULETTE_SLOTS - 1, Math.max(0, Math.round(v * (ROULETTE_SLOTS - 1))));

/** Casilla ganadora (0..ROULETTE_SLOTS-1) a partir de un número aleatorio en [0,1). */
export const rouletteSlot = (rand: number): number => Math.min(ROULETTE_SLOTS - 1, Math.floor(Math.min(0.999999, Math.max(0, rand)) * ROULETTE_SLOTS));

/**
 * Ángulo final de la rueda (en grados, acumulado) para que el puntero, fijo arriba, quede en el centro de la casilla `k`
 * tras al menos `minTurns` vueltas completas desde el ángulo actual.
 */
export function spinTarget(currentDeg: number, k: number, minTurns = 3): number {
  const seg = 360 / ROULETTE_SLOTS;
  const rest = -((k + 0.5) * seg); // la rueda gira al revés del puntero
  let target = rest + Math.ceil((currentDeg + minTurns * 360 - rest) / 360) * 360;
  if (target < currentDeg + minTurns * 360) target += 360;
  return target;
}

/** Casilla que marca el puntero con la rueda girada `deg` grados. */
export function slotAt(deg: number): number {
  const seg = 360 / ROULETTE_SLOTS;
  const a = (((-deg) % 360) + 360) % 360;
  return Math.min(ROULETTE_SLOTS - 1, Math.floor(a / seg));
}

/** Volumen nuevo al pulsar una flecha (null si la tecla no es una flecha). */
export function stepVolumeKey(key: string, v: number): number | null {
  return key === 'ArrowRight' || key === 'ArrowUp' ? stepVolume(v, 1) : key === 'ArrowLeft' || key === 'ArrowDown' ? stepVolume(v, -1) : null;
}
