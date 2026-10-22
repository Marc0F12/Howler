import { useEffect, useMemo, useState } from 'react';
import {
  BADGE_BGS, BADGE_FINISHES, BADGE_ORNAMENTS, BADGE_PALETTES, BADGE_PRESETS, BADGE_RIMS, BADGE_SHAPES, BADGE_TEXT_MODES, DEFAULT_EMBLEM_FIT, EMBLEM_FIT_LIMITS, MAX_BADGE_TEXT,
  OWN_EMBLEMS, RIM_TEXT_SHAPES, newBadge, randomBadge, seededRandom,
  type BadgeDesign, type BadgeColorKey, type BadgeOrnament,
} from '@howler/shared';
import { badgeDataUri } from '../../badge/badge-image';
import { useIcons } from '../../badge/library';
import { rasterizeBadge } from '../../badge/raster';
import { t } from '../../i18n';
import { Notice, useNotice } from '../ui';
import { BG_LABELS, COLOR_LABELS, FINISH_LABELS, ORNAMENT_LABELS, PALETTE_LABELS, PRESET_LABELS, RIM_LABELS, SHAPE_LABELS, TEXT_MODE_LABELS } from './badge-labels';
import { EmblemPicker } from './EmblemPicker';

const COLOR_KEYS: BadgeColorKey[] = ['rim1', 'rim2', 'bg1', 'bg2', 'accent', 'emblem', 'outline', 'text'];

function Chips<T extends string>({ label, list, labels, value, onPick, disabled }: { label: string; list: readonly T[]; labels: Record<T, string>; value: T; onPick: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <fieldset className="bge-set">
      <legend>{label}</legend>
      <div className="bge-chips">
        {list.map((v) => <button key={v} type="button" className="bge-chip" aria-pressed={value === v} disabled={disabled?.(v)} title={disabled?.(v) ? t('Solo en círculo y cuadrado') : undefined} onClick={() => onPick(v)}>{labels[v]}</button>)}
      </div>
    </fieldset>
  );
}

