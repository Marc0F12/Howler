import { Fragment, type ReactNode } from 'react';
import { t } from '../i18n';
import { changeCategory } from './md-cats';

const CAT_LABEL = { new: () => t('Novedades'), improved: () => t('Mejoras'), fixed: () => t('Arreglos'), design: () => t('Diseño') } as const;

/** Texto en línea: **negrita**, `código` y [enlaces](https://…). Solo se admiten enlaces http(s); todo lo demás se escribe tal cual. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0, k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++}>{m[2]}</code>);
    else out.push(<a key={k++} href={m[4]} target="_blank" rel="noopener noreferrer nofollow">{m[3]}</a>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Markdown mínimo y seguro para las notas de una release: títulos, listas, negrita, código y enlaces. Nunca inserta HTML. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const li = /^\s*[-*+]\s+(.*)$/.exec(line);
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (li) { list.push(li[1]!); continue; }
    flush();
    const cat = h ? changeCategory(h[2]!) : null;
    if (h && cat) blocks.push(<h4 key={blocks.length} className="md-cat" data-cat={cat}>{CAT_LABEL[cat]()}</h4>);
    else if (h) blocks.push(<h4 key={blocks.length}>{inline(h[2]!)}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
