import { t, tm } from '../i18n';
import { useRef, useState } from 'react';
import type { ImportReportDto, PlayerChoice, StrackerPreviewDto } from '@howler/shared';
import { useLive } from '../api';
import { adminApi, uploadStracker } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';
import { fmtDate, num } from '../format';

/** Valor del selector de cada jugador: `new`, `skip` o `link:<id>`. */
type Pick = string;
const toChoice = (v: Pick): PlayerChoice => (v === 'skip' ? { mode: 'skip' } : v.startsWith('link:') ? { mode: 'link', driverId: Number(v.slice(5)) } : { mode: 'new' });

/** Pilotos que creó una importación: cuando alguien ya juega con su Steam, se unen para tener un solo historial. */
function ImportedDrivers() {
  const { data, refresh } = useLive(adminApi.importedDrivers, [], (e) => e.type === 'results');
  const { notice, run } = useNotice();
  const [into, setInto] = useState<Record<number, string>>({});
  if (!data || data.imported.length === 0) return null;
  const targets = data.drivers.filter((d) => !data.imported.some((i) => i.id === d.id));
  return (
    <Card title={t('Pilotos importados sin unir')} aside={<span className="muted">{data.imported.length}</span>}>
      <p className="hint">{t('Estos pilotos se crearon al importar. Si alguien ya juega en tu servidor con su Steam, únelo con su piloto de Howler: todas sus vueltas pasan a él y este desaparece. No se puede deshacer.')}</p>
      <Notice notice={notice} />
      <div className="table-scroll">
        <table className="timing">
          <thead><tr><th>{t('Piloto importado')}</th><th className="num">{t('Vueltas')}</th><th>{t('Unir con')}</th><th /></tr></thead>
          <tbody>
            {data.imported.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td className="num">{num(p.laps)}</td>
                <td>
                  <select aria-label={t('Unir {name} con', { name: p.name })} value={into[p.id] ?? ''} onChange={(e) => setInto({ ...into, [p.id]: e.target.value })}>
                    <option value="">{t('Elegir piloto…')}</option>
                    {targets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td><ConfirmButton label={t('Unir')} confirmLabel={t('¿Seguro?')} disabled={!into[p.id]} onConfirm={() => run(async () => { await adminApi.mergeDrivers(p.id, Number(into[p.id])); refresh(); return { ok: true }; }, t('{name} unido', { name: p.name }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Pestaña «Importar»: trae el historial de stracker (archivo .db3) a Howler, decidiendo a quién corresponde cada jugador. */
export function ImportSection() {
  const { notice, run } = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StrackerPreviewDto | null>(null);
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [tracks, setTracks] = useState<Record<string, { track: string; layout: string }>>({});
  const [withChampionships, setWithChampionships] = useState(true);
  const [report, setReport] = useState<ImportReportDto | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = (file: File) => run(async () => {
    setBusy(true);
    setReport(null);
    try {
      const p = await uploadStracker(file);
      setPreview(p);
      setPicks(Object.fromEntries(p.players.map((x) => [x.id, x.suggestedDriverId != null ? `link:${x.suggestedDriverId}` : 'new'])));
      setTracks(Object.fromEntries(p.tracks.map((t) => [t.raw, { track: t.track, layout: t.layout }])));
      setWithChampionships(p.seasons.length > 0);
    } finally { setBusy(false); }
    return { ok: true, reply: t('archivo leído, revisa el resumen') };
  }, t('Listo'));

  const apply = () => run(async () => {
    if (!preview) return { ok: false };
    setBusy(true);
    setProgress({ done: 0, total: preview.sessions });
    try {
      const { jobId } = await adminApi.startStrackerImport({
        uploadId: preview.uploadId, players: Object.fromEntries(Object.entries(picks).map(([id, v]) => [id, toChoice(v)])), tracks, championships: withChampionships && preview.seasons.length > 0,
      });
      // La importación corre en segundo plano: se pregunta por el avance hasta que termina.
      for (;;) {
        const j = await adminApi.strackerImportStatus(jobId);
        setProgress({ done: j.done, total: j.total });
        if (j.state === 'error') throw new Error(j.error ?? t('La importación falló.'));
        if (j.state === 'done') { setReport(j.report); setPreview(null); break; }
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally { setBusy(false); setProgress(null); }
    return { ok: true };
  }, t('Importación terminada'));

  const cancel = async () => { if (preview) await adminApi.cancelStracker(preview.uploadId).catch(() => {}); setPreview(null); };
  const unknown = preview?.tracks.filter((t) => !t.known).length ?? 0;
  const importing = preview ? preview.sessions - preview.alreadyImported : 0;

  return (
    <>
      <Card title={t('Importar de stracker')}>
        <p className="hint">
          {t('Trae tus sesiones y vueltas de stracker (el archivo stracker.db3). Haz antes una copia de data\\howler.db. El archivo de stracker no se modifica. Se puede repetir sin miedo: lo que ya se importó se salta. stracker no guarda sectores con AssettoServer ni la velocidad de los choques, y su Steam ID viene cifrado, así que los jugadores se unen a los de Howler por nombre y con tu confirmación.')}
        </p>
        <div className="row">
          <input ref={fileRef} type="file" accept=".db3,.db,.sqlite,.sqlite3" hidden aria-label={t('Elegir archivo de stracker')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
          <button type="button" className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy && !preview ? t('Leyendo…') : t('Elegir archivo de stracker…')}</button>
          {preview && <button type="button" className="btn" disabled={busy} onClick={cancel}>{t('Cancelar')}</button>}
        </div>
        <Notice notice={notice} />
      </Card>

      {preview && (
        <>
          <Card title={t('Qué hay en el archivo')}>
            <dl className="summary">
              <div><dt>{t('Sesiones')}</dt><dd>{num(preview.sessions)} ({t('{n} ya importadas', { n: num(preview.alreadyImported) })})</dd></div>
              <div><dt>{t('Vueltas')}</dt><dd>{num(preview.laps)}</dd></div>
              <div><dt>{t('Temperaturas')}</dt><dd>{preview.lapsWithTemps > 0 ? t('{n} vueltas', { n: num(preview.lapsWithTemps) }) : t('ninguna')}</dd></div>
              <div><dt>{t('Ayudas')}</dt><dd>{preview.lapsWithAids > 0 ? t('{n} vueltas', { n: num(preview.lapsWithAids) }) : t('ninguna (stracker no las guarda con AssettoServer)')}</dd></div>
              <div><dt>{t('Ajustes de sesión')}</dt><dd>{preview.sessionsWithSettings > 0 ? t('{n} sesiones (combustible, daños, desgaste)', { n: num(preview.sessionsWithSettings) }) : t('ninguno')}</dd></div>
              <div><dt>{t('Periodo')}</dt><dd>{fmtDate(preview.from)} → {fmtDate(preview.to)}</dd></div>
              <div><dt>{t('Esquema')}</dt><dd>{t('stracker (versión {v})', { v: preview.version })}</dd></div>
            </dl>
          </Card>

          <Card title={t('Jugadores')}>
            <p className="hint">{t('Elige a quién corresponde cada uno. «Unir con…» pone sus vueltas en un piloto que ya tienes en Howler (así no se duplica); «Nuevo» crea un piloto; «No importar» deja fuera sus vueltas. Los que tienen el mismo nombre ya vienen propuestos.')}</p>
            <div className="table-scroll">
              <table className="timing">
                <thead><tr><th>{t('Jugador en stracker')}</th><th className="num">{t('Vueltas')}</th><th className="num">{t('Sesiones')}</th><th>{t('En Howler')}</th></tr></thead>
                <tbody>
                  {preview.players.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td><td className="num">{num(p.laps)}</td><td className="num">{num(p.sessions)}</td>
                      <td>
                        <select aria-label={t('Qué hacer con {name}', { name: p.name })} value={picks[p.id] ?? 'new'} onChange={(e) => setPicks({ ...picks, [p.id]: e.target.value })}>
                          <option value="new">{t('Nuevo piloto «{name}»', { name: p.name })}</option>
                          <option value="skip">{t('No importar')}</option>
                          <optgroup label={t('Unir con un piloto de Howler')}>
                            {preview.existingDrivers.map((d) => <option key={d.id} value={`link:${d.id}`}>{d.name}</option>)}
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('Circuitos')} aside={unknown > 0 ? <span className="badge pending">{t('{n} por revisar', { n: unknown })}</span> : undefined}>
            <p className="hint">{t('stracker junta circuito y layout con un guion. Howler los separa mirando lo que ya conoce; los marcados «revisar» no se han podido confirmar: corrige el circuito y el layout si hace falta (el layout vacío significa que el circuito no tiene).')}</p>
            <div className="table-scroll">
              <table className="timing">
                <thead><tr><th>{t('En stracker')}</th><th>{t('Circuito')}</th><th>{t('Layout')}</th><th className="num">{t('Vueltas')}</th></tr></thead>
                <tbody>
                  {preview.tracks.map((tk) => (
                    <tr key={tk.raw}>
                      <td className="muted">{tk.raw.split('/').pop()}</td>
                      <td><input type="text" aria-label={t('Circuito de {raw}', { raw: tk.raw })} value={tracks[tk.raw]?.track ?? ''} onChange={(e) => setTracks({ ...tracks, [tk.raw]: { track: e.target.value, layout: tracks[tk.raw]?.layout ?? '' } })} /></td>
                      <td><input type="text" aria-label={t('Layout de {raw}', { raw: tk.raw })} value={tracks[tk.raw]?.layout ?? ''} onChange={(e) => setTracks({ ...tracks, [tk.raw]: { track: tracks[tk.raw]?.track ?? '', layout: e.target.value } })} /></td>
                      <td className="num">{num(tk.laps)} {tk.known ? <span className="badge ok">ok</span> : <span className="badge pending">{t('revisar')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {preview.seasons.length > 0 && (
            <Card title={t('Campeonatos de stracker')}>
              <label><input type="checkbox" checked={withChampionships} onChange={(e) => setWithChampionships(e.target.checked)} /> {t('Crear como borrador {list}. Se crean en «Campeonatos» para que los revises y actives.', { list: preview.seasons.map((s) => t('«{name}» ({n} sesiones)', { name: s.name, n: s.sessions })).join(', ') })}</label>
            </Card>
          )}

          <div className="row">
            <button type="button" className="btn primary" disabled={busy || importing === 0 && !withChampionships} onClick={apply}>{busy ? t('Importando…') : t('Importar {n} sesiones', { n: num(importing) })}</button>
            {progress && progress.total > 0 && (
              <span className="import-progress" role="status" aria-live="polite">
                <progress value={progress.done} max={progress.total} aria-label={t('Progreso de la importación')} />
                <span className="muted">{t('{done} de {total} sesiones', { done: num(progress.done), total: num(progress.total) })}</span>
              </span>
            )}
            <span className="muted">{t('Con las reglas de vuelta válida que tienes ahora: puede que vueltas que stracker marcó como inválidas cuenten, y viceversa.')}</span>
          </div>
        </>
      )}

      <ImportedDrivers />

      {report && (
        <Card title={t('Resultado')}>
          <dl className="summary">
            <div><dt>{t('Sesiones')}</dt><dd>{t('{a} importadas, {b} saltadas', { a: num(report.sessionsImported), b: num(report.sessionsSkipped) })}</dd></div>
            <div><dt>{t('Vueltas')}</dt><dd>{t('{total}: {valid} válidas, {invalid} anuladas, {pending} pendientes de revisión', { total: num(report.laps), valid: num(report.lapsValid), invalid: num(report.lapsInvalid), pending: num(report.lapsPending) })}</dd></div>
            <div><dt>{t('Pilotos')}</dt><dd>{t('{a} nuevos, {b} enlazados', { a: num(report.driversCreated), b: num(report.driversLinked) })}</dd></div>
            {report.championshipsCreated > 0 && <div><dt>{t('Campeonatos')}</dt><dd>{t('{n} creados como borrador', { n: report.championshipsCreated })}</dd></div>}
            {(report.lapsUpdated > 0 || report.sessionsUpdated > 0) && <div><dt>{t('Completadas')}</dt><dd>{t('{a} vueltas (temperaturas o ayudas) y {b} sesiones (ajustes) ya importadas', { a: num(report.lapsUpdated), b: num(report.sessionsUpdated) })}</dd></div>}
            {report.validityChanged > 0 && <div><dt>{t('Cambios')}</dt><dd>{t('{n} vueltas cuentan distinto que en stracker por tus reglas', { n: num(report.validityChanged) })}</dd></div>}
          </dl>
          {report.lapsPending > 0 && <p className="hint">{t('Las pendientes son salidas de boxes: revísalas en Servidor → Revisar vueltas.')}</p>}
          <ul className="warn-list">{report.notes.map((n) => <li key={n}>{tm(n)}</li>)}</ul>
        </Card>
      )}
    </>
  );
}
