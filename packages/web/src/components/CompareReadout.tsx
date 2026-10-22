import { speedText } from '../prefs';
import { formatDelta } from '@howler/shared';
import { t } from '../i18n';
import type { compareLaps } from './compare-math';

type Comparison = ReturnType<typeof compareLaps>;

/** Lectura del cursor compartido: distancia y, por cada vuelta, su nombre en su color, velocidad, marcha y diferencia con la más rápida. */
export function CompareReadout({ cmp, names, colors, hover, cursors, clockMs }: {
  cmp: Comparison; names: string[]; colors: string[]; hover: number | null;
  /** Reproducción: punto de cada vuelta y reloj (ms). Con ellos, cada vuelta se lee donde va y la diferencia es lo que tarda en llegar a donde está la primera. */
  cursors?: number[] | null; clockMs?: number;
}) {
  const n = cmp.laps[0]!.t.length;
  const playing = hover == null && !!cursors;
  const lead = playing ? Math.max(...cursors!) : null;
  const k = hover ?? lead;
  const lengthM = cmp.laps[cmp.ref]!.lengthM;
  return (
    <div className="compare-readout" role="status" aria-live="off">
      <div className="readout-row readout-head">
        <span className="muted">{t('Distancia')}</span>
        <span className="readout-dist num">{k == null ? '—' : `${Math.round((k / Math.max(1, n - 1)) * lengthM)} m`}</span>
      </div>
      {names.map((name, i) => {
        const own = playing ? cursors![i]! : k;
        const gear = own == null ? null : cmp.gear[i]![own]!;
        return (
          <div key={i} className="readout-row readout-lap" style={{ ['--lapc' as string]: colors[i] }}>
            <span className="readout-name"><i className="swatch" />{name}</span>
            <span className="num">{own == null ? '—' : speedText(cmp.speed[i]![own]!)}{gear != null && gear >= 2 ? ` · ${gear - 1}ª` : ''}</span>
            {playing
              ? <span className="num readout-gap">{cursors![i] === lead ? t('Líder') : `+${(Math.max(0, cmp.laps[i]!.t[lead!]! - (clockMs ?? 0)) / 1000).toFixed(3)} s`}</span>
              : i !== cmp.ref && <span className={`num readout-gap ${k != null && cmp.deltaMs[i]![k]! > 0 ? 'behind' : ''}`}>{k == null ? '' : formatDelta(cmp.deltaMs[i]![k]!)}</span>}
          </div>
        );
      })}
    </div>
  );
}
