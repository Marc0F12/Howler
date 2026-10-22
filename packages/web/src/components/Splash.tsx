import { useEffect, useRef, useState } from 'react';
import { playEntrance, reducedMotion } from '../brand/anim';
import capas from '../brand/howler-capas.svg?raw';

const KEY = 'howler.splash';
const seen = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };

/** Placa vertical del logo: la misma figura en una tesela más alta, con la palabra «HOWLER» dentro, abajo. */
const PLACA = capas
  .replace('viewBox="0 0 1000 1000" width="1000" height="1000"', 'viewBox="0 0 1000 1360" width="1000" height="1360"')
  .replace('<rect width="1000" height="1000" rx="220">', '<rect width="1000" height="1360" rx="220">')
  .replace(/(<rect id="fondo"[^>]*?)height="1000"/, '$1height="1360"')
  .replace('<g id="figura"', '<rect y="940" width="1000" height="420" fill="#050505"></rect><g id="figura"')
  .replace('</svg>', '<text id="palabra" x="500" y="1201.6" text-anchor="middle" dominant-baseline="middle" textLength="720" lengthAdjust="spacing" style="font-family:HowlerWord,sans-serif;font-weight:800;font-stretch:130%;font-size:138px;fill:#c8923a;opacity:0">HOWLER</text></svg>');

/** Animación de abrir el panel: la cámara sale de la boca del mono, aúlla y la palabra «HOWLER» cae sobre la placa y se queda un momento. Una vez por ventana; se salta con un clic o una tecla; no sale con movimiento reducido. */
export function Splash() {
  const [open, setOpen] = useState(() => !seen() && !reducedMotion());
  const [leaving, setLeaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const placa = useRef<HTMLSpanElement>(null);
  const close = () => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* sin almacenamiento */ }
    setLeaving(true);
    window.setTimeout(() => setOpen(false), 250);
  };
  useEffect(() => {
    if (!open) return;
    const svg = placa.current?.querySelector('svg');
    if (!svg || !stage.current || !placa.current) return;
    const run = playEntrance(placa.current, stage.current, svg);
    const end = window.setTimeout(close, run.total + 1300); // las letras se quedan ~1,3 s antes de quitar todo
    window.addEventListener('keydown', close);
    return () => { window.clearTimeout(end); window.removeEventListener('keydown', close); run.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className={`splash${leaving ? ' leaving' : ''}`} role="presentation" onClick={close}>
      <div ref={stage} className="splash-stage">
        <span ref={placa} className="howler-mark splash-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PLACA }} />
      </div>
    </div>
  );
}
