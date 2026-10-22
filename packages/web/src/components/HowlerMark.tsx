import { useEffect, useRef, useState } from 'react';
import capas from '../brand/howler-capas.svg?raw';
import { playLatido, playRecord } from '../brand/anim';

/** El mono de Howler (logo en capas). `live` hace latir la garganta mientras hay sesión; `record` aúlla cuando cambia (absoluto o personal). */
export function HowlerMark({ size = 36, live = false, record = null, className = '', howlOnRecord = false }: { howlOnRecord?: boolean; size?: number; live?: boolean; record?: 'absoluto' | 'personal' | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [howl, setHowl] = useState<'absoluto' | null>(null);
  useEffect(() => {
    if (!howlOnRecord) return;
    const on = () => { setHowl(null); window.setTimeout(() => setHowl('absoluto'), 0); };
    window.addEventListener('howler:record', on);
    return () => window.removeEventListener('howler:record', on);
  }, [howlOnRecord]);
  useEffect(() => {
    const svg = ref.current?.querySelector('svg');
    if (!svg || !live) return;
    const anims = playLatido(svg);
    return () => anims.forEach((a) => a.cancel());
  }, [live]);
  useEffect(() => {
    const svg = ref.current?.querySelector('svg');
    const kind = record ?? howl;
    if (!svg || !kind) return;
    const anims = playRecord(svg, kind);
    return () => anims.forEach((a) => a.cancel());
  }, [record, howl]);
  return <span ref={ref} className={`howler-mark ${className}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: capas }} />;
}
