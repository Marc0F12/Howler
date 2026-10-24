import { useState } from 'react';
import { api, useLive } from '../api';
import { t } from '../i18n';
import { Empty } from '../components/Empty';
import { WorldMap, type MapMode } from '../world/WorldMap';

const STORE = 'howler.world.mode';
const MODES: [MapMode, string][] = [['vector', 'Vectorial'], ['satellite', 'Satélite'], ['streets', 'Calles']];

function savedMode(): MapMode {
  try { const v = localStorage.getItem(STORE); if (v === 'satellite' || v === 'streets') return v; } catch { /* sin almacenamiento */ }
  return 'vector';
}

/** Mapa del mundo: dónde está cada circuito jugado y quién tiene sus mejores tiempos. */
export function WorldPage() {
  const { data, error } = useLive(api.world, [], (e) => e.type === 'lap' || e.type === 'results');
  const [pick, setPick] = useState<MapMode>(savedMode);
  if (error && !data) return <p className="empty">{t('No se pudo cargar el mapa.')}</p>;
  if (!data) return <p className="empty">{t('Cargando…')}</p>;
  // Los mapas en línea solo se ofrecen si el administrador los ha permitido
  const mode: MapMode = data.online ? pick : 'vector';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('Mapa del mundo')}</h2>
        {data.online && (
          <div className="wm-modes" role="group" aria-label={t('Tipo de mapa')}>
            {MODES.map(([id, label]) => (
              <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => { setPick(id); try { localStorage.setItem(STORE, id); } catch { /* sin almacenamiento */ } }}>{t(label)}</button>
            ))}
          </div>
        )}
      </div>
      {data.pins.length === 0 ? (
        <Empty next={t('El administrador puede ubicar los circuitos en el panel: Comunidad y web → Mapa del mundo.')}>{t('Ningún circuito jugado tiene ubicación todavía.')}</Empty>
      ) : (
        <>
          <p className="muted wm-hint">{t('Pasa el cursor por un circuito para ver sus 3 mejores tiempos; pulsa para abrir su ficha.')}</p>
          <WorldMap pins={data.pins} mode={mode} />
        </>
      )}
    </section>
  );
}
