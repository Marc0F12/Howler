/** Iconos de las cifras de un coche (trazo fino, `currentColor`). */
export type SpecKind = 'power' | 'weight' | 'drive' | 'gears' | 'ratio' | 'torque' | 'speed' | 'other';

/** A qué cifra corresponde una etiqueta de ficha (en español o inglés). */
export function specKind(label: string): SpecKind {
  const s = label.toLowerCase();
  if (/relaci|potencia\/peso|power.?to/.test(s)) return 'ratio';
  if (/potencia|power|^bhp|^hp/.test(s)) return 'power';
  if (/peso|weight|mass/.test(s)) return 'weight';
  if (/tracci|drivetrain|^drive|transmis/.test(s)) return 'drive';
  if (/marcha|gear|cambio/.test(s)) return 'gears';
  if (/par\b|torque/.test(s)) return 'torque';
  if (/velocidad|top.?speed|v\.? ?m[aá]x/.test(s)) return 'speed';
  return 'other';
}

/** Qué ejes mueven las ruedas, a partir del texto de la ficha («Trasera», «RWD», «AWD», «Delantera»…). */
export type DriveAxle = 'rear' | 'front' | 'all';
export function driveAxle(value: string): DriveAxle {
  const v = value.toLowerCase();
  if (/total|awd|4x4|4wd|integral|all/.test(v)) return 'all';
  if (/delant|front|fwd|ff\b/.test(v)) return 'front';
  return 'rear';
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function SpecIcon({ kind, value = '', size = 22 }: { kind: SpecKind; value?: string; size?: number }) {
  const axle = kind === 'drive' ? driveAxle(value) : null;
  const wheel = (x: number, y: number, on: boolean) => <rect key={`${x}${y}`} x={x} y={y} width="3" height="5" rx="1" fill={on ? 'currentColor' : 'none'} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" {...P}>
      {kind === 'power' && (<><path d="M4 10h2l1-2h8l1 2h3v6h-3l-1 2H8l-1-2H4z" /><path d="M10 8V5.5M8 5.5h4M16 12h2.5" /></>)}
      {kind === 'weight' && (<><path d="M8.5 7.5a3.5 3.5 0 1 1 7 0" /><path d="M6 21l1.6-13.5h8.8L18 21z" /></>)}
      {kind === 'drive' && (<><rect x="8.5" y="3" width="7" height="18" rx="3" />{wheel(4.5, 5, axle !== 'rear')}{wheel(16.5, 5, axle !== 'rear')}{wheel(4.5, 14, axle !== 'front')}{wheel(16.5, 14, axle !== 'front')}</>)}
      {kind === 'gears' && (<><path d="M7 5v14M12 5v14M17 5v14M7 12h10" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /></>)}
      {(kind === 'ratio' || kind === 'speed') && (<><path d="M4 17a8 8 0 0 1 16 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></>)}
      {kind === 'torque' && (<><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v4h-4" /></>)}
      {kind === 'other' && <circle cx="12" cy="12" r="2" />}
    </svg>
  );
}
