import { useEffect, useRef, useState } from 'react';
import type { ChampionshipDto } from '@howler/shared';
import { t } from '../../i18n';
import { downloadUrls } from './cup-math';

const KIND = () => ({ car: t('Coche'), track: t('Circuito'), weather: t('Clima'), skins: t('Skins'), other: t('Otro') }) as const;

/** Desplegable «Mods» con todos los del campeonato (generales y de cada carrera) y un botón para abrir todas las descargas, con confirmación. */
export function ModsMenu({ c }: { c: ChampionshipDto }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const seen = new Set<string>();
  const mods = [...c.mods, ...c.roundList.flatMap((r) => r.mods)].filter((m) => { const k = `${m.url}|${m.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const urls = downloadUrls(mods);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (mods.length === 0) return null;
  const kinds = KIND();
  const openAll = () => {
    let opened = 0;
    for (const u of urls) if (window.open(u, '_blank', 'noopener,noreferrer')) opened++;
    setAsking(false);
    setNote(opened < urls.length ? t('El navegador ha bloqueado {n} ventanas: permite las ventanas emergentes de esta web y vuelve a probar.', { n: urls.length - opened }) : t('Se han abierto {n} páginas de descarga.', { n: opened }));
  };
  return (
    <div className="cup-mods" ref={box}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => { setOpen((o) => !o); setAsking(false); setNote(null); }}>{t('Mods')} <span className="muted">({mods.length})</span> <span aria-hidden="true">▾</span></button>
      {open && (
        <div className="cup-mods-pop" role="dialog" aria-label={t('Mods del campeonato')}>
          <ul>
            {mods.map((m) => (
              <li key={`${m.id}-${m.url}`}>
                <span className="cup-mods-kind">{kinds[m.kind]}</span>
                <a href={/^https?:\/\//i.test(m.url) ? m.url : undefined} target="_blank" rel="noopener noreferrer nofollow">{m.name}</a>
              </li>
            ))}
          </ul>
          {urls.length > 1 && !asking && <button type="button" className="btn small" onClick={() => { setAsking(true); setNote(null); }}>{t('Abrir todas las descargas')}</button>}
          {asking && (
            <div className="cup-mods-ask" role="alertdialog" aria-label={t('Confirmar')}>
              <p>{t('¿Seguro que quieres abrir las páginas de descarga de todos los mods?')}</p>
              <span className="row"><button type="button" className="btn small primary" onClick={openAll}>{t('Sí, abrirlas')}</button><button type="button" className="btn small" onClick={() => setAsking(false)}>{t('No')}</button></span>
            </div>
          )}
          {note && <p className="muted" role="status">{note}</p>}
        </div>
      )}
    </div>
  );
}
