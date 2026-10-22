import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SoundsDto, VolumeStyle } from '@howler/shared';
import { setSoundVolume, soundVolume, subscribeSound } from '../sound';
import { t } from '../i18n';
import { BananaVolume } from './BananaVolume';
import { RouletteVolume } from './RouletteVolume';

/** Estilo de control de volumen que eligió el administrador; se pregunta una sola vez por carga de página. */
let styleCache: Promise<VolumeStyle> | null = null;
function loadStyle(): Promise<VolumeStyle> {
  styleCache ??= fetch('/api/sounds').then((r) => (r.ok ? (r.json() as Promise<SoundsDto>) : null)).then((s) => s?.volumeStyle ?? 'banana').catch(() => 'banana' as const);
  return styleCache;
}

/** Control de volumen del aviso: deslizador clásico, o un botón con el porcentaje que abre el minijuego elegido. */
export function VolumeControl() {
  const vol = useSyncExternalStore(subscribeSound, soundVolume, () => 0.7);
  const [style, setStyle] = useState<VolumeStyle | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => { let live = true; void loadStyle().then((s) => { if (live) setStyle(s); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!style) return null;
  if (style === 'slider') {
    return <input className="sound-range" type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setSoundVolume(Number(e.target.value))} aria-label={t('Volumen del aviso')} title={t('Volumen del aviso')} />;
  }
  return (
    <span className="vol-wrap" ref={box}>
      <button type="button" className="btn small vol-open num" aria-expanded={open} aria-label={t('Volumen del aviso')} title={t('Volumen del aviso')} onClick={() => setOpen((o) => !o)}>{Math.round(vol * 100)}%</button>
      {open && <div className="vol-pop" role="dialog" aria-label={t('Volumen del aviso')}>{style === 'roulette' ? <RouletteVolume /> : <BananaVolume />}</div>}
    </span>
  );
}
