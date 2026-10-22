import { useEffect, useRef } from 'react';
import type { SoundsDto } from '@howler/shared';
import { api, useLive } from '../api';
import { playSound, soundEnabled } from '../sound';

/** Suena el aviso de récord cuando aparece un récord nuevo (que bate a otro anterior) mientras la web está abierta. */
const FRESH_MS = 20_000;

export function useRecordSound() {
  const { data } = useLive(() => api.latestRecords(1), [], (e) => e.type === 'lap' || e.type === 'results');
  const seen = useRef<string | null | undefined>(undefined);
  const r = data?.[0];
  const key = r ? `${r.at}|${r.driverName}|${r.lapMs}|${r.track}|${r.car}` : null;
  useEffect(() => {
    if (!data) return;
    const first = seen.current === undefined;
    const prev = seen.current;
    seen.current = key;
    // La primera carga solo apunta el último récord: no suena nada por los que ya existían
    if (first || !r || key === prev || r.previousMs == null || Date.now() - new Date(r.at).getTime() > FRESH_MS) return;
    window.dispatchEvent(new CustomEvent('howler:record')); // el mono de la cabecera aúlla
    if (!soundEnabled()) return;
    fetch('/api/sounds').then((x) => (x.ok ? (x.json() as Promise<SoundsDto>) : null)).then((s) => { if (s) void playSound(s.record, s); }).catch(() => { /* sin sonido */ });
  }, [data, key, r]);
}
