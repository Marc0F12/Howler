import { useSyncExternalStore } from 'react';

/** El clima que se está eligiendo en el panel: lo publica WeatherControl y lo pinta SunScene sobre el cielo de la hora. */
export interface SceneWeather { id: string; label: string }
let current: SceneWeather | null = null;
const subs = new Set<() => void>();

export function setSceneWeather(next: SceneWeather | null) {
  if (current?.id === next?.id && current?.label === next?.label) return;
  current = next;
  subs.forEach((f) => f());
}
export const useSceneWeather = (): SceneWeather | null => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
