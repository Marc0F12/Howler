import { useEffect, useState } from 'react';
import { parseCoordText, worldKey, type WorldMapAdminDto, type WorldSuggestionDto } from '@howler/shared';
import { adminGet, adminPost, adminPut } from './adminApi';
import { Card, Notice, useNotice } from './ui';
import { useContentNames } from '../content';
import { LocationPicker } from './LocationPicker';
import { t } from '../i18n';

type Manual = Record<string, { lat: number; lon: number }>;

/** Mapa del mundo: permitir satélite y calles, y ubicar a mano los circuitos que no traen coordenadas. */
export function WorldMapCard() {
  const [state, setState] = useState<WorldMapAdminDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [found, setFound] = useState<Record<string, WorldSuggestionDto>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ track: string; layout: string; at: { lat: number; lon: number } | null } | null>(null);
  const { notice, show } = useNotice();
  const { trackName } = useContentNames();
  useEffect(() => { adminGet<WorldMapAdminDto>('/admin/api/world-map').then(setState).catch((e: Error) => show(false, e.message)); }, []);
  if (!state) return <Card title={t('Mapa del mundo')}><Notice notice={notice} /></Card>;

  /** Lo guardado a mano ahora mismo. */
  const manualNow = (): Manual => Object.fromEntries(state.played.filter((p) => p.source === 'manual' && p.lat != null && p.lon != null).map((p) => [worldKey(p.track, p.layout), { lat: p.lat!, lon: p.lon! }]));
  const save = async (online: boolean, manual: Manual) => {
    try { setState(await adminPut<WorldMapAdminDto>('/admin/api/world-map', { online, manual })); show(true, t('Guardado.')); } catch (e) { show(false, (e as Error).message); }
  };
  const place = (key: string, track: string, layout: string) => {
    const c = parseCoordText(drafts[key] ?? '');
    if (!c) { show(false, t('No entiendo esas coordenadas. Prueba con «41.57, 2.26» (latitud y longitud, como las da Google Maps).')); return; }
    void save(state.online, { ...manualNow(), [worldKey(track, layout)]: c }).then(() => setDrafts((d) => ({ ...d, [key]: '' })));
  };
  const search = async (track: string, layout: string) => {
    const key = worldKey(track, layout);
    setBusy(key);
    try { const r = await adminPost<WorldSuggestionDto>('/admin/api/world-map/search', { track, layout }); setFound((f) => ({ ...f, [key]: r })); if (r.error) show(false, r.error); } catch (e) { show(false, (e as Error).message); }
    setBusy(null);
  };
  const searchMissing = async () => {
    for (const p of state.played.filter((x) => x.source === null)) { await search(p.track, p.layout); }
  };
  const use = (track: string, layout: string, c: { lat: number; lon: number }) => {
    void save(state.online, { ...manualNow(), [worldKey(track, layout)]: { lat: c.lat, lon: c.lon } }).then(() => setFound((f) => { const n = { ...f }; delete n[worldKey(track, layout)]; return n; }));
  };
  const useAllFirst = () => {
    const m = manualNow();
    for (const f of Object.values(found)) if (f.candidates[0] && !f.approx) m[worldKey(f.track, f.layout)] = { lat: f.candidates[0].lat, lon: f.candidates[0].lon };
    void save(state.online, m).then(() => setFound({}));
  };
  const savePicked = (lat: number, lon: number) => {
    if (!picker) return;
    use(picker.track, picker.layout, { lat, lon });
    setPicker(null);
  };
  const unplace = (track: string, layout: string) => {
    const m = manualNow();
    delete m[worldKey(track, layout)];
    void save(state.online, m);
  };

  return (
    <Card title={t('Mapa del mundo')}>
      <p className="hint">{t('La web enseña dónde está cada circuito jugado, con sus 3 mejores tiempos. Los circuitos salen en su sitio si su ficha trae coordenadas; los demás puedes ubicarlos a mano aquí.')}</p>
      <label className="check">
        <input type="checkbox" checked={state.online} onChange={(e) => void save(e.target.checked, manualNow())} />
        {t('Permitir mapas de satélite y de calles')}
      </label>
      <p className="hint">{t('Sin esto la web usa un mapa vectorial incluido en Howler, que funciona sin internet y sin contactar con nadie. Con esto activado, el visitante puede cambiar a satélite (Esri) o calles (OpenStreetMap): su navegador descargará esos mapas de esos servicios, que verán su dirección de internet y la dirección de tu web. Úsalo con moderación: son servicios gratuitos de terceros.')}</p>
      <h4>{t('Circuitos jugados')}</h4>
      <p className="hint">{t('Se busca por nombre en OpenStreetMap (Nominatim): el nombre del circuito se envía a ese servicio desde tu PC, no desde el visitante. Revisa que el sitio sea el correcto antes de usarlo.')}</p>
      <div className="row">
        <button type="button" className="btn small" disabled={busy !== null || !state.played.some((p) => p.source === null)} onClick={() => void searchMissing()}>{busy ? t('Buscando…') : t('Buscar los que faltan')}</button>{' '}
        {Object.values(found).some((f) => f.candidates.length > 0 && !f.approx) && <button type="button" className="btn small primary" onClick={useAllFirst}>{t('Usar la primera sugerencia de los seguros')}</button>}
      </div>
      {state.played.length === 0 ? <p className="muted">{t('Todavía no hay circuitos jugados.')}</p> : (
        <table className="timing world-admin">
          <thead><tr><th>{t('Circuito')}</th><th>{t('Ubicación')}</th><th>{t('Ubicar a mano')}</th></tr></thead>
          <tbody>
            {state.played.map((p) => {
              const key = worldKey(p.track, p.layout);
              return (
                <tr key={key}>
                  <td>{trackName(p.track, p.layout)}</td>
                  <td>{p.lat == null ? <span className="muted">{t('Sin ubicación: no sale en el mapa')}</span> : <span className="num">{p.lat.toFixed(3)}, {p.lon!.toFixed(3)} <span className="muted">· {p.source === 'manual' ? t('a mano') : t('de su ficha')}</span></span>}</td>
                  <td>
                    <button type="button" className="btn small" disabled={busy !== null} onClick={() => void search(p.track, p.layout)}>{busy === key ? t('Buscando…') : t('Buscar ubicación')}</button>{' '}
                    <button type="button" className="btn small" onClick={() => setPicker({ track: p.track, layout: p.layout, at: p.lat != null ? { lat: p.lat, lon: p.lon! } : null })}>{p.lat != null ? t('Corregir en el mapa') : t('Ubicar en el mapa')}</button>{' '}
                    <input type="text" value={drafts[key] ?? ''} placeholder="41.57, 2.26" aria-label={t('Coordenadas de {name}', { name: trackName(p.track, p.layout) })} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') place(key, p.track, p.layout); }} />{' '}
                    <button type="button" className="btn small" disabled={!(drafts[key] ?? '').trim()} onClick={() => place(key, p.track, p.layout)}>{t('Guardar')}</button>
                    {p.source === 'manual' && <> <button type="button" className="btn small" onClick={() => unplace(p.track, p.layout)}>{t('Quitar ubicación manual')}</button></>}
                    {found[key] && (found[key]!.candidates.length === 0 ? (!found[key]!.error && <p className="muted">{t('No he encontrado ningún sitio con ese nombre. Búscalo en un mapa y escribe las coordenadas.')}</p>) : (
                      <ul className="world-found">
                        {found[key]!.approx && <li className="muted">{t('No he encontrado el circuito con seguridad: estos sitios solo coinciden con el nombre o la ciudad. Revisa bien antes de usar uno.')}</li>}
                        {found[key]!.candidates.map((c) => <li key={`${c.lat},${c.lon}`}><button type="button" className="btn small" onClick={() => use(p.track, p.layout, c)}>{t('Usar')}</button> <button type="button" className="btn small" onClick={() => setPicker({ track: p.track, layout: p.layout, at: c })}>{t('Ver en el mapa')}</button> <span className="num">{c.lat.toFixed(3)}, {c.lon.toFixed(3)}</span> <span className="muted">{c.label}</span></li>)}
                      </ul>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {picker && <LocationPicker name={trackName(picker.track, picker.layout)} initial={picker.at} onSave={savePicked} onClose={() => setPicker(null)} />}
      <Notice notice={notice} />
    </Card>
  );
}
