import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { t } from '../i18n';

export interface CardItem {
  key: string;
  title: string;
  subtitle?: string;
  /** URL de la vista previa; si falta o no carga, se enseña un recuadro con las iniciales. */
  image?: string;
  /** Texto del recuadro de respaldo (por defecto, las iniciales del título). */
  fallback?: string;
}

/** Imagen de una tarjeta con un recuadro de respaldo si no hay vista previa (contenido no instalado). */
export function Preview({ image, title, fallback, className }: { image?: string; title: string; fallback?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (!image || failed) {
    return <span className={`preview-fallback ${className ?? ''}`} aria-hidden="true">{fallback ?? title.slice(0, 2).toUpperCase()}</span>;
  }
  return <img className={className} src={image} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

const WHEEL_STEP_MS = 160;
/** Cuántas tarjetas a cada lado del centro se dibujan. */
const VISIBLE = 4;

/**
 * Ruleta 3D de tarjetas, como el selector de personaje de un juego de lucha: la tarjeta del centro es la activa y las
 * de los lados giran hacia atrás. Se navega arrastrando, con la rueda horizontal, con las flechas del teclado o con
 * los botones; pulsar una tarjeta lateral la centra y pulsar la del centro la elige (Enter o espacio también).
 */
export function Carousel3D({ items, selected, onPick, label, initialKey }: {
  items: CardItem[];
  /** Claves marcadas como elegidas (una o varias). */
  selected: string[];
  onPick: (key: string) => void;
  label: string;
  /** Tarjeta que arranca en el centro. */
  initialKey?: string;
}) {
  const start = Math.max(0, items.findIndex((i) => i.key === initialKey));
  const [active, setActive] = useState(start);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; at: number; moved: boolean } | null>(null);
  const lastWheel = useRef(0);
  const clamp = (n: number) => Math.min(items.length - 1, Math.max(0, n));
  const go = (delta: number) => setActive((a) => clamp(a + delta));

  useEffect(() => setActive((a) => clamp(a)), [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // La rueda horizontal (touchpad) mueve la ruleta; la vertical sigue desplazando la página.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheel.current < WHEEL_STEP_MS) return;
      lastWheel.current = now;
      go(e.deltaX > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = items[active]; if (it) onPick(it.key); }
  };

  return (
    <div className="carousel-wrap">
      <button type="button" className="carousel-arrow left" aria-label={t('Anterior')} disabled={active === 0} onClick={() => go(-1)}>‹</button>
      <div
        ref={root}
        className="carousel"
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        aria-activedescendant={items[active] ? `cc-${label}-${items[active]!.key}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => { drag.current = { x: e.clientX, at: active, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 8 && !d.moved) { d.moved = true; root.current?.setPointerCapture(e.pointerId); }
          if (d.moved) setActive(clamp(d.at - Math.round(dx / 110)));
        }}
        onPointerUp={() => { window.setTimeout(() => { drag.current = null; }, 0); }}
        onPointerCancel={() => { drag.current = null; }}
      >
        {items.map((it, i) => {
          const offset = i - active;
          const abs = Math.abs(offset);
          // Con cientos de tarjetas solo se dibujan (y solo cargan su imagen) las cercanas al centro.
          if (abs > VISIBLE) return null;
          const isSel = selected.includes(it.key);
          return (
            <div
              key={it.key}
              id={`cc-${label}-${it.key}`}
              role="option"
              aria-selected={isSel}
              className={`cc ${offset === 0 ? 'center' : ''} ${isSel ? 'sel' : ''}`}
              style={{ '--o': offset, '--a': abs, zIndex: 100 - abs, visibility: abs > 3 ? 'hidden' : 'visible' } as CSSProperties}
              onClick={() => {
                if (drag.current?.moved) return; // fue un arrastre, no una pulsación
                if (offset === 0) onPick(it.key); else setActive(i);
              }}
            >
              <Preview image={it.image} title={it.title} fallback={it.fallback} className="cc-img" />
              {isSel && <span className="cc-check" aria-hidden="true">✓</span>}
              <span className="cc-title">{it.title}</span>
              {it.subtitle && <span className="cc-sub">{it.subtitle}</span>}
            </div>
          );
        })}
      </div>
      <button type="button" className="carousel-arrow right" aria-label={t('Siguiente')} disabled={active >= items.length - 1} onClick={() => go(1)}>›</button>
      <p className="carousel-count" aria-hidden="true">{items.length ? active + 1 : 0} / {items.length}</p>
    </div>
  );
}
