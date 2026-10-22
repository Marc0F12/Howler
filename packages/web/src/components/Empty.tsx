import type { ReactNode } from 'react';

/** Estado vacío: qué pasa y, aparte, el siguiente paso. */
export function Empty({ children, next }: { children: ReactNode; next?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <p>{children}</p>
      {next && <p className="empty-next">{next}</p>}
    </div>
  );
}
