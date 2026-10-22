/**
 * Identidad visual de cada piloto en el mapa: número + color + forma, estable durante la sesión.
 * 10 colores × 5 formas = 50 combinaciones distintas (el servidor admite hasta 32 coches), y la forma
 * ayuda a distinguir a quien no distingue bien los colores. Los colores evitan el verde (servidor en directo)
 * y el morado (mejor sector), que tienen significado propio en el resto de la web.
 */
const PALETTE = ['#4f8cff', '#ff8a3d', '#e5484d', '#f2c94c', '#2ec4c4', '#f06ca8', '#9aa5b1', '#c08457', '#7dd3fc', '#e8ebf2'] as const;
export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hexagon'] as const;
export type Shape = (typeof SHAPES)[number];

export interface MarkerStyle {
  /** Número que se enseña en el marcador y en la leyenda (el hueco del coche en el servidor + 1). */
  number: number;
  color: string;
  shape: Shape;
}

/** Los temas con paneles de cristal (Essential) dibujan solo círculos numerados, como su HUD de referencia. */
const circlesOnly = () => typeof document !== 'undefined' && document.documentElement.dataset.panels === 'glass';

export function markerStyle(carId: number): MarkerStyle {
  return { number: carId + 1, color: PALETTE[carId % PALETTE.length]!, shape: circlesOnly() ? 'circle' : SHAPES[Math.floor(carId / PALETTE.length) % SHAPES.length]! };
}

/** Contorno de la forma centrada en (0,0) con radio r. */
function outline(shape: Shape, r: number): string {
  const poly = (n: number, rot: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n;
      return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
  switch (shape) {
    case 'square': return `${-r * 0.88},${-r * 0.88} ${r * 0.88},${-r * 0.88} ${r * 0.88},${r * 0.88} ${-r * 0.88},${r * 0.88}`;
    case 'triangle': return poly(3, -Math.PI / 2);
    case 'diamond': return poly(4, -Math.PI / 2);
    case 'hexagon': return poly(6, 0);
    default: return '';
  }
}

/** Marcador SVG: forma de color con el número dentro. Se usa en el mapa y en la leyenda. */
export function Marker({ carId, r = 12, highlighted = false }: { carId: number; r?: number; highlighted?: boolean }) {
  const s = markerStyle(carId);
  const stroke = highlighted ? 'var(--paper)' : 'rgba(0,0,0,0.65)';
  const sw = highlighted ? r * 0.18 : r * 0.12;
  const shape =
    s.shape === 'circle' ? (
      <circle r={r} fill={s.color} stroke={stroke} strokeWidth={sw} />
    ) : (
      <polygon points={outline(s.shape, r)} fill={s.color} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
    );
  // El triángulo tiene el centro visual más abajo: se baja un poco el número para que quede dentro.
  const dy = s.shape === 'triangle' ? r * 0.2 : 0;
  return (
    <>
      {shape}
      <text y={dy} textAnchor="middle" dominantBaseline="central" fontSize={r * (s.number > 9 ? 0.95 : 1.15)} fontWeight={700} fill="var(--ink)" style={{ pointerEvents: 'none' }}>
        {s.number}
      </text>
    </>
  );
}
