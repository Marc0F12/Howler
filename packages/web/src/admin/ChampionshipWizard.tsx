import { t } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import { adminApi, uploadChampionshipImage } from './adminApi';
import { ChampionshipParticipants } from './ChampionshipParticipants';
import { ChampionshipRounds } from './ChampionshipRounds';
import { problems, STEPS, toInput, type Draft } from './championship-form';
import { ScoringEditor } from './ScoringEditor';
import { autoBadge, type BadgeDesign } from '@howler/shared';
import { imageFit } from '../components/cup/cup-math';
import { BadgeEditor } from './badge/BadgeEditor';
import { Card, Notice, useNotice } from './ui';
import type { ChampionshipFormat, ChampionshipStatus } from '@howler/shared';

const FORMATS: [ChampionshipFormat, string, string][] = [
  ['individual', t('Individual'), t('Cada piloto puntúa por su cuenta.')],
  ['pairs', t('Parejas'), t('Dos pilotos por pareja; hay clasificación de pilotos y de parejas.')],
  ['teams', t('Equipos'), t('Tantos pilotos como quieras por equipo; clasificación de pilotos y de equipos.')],
];
const STATUSES: [ChampionshipStatus, string, string][] = [
  ['draft', t('Borrador'), t('Solo lo ves tú en el panel; no se asigna ninguna sesión.')],
  ['active', t('Activo'), t('Visible en la web; Howler asigna solo las carreras que se jueguen.')],
  ['finished', t('Terminado'), t('Visible en la web como campeonato pasado.')],
];

