import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t, tm } from '../i18n';

/** Botón que pide una segunda pulsación para acciones que no se pueden deshacer (expulsar, parar...). */
export function ConfirmButton({ label, confirmLabel = t('Confirmar'), onConfirm, danger = false, disabled = false }: {
  label: string; confirmLabel?: string; onConfirm: () => unknown; danger?: boolean; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`btn ${danger ? 'danger' : ''} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
        } else {
          window.clearTimeout(timer.current);
          setArmed(false);
          void onConfirm();
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Ejecuta una acción del panel y enseña el resultado (o el error) como aviso. */
export type NoticeRunner = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

/** Mensaje de resultado de la última acción, que se apaga solo. */
export function useNotice() {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = (ok: boolean, text: string) => {
    setNotice({ ok, text: tm(text) });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 6000);
  };
  /** Ejecuta una acción y enseña el resultado, o el error. Devuelve `true` si salió bien (para limpiar un campo solo entonces). */
  const run = async (action: () => Promise<{ ok?: boolean; reply?: string } | unknown>, success: string): Promise<boolean> => {
    try {
      const r = (await action()) as { ok?: boolean; reply?: string } | undefined;
      const ok = r?.ok !== false;
      show(ok, r?.reply ? `${success} — ${r.reply}` : success);
      return ok;
    } catch (e) {
      show(false, tm((e as Error).message));
      return false;
    }
  };
  return { notice, show, run };
}

export function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  return notice ? <p className={`notice ${notice.ok ? 'ok' : 'bad'}`} role="status">{notice.text}</p> : null;
}

/** Fila con etiqueta, control y una explicación de lo que hace el ajuste. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head"><h3>{title}</h3>{aside}</header>
      <div className="card-body">{children}</div>
    </section>
  );
}
