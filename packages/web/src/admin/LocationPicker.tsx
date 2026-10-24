import { useEffect, useRef, useState } from 'react';
import { parseCoordText } from '@howler/shared';
import { adminPost } from './adminApi';
import { t } from '../i18n';
import { WorldMap, type MapMode } from '../world/WorldMap';

const MODES: [MapMode, string][] = [['satellite', 'Satélite'], ['streets', 'Calles'], ['vector', 'Vectorial']];

/**
 * Ventana para señalar en el mapa dónde está un circuito. El satélite y las calles se piden desde el navegador de quien administra (no del visitante),
 * y solo mientras tenga esta ventana abierta.
 */
export function LocationPicker({ name, initial, onSave, onClose }: { name: string; initial: { lat: number; lon: number } | null; onSave: (lat: number, lon: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<MapMode>('satellite');
  const [at, setAt] = useState<{ lat: number; lon: number } | null>(initial);
  const [text, setText] = useState(initial ? `${initial.lat}, ${initial.lon}` : '');
  const [start] = useState(initial ? { ...initial, zoom: 13 } : null);
  // El mapa se monta cuando la ventana ya está abierta: así mide su tamaño real desde el principio
  const [ready, setReady] = useState(false);
  useEffect(() => { ref.current?.showModal(); setReady(true); }, []);
  // Buscar una dirección o un lugar para llegar rápido a la zona
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ label: string; lat: number; lon: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom: number; n: number } | null>(null);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setError('');
    try { setHits((await adminPost<{ candidates: { label: string; lat: number; lon: number }[] }>('/admin/api/world-map/geocode', { q })).candidates); } catch (e) { setError((e as Error).message); setHits(null); }
    setBusy(false);
  };
  const go = (h: { lat: number; lon: number }) => { setFocus({ lat: h.lat, lon: h.lon, zoom: 16, n: (focus?.n ?? 0) + 1 }); setHits(null); };

  const set = (lat: number, lon: number) => { setAt({ lat, lon }); setText(`${lat}, ${lon}`); };
  const typed = (v: string) => {
    setText(v);
    const c = parseCoordText(v);
    if (c) setAt(c);
  };

  return (
    <dialog ref={ref} className="wm-picker" aria-label={t('Ubicar {name} en el mapa', { name })} onClose={onClose} onCancel={onClose}>
      <header>
        <h3>{t('Ubicar {name} en el mapa', { name })}</h3>
        <div className="wm-modes" role="group" aria-label={t('Tipo de mapa')}>
          {MODES.map(([id, label]) => <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{t(label)}</button>)}
        </div>
      </header>
      <div className="wm-search">
        <input type="search" value={q} placeholder={t('Buscar una dirección o un lugar (Calle, ciudad…)')} aria-label={t('Buscar una dirección o un lugar')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />{' '}
        <button type="button" className="btn small" disabled={busy || q.trim().length < 2} onClick={() => void search()}>{busy ? t('Buscando…') : t('Buscar')}</button>
        {error && <span className="muted"> {error}</span>}
        {hits && (hits.length === 0 ? <p className="muted">{t('No he encontrado nada con eso.')}</p> : (
          <ul className="wm-hits">{hits.map((h) => <li key={`${h.lat},${h.lon}`}><button type="button" onClick={() => go(h)}>{h.label}</button></li>)}</ul>
        ))}
      </div>
      <p className="hint">{t('Acerca el mapa hasta ver el circuito y pulsa en la línea de meta o en el centro de la pista. Con «Satélite» se ve la pista desde arriba.')}</p>
      {ready ? <WorldMap pins={[]} mode={mode} pick={{ marker: at, onPick: set, start, focus }} /> : <div className="wm wm-pick" />}
      <footer>
        <input type="text" value={text} placeholder="41.57, 2.26" aria-label={t('Coordenadas')} onChange={(e) => typed(e.target.value)} />
        <button type="button" className="btn primary" disabled={!at} onClick={() => { if (at) onSave(at.lat, at.lon); }}>{t('Guardar ubicación')}</button>
        <button type="button" className="btn" onClick={() => ref.current?.close()}>{t('Cancelar')}</button>
      </footer>
    </dialog>
  );
}
