import { useEffect, useState } from 'react';
import type { InstalledContentDto, ScheduledEventInput } from '@howler/shared';
import { t } from '../i18n';
import { adminApi } from './adminApi';
import { Field } from './ui';

/** Lo que hay instalado en AC (se pide una sola vez por pantalla). */
export function useInstalled(): InstalledContentDto | null {
  const [c, setC] = useState<InstalledContentDto | null>(null);
  useEffect(() => { adminApi.installedContent().then(setC, () => setC({ cars: [], tracks: [] })); }, []);
  return c;
}

const trackKey = (t: { track: string; layout: string } | null) => (t ? `${t.track}|${t.layout}` : '');

/** Circuito y coches que el evento pone en el servidor (opcional). */
export function EventSetupFields({ v, onChange, installed }: {
  v: Pick<ScheduledEventInput, 'track' | 'entries'>; onChange: (p: Pick<ScheduledEventInput, 'track' | 'entries'>) => void; installed: InstalledContentDto | null;
}) {
  const cars = installed?.cars ?? [];
  const tracks = installed?.tracks ?? [];
  const known = tracks.some((x) => trackKey(x) === trackKey(v.track));
  const setEntry = (i: number, p: Partial<ScheduledEventInput['entries'][number]>) => onChange({ ...v, entries: v.entries.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  return (
    <>
      <Field label={t('Circuito')} hint={t('Se pone justo antes de arrancar. «Sin cambiar» deja el que tenga el servidor.')}>
        <select
          value={trackKey(v.track)}
          onChange={(e) => {
            const x = tracks.find((y) => trackKey(y) === e.target.value);
            onChange({ ...v, track: x ? { track: x.track, layout: x.layout } : null });
          }}
        >
          <option value="">{t('Sin cambiar')}</option>
          {v.track && !known && <option value={trackKey(v.track)}>{v.track.track}{v.track.layout ? ` · ${v.track.layout}` : ''}</option>}
          {tracks.map((x) => <option key={trackKey(x)} value={trackKey(x)}>{x.name}</option>)}
        </select>
      </Field>
      <Field label={t('Coches')} hint={t('Con coches elegidos, la lista del servidor pasa a ser esta (se conservan las plazas que ya tuvieran skin o piloto reservado). Sin coches, no se toca.')}>
        <span className="sched-cars">
          {v.entries.map((e, i) => (
            <span key={i} className="row-actions">
              <select value={e.car} aria-label={t('Coche')} onChange={(ev) => setEntry(i, { car: ev.target.value })}>
                {!cars.some((c) => c.id === e.car) && <option value={e.car}>{e.car}</option>}
                {cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input type="number" min={1} max={100} value={e.count} aria-label={t('Plazas')} onChange={(ev) => setEntry(i, { count: Math.max(1, Number(ev.target.value) || 1) })} />
              <span className="muted">{t('plazas')}</span>
              <button type="button" className="btn small" onClick={() => onChange({ ...v, entries: v.entries.filter((_, j) => j !== i) })}>{t('Quitar')}</button>
            </span>
          ))}
          <button type="button" className="btn small" disabled={cars.length === 0} onClick={() => onChange({ ...v, entries: [...v.entries, { car: cars[0]!.id, count: 4 }] })}>{t('Añadir coche')}</button>
        </span>
      </Field>
    </>
  );
}
