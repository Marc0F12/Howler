import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { t } from '../i18n';

/** Lo que recibe una gráfica para poder subirse o bajarse de sitio. */
export interface OrderProps { canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void; /** Si existe, la gráfica lleva un ojo para ocultarla. */ onHide?: () => void }

/** Ojo abierto (la gráfica se ve; pulsar la oculta) o cerrado (oculta; pulsar la muestra). */
export function EyeButton({ closed, onClick, label }: { closed: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="chart-eye" aria-pressed={closed} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {closed
          ? <><path d="M3 12c2.2 3.4 5.4 5 9 5s6.8-1.6 9-5" /><path d="M5.5 15.2 4 17.5M9.5 16.8 9 19.2M14.5 16.8l.5 2.4M18.5 15.2l1.5 2.3" /></>
          : <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
  );
}

/** Dos triángulos (arriba y abajo) para mover una gráfica. */
export function ChartOrderButtons({ order }: { order: OrderProps }) {
  return (
    <span className="chart-order">
      {order.onHide && <EyeButton closed={false} onClick={order.onHide} label={t('Ocultar gráfica')} />}
      <button type="button" aria-label={t('Subir gráfica')} title={t('Subir gráfica')} disabled={!order.canUp} onClick={order.onUp}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,2.5 11,10 1,10" /></svg>
      </button>
      <button type="button" aria-label={t('Bajar gráfica')} title={t('Bajar gráfica')} disabled={!order.canDown} onClick={order.onDown}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,9.5 11,2 1,2" /></svg>
      </button>
    </span>
  );
}

/**
 * Pinta sus hijos en el orden elegido y les da las flechas: cada hijo debe llevar `key` = id de su gráfica y aceptar la prop `order`.
 * Los hijos sin id conocido (avisos...) se quedan al final. Subir o bajar intercambia con la gráfica visible vecina.
 */
export function OrderedCharts({ order, onSwap, onHide, children }: { order: readonly string[]; onSwap: (a: string, b: string) => void; onHide?: (id: string) => void; children: ReactNode }) {
  const idOf = (el: ReactElement) => String(el.key ?? '').replace(/^\.\$/, '');
  const all = Children.toArray(children).filter(isValidElement) as ReactElement<{ order?: OrderProps }>[];
  const charts = all.filter((el) => order.includes(idOf(el)));
  const rest = all.filter((el) => !order.includes(idOf(el)));
  const sorted = [...charts].sort((a, b) => order.indexOf(idOf(a)) - order.indexOf(idOf(b)));
  return (
    <>
      {sorted.map((el, i) => {
        const id = idOf(el), up = sorted[i - 1], down = sorted[i + 1];
        return cloneElement(el, {
          order: { canUp: !!up, canDown: !!down, onUp: () => up && onSwap(id, idOf(up)), onDown: () => down && onSwap(id, idOf(down)), onHide: onHide ? () => onHide(id) : undefined },
        });
      })}
      {rest}
    </>
  );
}
