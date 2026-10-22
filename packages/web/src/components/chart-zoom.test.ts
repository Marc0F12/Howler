import { describe, expect, it } from 'vitest';
import { followView, fullView, panView, zoomView } from './chart-zoom';

describe('zoom de gráficas', () => {
  it('acercar mantiene el punto bajo el puntero', () => {
    const v = zoomView(fullView(401), 401, 2, 0.25); // 0..400, foco en 100
    expect(v[1] - v[0]).toBeCloseTo(200);
    expect(v[0] + (v[1] - v[0]) * 0.25).toBeCloseTo(100);
  });
  it('no sale del recorrido ni baja del mínimo', () => {
    expect(zoomView(fullView(401), 401, 0.5, 0.5)).toEqual([0, 400]);
    const v = zoomView([0, 400], 401, 1000, 0.5);
    expect(v[1] - v[0]).toBeCloseTo(6);
    expect(panView([300, 400], 401, 500)).toEqual([300, 400]);
    expect(panView([10, 110], 401, -50)).toEqual([0, 100]);
  });
});

describe('followView: el zoom sigue el cursor de reproducción', () => {
  const n = 1001;
  it('sin zoom no hace nada', () => {
    expect(followView([0, 1000], n, 500)).toBeNull();
  });
  it('mientras el cursor está en el primer tramo de la ventana no mueve nada', () => {
    expect(followView([100, 200], n, 100)).toBeNull();
    expect(followView([100, 200], n, 140)).toBeNull();
  });
  it('si el cursor pasa de la posición de seguimiento, la ventana avanza y lo deja ahí', () => {
    const v = followView([100, 200], n, 160)!;
    expect(v[1] - v[0]).toBeCloseTo(100, 6);          // mismo zoom
    expect(160 - v[0]).toBeCloseTo(45, 6);            // el cursor queda al 45 %
  });
  it('si el cursor queda a la izquierda (se saltó atrás), la ventana lo recupera', () => {
    const v = followView([300, 400], n, 100)!;
    expect(v[0]).toBeCloseTo(80, 6);
  });
  it('no se sale de los extremos de la vuelta', () => {
    const v = followView([850, 950], n, 999)!;
    expect(v[1]).toBeCloseTo(1000, 6);
    expect(followView([850, 950], n, 960)![0]).toBeGreaterThanOrEqual(850);
  });
});
