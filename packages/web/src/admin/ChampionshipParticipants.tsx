import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledContentDto } from '@howler/shared';
import { CarDialog } from './EntryPickers';
import { api, useLive } from '../api';
import { adminApi } from './adminApi';
import { nextTeamKey, TEAM_COLORS, type Draft } from './championship-form';
import { Notice, useNotice } from './ui';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Paso 2: quién participa y en qué equipo. Los pilotos salen del historial del servidor; los nuevos se añaden con su perfil de Steam. */
export function ChampionshipParticipants({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const { data: drivers } = useLive(api.drivers, [], (e) => e.type === 'lap');
  const [q, setQ] = useState('');
  const [link, setLink] = useState('');
  const { notice, run } = useNotice();
  const [installed, setInstalled] = useState<InstalledContentDto | null>(null);
  const [skinFor, setSkinFor] = useState<number | null>(null);
  useEffect(() => { void adminApi.installedContent().then(setInstalled, () => undefined); }, []);
  const teamed = draft.format !== 'individual';
  const word = draft.format === 'pairs' ? t('pareja') : t('equipo');

  const enrolled = useMemo(() => new Set(draft.entries.map((e) => e.driverId)), [draft.entries]);
  const matches = useMemo(() => (drivers ?? []).filter((d) => !enrolled.has(d.id) && norm(d.name).includes(norm(q))).slice(0, 30), [drivers, enrolled, q]);

  // `add` puede llamarse tras esperar a Steam: se parte del borrador MÁS reciente, no del de cuando se pulsó el botón.
  const latest = useRef(draft);
  latest.current = draft;
  const add = (driverId: number, name: string) => {
    const d = latest.current;
    if (d.entries.some((e) => e.driverId === driverId)) return;
    set({ ...d, entries: [...d.entries, { driverId, name, teamKey: teamed && d.teams.length === 1 ? d.teams[0]!.key : null, car: '', skin: '' }] });
  };
  const addTeam = () => {
    const key = nextTeamKey(draft.teams);
    set({ ...draft, teams: [...draft.teams, { key, name: `${draft.format === 'pairs' ? t('Pareja') : t('Equipo')} ${draft.teams.length + 1}`, color: TEAM_COLORS[draft.teams.length % TEAM_COLORS.length]! }] });
  };
  const patchTeam = (key: string, patch: Partial<{ name: string; color: string }>) => set({ ...draft, teams: draft.teams.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  const removeTeam = (key: string) => set({ ...draft, teams: draft.teams.filter((x) => x.key !== key), entries: draft.entries.map((e) => (e.teamKey === key ? { ...e, teamKey: null } : e)) });

  return (
    <div className="wiz-grid">
      <div className="wiz-col">
        <h4>{t('Pilotos del servidor')}</h4>
        <input type="search" className="dir-search" placeholder={t('Buscar piloto')} aria-label={t('Buscar piloto')} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="pick-list">
          {matches.map((d) => (
            <li key={d.id}><span>{d.name} <span className="muted">· {t('{n} vueltas', { n: d.laps })}</span></span><button type="button" className="btn small" onClick={() => add(d.id, d.name)}>{t('Añadir')}</button></li>
          ))}
          {drivers && matches.length === 0 && <li className="muted">{drivers.length ? t('Nadie más coincide.') : t('Todavía no hay pilotos con vueltas.')}</li>}
        </ul>
        <h4>{t('Alguien que aún no ha entrado')}</h4>
        <p className="hint">{t('Pega el enlace de su perfil de Steam (steamcommunity.com/id/… o /profiles/…). Su Steam ID no se muestra en ninguna parte.')}</p>
        <div className="row">
          <input type="text" className="wide" placeholder="https://steamcommunity.com/id/…" aria-label={t('Enlace del perfil de Steam')} value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className="btn" disabled={!link.trim()}
            onClick={() => run(async () => { const p = await adminApi.steamResolve(link.trim()); add(p.id, p.name); setLink(''); return { ok: true, reply: p.name }; }, t('Piloto añadido'))}>{t('Añadir por enlace')}</button>
        </div>
        <Notice notice={notice} />
      </div>

      <div className="wiz-col">
        {teamed && (
          <>
            <div className="row between"><h4>{draft.format === 'pairs' ? t('Parejas') : t('Equipos')}</h4><button type="button" className="btn small" onClick={addTeam}>{t('+ Añadir {word}', { word })}</button></div>
            <ul className="team-list">
              {draft.teams.map((tm) => (
                <li key={tm.key}>
                  <input type="color" aria-label={t('Color de {name}', { name: tm.name })} value={tm.color} onChange={(e) => patchTeam(tm.key, { color: e.target.value })} />
                  <input type="text" aria-label={t('Nombre de {word}', { word })} value={tm.name} maxLength={60} onChange={(e) => patchTeam(tm.key, { name: e.target.value })} />
                  <span className="muted">{t('{n} pilotos', { n: draft.entries.filter((e) => e.teamKey === tm.key).length })}</span>
                  <button type="button" className="btn small" onClick={() => removeTeam(tm.key)} aria-label={t('Quitar {name}', { name: tm.name })}>{t('Quitar')}</button>
                </li>
              ))}
              {draft.teams.length === 0 && <li className="muted">{draft.format === 'pairs' ? t('Crea primero una pareja y luego asigna a cada piloto.') : t('Crea primero un equipo y luego asigna a cada piloto.')}</li>}
            </ul>
          </>
        )}
        <h4>{t('Participantes ({n})', { n: draft.entries.length })}</h4>
        <ul className="pick-list">
          {draft.entries.map((e) => (
            <li key={e.driverId}>
              <span>{e.name}</span>
              <span className="row">
                {teamed && (
                  <select aria-label={t('{word} de {name}', { word, name: e.name })} value={e.teamKey ?? ''} onChange={(ev) => set({ ...draft, entries: draft.entries.map((x) => (x.driverId === e.driverId ? { ...x, teamKey: ev.target.value || null } : x)) })}>
                    <option value="">{t('Sin {word}', { word })}</option>
                    {draft.teams.map((tm) => <option key={tm.key} value={tm.key}>{tm.name}</option>)}
                  </select>
                )}
                <button type="button" className="btn small" onClick={() => setSkinFor(e.driverId)} title={t('Coche y skin de este piloto: se enseñan en la web del campeonato')}>{e.car && e.skin ? t('Skin: {skin}', { skin: e.skin.replace(/_/g, ' ') }) : t('Asignar skin…')}</button>
                {e.car && <button type="button" className="btn small" onClick={() => set({ ...draft, entries: draft.entries.map((x) => (x.driverId === e.driverId ? { ...x, car: '', skin: '' } : x)) })} aria-label={t('Quitar la skin de {name}', { name: e.name })}>✕</button>}
                <button type="button" className="btn small" onClick={() => set({ ...draft, entries: draft.entries.filter((x) => x.driverId !== e.driverId) })}>{t('Quitar')}</button>
              </span>
            </li>
          ))}
          {draft.entries.length === 0 && <li className="muted">{t('Aún no hay nadie. Los pilotos del servidor que no añadas no puntuarán.')}</li>}
        </ul>
      </div>
      {skinFor != null && installed && (() => {
        const e = draft.entries.find((x) => x.driverId === skinFor);
        if (!e) return null;
        const allowed = [...new Set(draft.rounds.flatMap((r) => r.cars))];
        const cars = allowed.length > 0 ? installed.cars.filter((c) => allowed.includes(c.id)) : installed.cars;
        return <CarDialog title={t('Coche y skin de {name}', { name: e.name })} cars={cars.length > 0 ? cars : installed.cars} model={e.car || undefined} skin={e.skin || undefined}
          onOk={(m, skin) => { set({ ...draft, entries: draft.entries.map((x) => (x.driverId === e.driverId ? { ...x, car: m, skin } : x)) }); setSkinFor(null); }} onCancel={() => setSkinFor(null)} />;
      })()}
    </div>
  );
}