/** Editor de insignias por capas (solo en el panel). Al aceptar devuelve el diseño y el PNG de 1024 px con transparencia. */
export function BadgeEditor({ initial, onApply, onClose }: { initial: BadgeDesign; onApply: (design: BadgeDesign, png: File) => Promise<unknown>; onClose: () => void }) {
  const [S, setS] = useState<BadgeDesign>(initial);
  const { icons, lookup, failed } = useIcons();
  const { notice, run } = useNotice();
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const rimOk = RIM_TEXT_SHAPES.includes(S.shape);
  const patch = (p: Partial<BadgeDesign>) => setS((s) => {
    const n = { ...s, ...p };
    if (!RIM_TEXT_SHAPES.includes(n.shape) && (n.textMode === 'rim' || n.textMode === 'rim2')) n.textMode = 'band';
    return n;
  });
  const fit = (k: keyof typeof DEFAULT_EMBLEM_FIT, v: number) => setS((s) => ({ ...s, emblemFit: { ...s.emblemFit, [k]: v } }));
  const toggleOrnament = (o: BadgeOrnament) => setS((s) => ({ ...s, ornaments: BADGE_ORNAMENTS.filter((x) => (x === o ? !s.ornaments.includes(o) : s.ornaments.includes(x))) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const preview = useMemo(() => badgeDataUri(S, lookup), [S, lookup]);
  const presets = useMemo(() => (lookup ? BADGE_PRESETS.map((p) => ({ name: p.name, design: newBadge({ ...p.design, colors: BADGE_PALETTES[p.palette]!.colors }) })) : []), [lookup]);
  const pool = useMemo(() => [...Object.keys(OWN_EMBLEMS).map((i) => 'own:' + i), ...(icons ?? []).map((i) => 'em:' + i.id)], [icons]);
  const gallery = useMemo(() => { const r = seededRandom((Date.now() + round * 7919) >>> 0); return Array.from({ length: 12 }, () => randomBadge(r, pool)); }, [pool, round]);

  const apply = async () => {
    setBusy(true);
    await run(async () => {
      const blob = await rasterizeBadge(S, lookup);
      await onApply(S, new File([blob], 'insignia.png', { type: 'image/png' }));
      return { ok: true };
    }, t('Insignia guardada como imagen del campeonato'));
    setBusy(false);
  };

  return (
    <div className="pick-overlay" role="dialog" aria-modal="true" aria-label={t('Creador de insignias')}>
      <div className="bge">
        <header className="bge-head">
          <h3>{t('Creador de insignias')}</h3>
          <button type="button" className="btn small" onClick={onClose} disabled={busy}>{t('Cancelar')}</button>
        </header>
        <div className="bge-body">
          <section className="bge-stage" aria-label={t('Vista previa')}>
            <div className="bge-board"><img src={preview} alt={t('Vista previa de la insignia')} draggable={false} /></div>
            <div className="row">
              <button type="button" className="btn" onClick={() => setS((s) => ({ ...randomBadge(Math.random, pool), text: s.text, text2: s.text2 })) }>{t('Aleatoria')}</button>
              <button type="button" className="btn primary" disabled={busy} onClick={apply}>{busy ? t('Creando…') : t('Usar esta insignia')}</button>
            </div>
            <Notice notice={notice} />
          </section>

          <section className="bge-controls" aria-label={t('Controles')}>
            {presets.length > 0 && (
              <fieldset className="bge-set">
                <legend>{t('Plantillas')}</legend>
                <div className="bge-presets">
                  {presets.map((p) => (
                    <button key={p.name} type="button" onClick={() => setS((s) => ({ ...p.design, shadow: s.shadow }))}>
                      <img src={badgeDataUri(p.design, lookup)} alt="" width={64} height={64} /><span>{PRESET_LABELS[p.name] ?? p.name}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <Chips label={t('Forma')} list={BADGE_SHAPES} labels={SHAPE_LABELS} value={S.shape} onPick={(shape) => patch({ shape })} />
            <Chips label={t('Marco')} list={BADGE_RIMS} labels={RIM_LABELS} value={S.rim} onPick={(rim) => patch({ rim })} />
            <Chips label={t('Fondo')} list={BADGE_BGS} labels={BG_LABELS} value={S.bg} onPick={(bg) => patch({ bg })} />
            <fieldset className="bge-set">
              <legend>{t('Emblema central')}</legend>
              <EmblemPicker value={S.emblem} icons={icons} failed={failed} onPick={(emblem) => patch({ emblem, emblemFit: { ...DEFAULT_EMBLEM_FIT } })} />
              <div className="bge-sliders">
                {([['size', t('Tamaño')], ['dx', t('Posición horizontal')], ['dy', t('Posición vertical')], ['rot', t('Giro')]] as const).map(([k, label]) => (
                  <label key={k}>{label}<input type="range" min={EMBLEM_FIT_LIMITS[k][0]} max={EMBLEM_FIT_LIMITS[k][1]} step={1} value={S.emblemFit[k]} onChange={(e) => fit(k, Number(e.target.value))} /></label>
                ))}
              </div>
              <div className="row"><button type="button" className="btn small" onClick={() => patch({ emblemFit: { ...DEFAULT_EMBLEM_FIT } })}>{t('Centrar emblema')}</button><span className="hint">{t('El emblema se centra solo por su forma real; aquí lo afinas.')}</span></div>
            </fieldset>
            <fieldset className="bge-set">
              <legend>{t('Adornos (combina los que quieras)')}</legend>
              <div className="bge-chips">
                {BADGE_ORNAMENTS.map((o) => <button key={o} type="button" className="bge-chip" aria-pressed={S.ornaments.includes(o)} onClick={() => toggleOrnament(o)}>{ORNAMENT_LABELS[o]}</button>)}
              </div>
              <p className="hint">{t('Alas, banderas, llamas y corona sobresalen del marco.')}</p>
            </fieldset>
            <Chips label={t('Acabado')} list={BADGE_FINISHES} labels={FINISH_LABELS} value={S.finish} onPick={(finish) => patch({ finish })} />
            <fieldset className="bge-set">
              <legend>{t('Texto (sigue la forma)')}</legend>
              <div className="bge-chips">
                {BADGE_TEXT_MODES.map((m) => {
                  const off = !rimOk && (m === 'rim' || m === 'rim2');
                  return <button key={m} type="button" className="bge-chip" aria-pressed={S.textMode === m} disabled={off} title={off ? t('Solo en círculo y cuadrado') : undefined} onClick={() => patch({ textMode: m })}>{TEXT_MODE_LABELS[m]}</button>;
                })}
              </div>
              <div className="row">
                <input type="text" maxLength={MAX_BADGE_TEXT} value={S.text} onChange={(e) => patch({ text: e.target.value })} aria-label={t('Texto')} placeholder={t('Texto')} />
                {S.textMode === 'rim2' && <input type="text" maxLength={MAX_BADGE_TEXT} value={S.text2} onChange={(e) => patch({ text2: e.target.value })} aria-label={t('Texto superior')} placeholder={t('Texto superior')} />}
              </div>
              {!rimOk && <p className="hint">{t('El texto escrito en el borde solo está en círculo y cuadrado: en escudo y hexágono el borde cambia de dirección.')}</p>}
            </fieldset>
            <fieldset className="bge-set">
              <legend>{t('Colores')}</legend>
              <div className="bge-pal">
                {BADGE_PALETTES.map((p) => (
                  <button key={p.name} type="button" title={PALETTE_LABELS[p.name] ?? p.name} aria-label={PALETTE_LABELS[p.name] ?? p.name} onClick={() => patch({ colors: { ...p.colors } })}>
                    {[p.colors.rim1, p.colors.bg1, p.colors.bg2, p.colors.accent, p.colors.emblem].map((c, i) => <i key={i} style={{ background: c }} />)}
                  </button>
                ))}
              </div>
              <div className="bge-colors">
                {COLOR_KEYS.map((k) => (
                  <label key={k}><input type="color" value={S.colors[k]} onChange={(e) => patch({ colors: { ...S.colors, [k]: e.target.value.toLowerCase() } })} aria-label={COLOR_LABELS[k]} /> {COLOR_LABELS[k]}</label>
                ))}
              </div>
              <label className="inline"><input type="checkbox" checked={S.shadow} onChange={(e) => patch({ shadow: e.target.checked })} /> {t('Sombra en la vista previa (la imagen final va sin sombra)')}</label>
            </fieldset>
            <fieldset className="bge-set">
              <legend>{t('Variaciones al azar (pulsa una para editarla)')}</legend>
              <div className="bge-gallery">
                {gallery.map((g, i) => <button key={i} type="button" aria-label={t('Variación {n}', { n: i + 1 })} onClick={() => setS((s) => ({ ...g, text: s.text, text2: s.text2 }))}><img src={badgeDataUri(g, lookup)} alt="" /></button>)}
              </div>
              <button type="button" className="btn small" onClick={() => setRound((r) => r + 1)}>{t('Otras variaciones')}</button>
            </fieldset>
          </section>
        </div>
      </div>
    </div>
  );
}
