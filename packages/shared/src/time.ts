/** 83456 -> "1:23.456". Null/undefined -> "—". */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms);
  const min = Math.floor(total / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const s = `${String(sec).padStart(min > 0 ? 2 : 1, '0')}.${String(milli).padStart(3, '0')}`;
  return min > 0 ? `${min}:${s}` : s;
}

/** Diferencia con signo: 312 -> "+0.312", -312 -> "−0.312". */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(ms));
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}
