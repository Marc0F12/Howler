/** Verde respirando = en directo, ámbar fijo = esperando/reconectando, rojo fijo = caído. */
export function StatusLight({ state }: { state: 'live' | 'wait' | 'down' }) {
  return <span className={`light light-${state}`} aria-hidden="true" />;
}
