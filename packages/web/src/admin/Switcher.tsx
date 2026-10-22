import { useState, type ReactNode } from 'react';

/** Varias secciones en una misma pestaña: un interruptor arriba y se enseña una a la vez. */
export function Switcher({ parts }: { parts: [id: string, label: string, node: ReactNode][] }) {
  const [sel, setSel] = useState(parts[0]![0]);
  const cur = parts.find((p) => p[0] === sel) ?? parts[0]!;
  return (
    <>
      <div className="segmented switcher" role="group">
        {parts.map(([id, label]) => <button key={id} type="button" className={id === cur[0] ? 'on' : ''} aria-pressed={id === cur[0]} onClick={() => setSel(id)}>{label}</button>)}
      </div>
      {cur[2]}
    </>
  );
}
