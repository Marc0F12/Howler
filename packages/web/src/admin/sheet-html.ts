import { FONT_LEVEL_PX, imageAlt, isSheetColor, isSheetUrl } from '@howler/shared';

/** Pasa el HTML del editor (contenteditable) a BBCode de Content Manager. Solo entiende lo que el propio editor produce. */
export function htmlToBbcode(root: Node): string {
  const kids = (el: Node): string => {
    let out = '';
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        // CM se traga cualquier [algo]: un corchete escrito a propósito va escapado (\[)
        out += (n.textContent ?? '').replace(/ /g, ' ').replace(/\r?\n/g, ' ').replace(/\[/g, '\\[');
        continue;
      }
      if (!(n instanceof HTMLElement)) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'DIV' || tag === 'P') {
        const inner = kids(n).replace(/\n$/, '');
        if (out !== '' && !out.endsWith('\n')) out += '\n';
        out += `${inner}\n`;
        continue;
      }
      const inner = kids(n);
      switch (tag) {
        case 'B': case 'STRONG': out += `[b]${inner}[/b]`; break;
        case 'I': case 'EM': out += `[i]${inner}[/i]`; break;
        case 'U': out += `[u]${inner}[/u]`; break;
        case 'S': case 'STRIKE': case 'DEL': out += `[s]${inner}[/s]`; break;
        case 'SUP': out += `[sup]${inner}[/sup]`; break;
        case 'A': { const href = n.getAttribute('href') ?? ''; out += isSheetUrl(href) ? `[url=${href}]${inner}[/url]` : inner; break; }
        case 'IMG': {
          const src = n.getAttribute('src') ?? '';
          const w = /^(\d{1,4})px$/.exec(n.style.maxWidth)?.[1] ?? '';
          const alt = (n.getAttribute('alt') ?? '').replace(/[[\]]/g, '').trim() || imageAlt(src);
          out += isSheetUrl(src) ? `[img=${src}${w ? `|${w}` : ''}]${alt}[/img]` : '';
          break;
        }
        case 'SPAN': {
          const px = /^(\d{1,2})px$/.exec(n.style.fontSize)?.[1];
          let s = px ? `[size=${px}]${inner}[/size]` : inner;
          if (/consolas|monospace/i.test(n.style.fontFamily)) s = `[mono]${s}[/mono]`;
          out += s;
          break;
        }
        case 'FONT': {
          let s = inner;
          const size = n.getAttribute('size');
          const color = n.getAttribute('color');
          if (size && FONT_LEVEL_PX[size]) s = `[size=${FONT_LEVEL_PX[size]}]${s}[/size]`;
          if (color && isSheetColor(color)) s = `[color=${color}]${s}[/color]`;
          out += s;
          break;
        }
        default: out += inner;
      }
    }
    return out;
  };
  return kids(root).replace(/\n+$/, '');
}
