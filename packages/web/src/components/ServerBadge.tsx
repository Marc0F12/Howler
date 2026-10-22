import { cleanBadgeColor, readableOn } from '@howler/shared';

/** Insignia de un servidor. Sin colores propios usa los de la web; con fondo y sin letras, elige negro o blanco según se lea mejor. */
export function ServerBadge({ text, bg = '', fg = '', title }: { text: string; bg?: string; fg?: string; title?: string }) {
  const back = cleanBadgeColor(bg);
  const front = cleanBadgeColor(fg) || (back ? readableOn(back) : '');
  return (
    <span className="server-badge" title={title} style={back || front ? { background: back || undefined, color: front || undefined, borderColor: back || front } : undefined}>
      {text}
    </span>
  );
}