/** Asistente para crear o editar un campeonato, en 5 pasos. Nada se guarda hasta pulsar «Guardar» al final. */
export function ChampionshipWizard({ initial, onSaved, onCancel }: { initial: Draft; onSaved: (id: number) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState(0);
  const { notice, run } = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [designing, setDesigning] = useState(false);
  /** Punto de partida del creador: el diseño guardado o, si no hay, la insignia automática con el nombre del campeonato. */
  const badgeStart = useMemo((): BadgeDesign => draft.badgeDesign ?? { ...autoBadge(draft.name, draft.teams.map((x) => x.color)), text: draft.name.trim().toUpperCase().slice(0, 20), textMode: 'band', shadow: true }, [draft.badgeDesign, draft.name, draft.teams]);
  const upload = (file: File) => run(async () => {
    if (file.size > 3_000_000) throw new Error(t('La imagen pesa demasiado (máximo 3 MB).'));
    setUploading(true);
    try { const { imageUrl, hasAlpha } = await uploadChampionshipImage(file); setDraft((d) => ({ ...d, imageUrl, imageFit: hasAlpha ? 'contain' : '', badgeDesign: null })); } finally { setUploading(false); }
    return { ok: true };
  }, t('Imagen subida'));
  const errs = problems(draft, step);
  const all = [0, 1, 2, 3].flatMap((s) => problems(draft, s));
  const last = step === STEPS.length - 1;

  const save = () => run(async () => {
    const input = toInput(draft);
    const { id } = draft.id != null ? await adminApi.updateChampionship(draft.id, input) : await adminApi.createChampionship(input);
    onSaved(id);
    return { ok: true };
  }, t('Campeonato guardado'));

  return (
    <Card title={draft.id != null ? t('Editar «{name}»', { name: initial.name }) : t('Nuevo campeonato')} aside={<button type="button" className="btn small" onClick={onCancel}>{t('Cancelar')}</button>}>
      <ol className="steps" aria-label={t('Pasos')}>
        {STEPS.map((l, i) => (
          <li key={l} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step && errs.length > 0} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>{i + 1}. {l}</button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="wiz-step">
          <label className="mini">{t('Nombre')}<input type="text" className="wide" maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="mini">{t('Descripción (opcional)')}<input type="text" className="wide" maxLength={2000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="image-pick">
            <div className={`image-preview square fit-${imageFit({ imageUrl: draft.imageUrl, imageFit: draft.imageFit || null })}`} style={draft.imageUrl ? { backgroundImage: `url("${draft.imageUrl}")` } : undefined} role="img" aria-label={draft.imageUrl ? t('Imagen del campeonato') : t('Sin imagen')}>{!draft.imageUrl && <span className="muted">{t('Sin imagen')}</span>}</div>
            <div className="wiz-col">
              <strong>{t('Imagen del campeonato (opcional)')}</strong>
              <div className="row">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label={t('Elegir imagen')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                <button type="button" className="btn" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? t('Subiendo…') : draft.imageUrl ? t('Cambiar imagen…') : t('Subir imagen desde tu ordenador…')}</button>
                <button type="button" className="btn" onClick={() => setDesigning(true)}>{draft.badgeDesign ? t('Editar insignia…') : t('Crear insignia…')}</button>
                {draft.imageUrl && <button type="button" className="btn small" onClick={() => setDraft({ ...draft, imageUrl: '', badgeDesign: null })}>{t('Quitar')}</button>}
              </div>
              <p className="hint">{t('PNG, JPG, WebP o GIF de hasta 3 MB. Mejor cuadrada; también vale un PNG con transparencia (insignia, copa…).')}</p>
              {draft.imageUrl && (
                <fieldset className="fit-pick">
                  <legend>{t('Cómo se ve en su marco cuadrado')}</legend>
                  {([['', t('Automático')], ['cover', t('Llenar el marco (foto)')], ['contain', t('Verla entera (insignia, copa)')]] as const).map(([v, l]) => (
                    <label key={v} className="inline"><input type="radio" name="fit" checked={draft.imageFit === v} onChange={() => setDraft({ ...draft, imageFit: v })} /> {l}</label>
                  ))}
                </fieldset>
              )}
              <label className="mini">{t('…o pega un enlace')}<input type="text" className="wide" placeholder="https://…/portada.jpg" value={draft.imageUrl.startsWith('/api/') ? '' : draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value, badgeDesign: null })} /></label>
            </div>
          </div>
          <div className="choice-grid" role="radiogroup" aria-label={t('Tipo de campeonato')}>
            {FORMATS.map(([k, l, d]) => (
              <label key={k} className={`choice ${draft.format === k ? 'on' : ''}`}>
                <input type="radio" name="format" checked={draft.format === k} onChange={() => setDraft({ ...draft, format: k })} />
                <strong>{l}</strong><span className="muted">{d}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {designing && (
        <BadgeEditor
          initial={badgeStart}
          onClose={() => setDesigning(false)}
          onApply={async (design, png) => {
            if (png.size > 3_000_000) throw new Error(t('La imagen pesa demasiado (máximo 3 MB).'));
            const { imageUrl } = await uploadChampionshipImage(png);
            setDraft((d) => ({ ...d, imageUrl, imageFit: 'contain', badgeDesign: design }));
            setDesigning(false);
          }}
        />
      )}
      {step === 1 && <ChampionshipParticipants draft={draft} set={setDraft} />}
      {step === 2 && <ChampionshipRounds draft={draft} set={setDraft} />}
      {step === 3 && <ScoringEditor scoring={draft.scoring} onChange={(scoring) => setDraft({ ...draft, scoring })} teamed={draft.format !== 'individual'} />}
      {last && (
        <div className="wiz-step">
          <dl className="summary">
            <div><dt>{t('Nombre')}</dt><dd>{draft.name || '—'}</dd></div>
            <div><dt>{t('Tipo')}</dt><dd>{FORMATS.find(([k]) => k === draft.format)![1]}</dd></div>
            <div><dt>{t('Participantes')}</dt><dd>{draft.entries.length}{draft.format !== 'individual' ? ` ${draft.format === 'pairs' ? t('en {n} parejas', { n: draft.teams.length }) : t('en {n} equipos', { n: draft.teams.length })}` : ''}</dd></div>
            <div><dt>{t('Carreras')}</dt><dd>{draft.rounds.map((r) => r.track || '¿?').join(' → ')}</dd></div>
            <div><dt>{t('Puntuación')}</dt><dd>{draft.scoring.mode === 'points' ? t('Puntos por puesto ({list}…)', { list: draft.scoring.pointsTable.slice(0, 3).join('-') }) : t('Acumulado: {metric}', { metric: draft.scoring.aggregate.metric })}{draft.scoring.bonuses.length ? ` + ${t('{n} extra(s)', { n: draft.scoring.bonuses.length })}` : ''}</dd></div>
            <div><dt>Mods</dt><dd>{draft.mods.length + draft.rounds.reduce((n, r) => n + r.mods.length, 0)}</dd></div>
          </dl>
          <fieldset>
            <legend>{t('Estado')}</legend>
            {STATUSES.map(([k, l, d]) => (
              <label key={k}><input type="radio" name="status" checked={draft.status === k} onChange={() => setDraft({ ...draft, status: k })} /> <strong>{l}</strong> <span className="muted">{d}</span></label>
            ))}
          </fieldset>
          {all.length > 0 && <ul className="warn-list">{all.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      {!last && errs.length > 0 && <ul className="warn-list">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
      <Notice notice={notice} />
      <div className="row between">
        <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('Atrás')}</button>
        {last
          ? <button type="button" className="btn primary" disabled={all.length > 0} onClick={save}>{t('Guardar campeonato')}</button>
          : <button type="button" className="btn primary" disabled={errs.length > 0} onClick={() => setStep(step + 1)}>{t('Siguiente')}</button>}
      </div>
    </Card>
  );
}
