import { t } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import type { ManagedDriverDto } from '@howler/shared';
import { ago } from '../format';
import { adminApi } from './adminApi';
import { Card, ConfirmButton, Notice, useNotice } from './ui';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function Row({ d, all, onList, run }: { d: ManagedDriverDto; all: ManagedDriverDto[]; onList: (l: ManagedDriverDto[]) => void; run: ReturnType<typeof useNotice>['run'] }) {
  const [name, setName] = useState(d.name);
  const [into, setInto] = useState('');
  useEffect(() => setName(d.name), [d.name]);
  return (
    <div className={`discord-event ${d.hidden ? 'dim' : ''}`}>
      <p>
        <b>{d.name}</b>
        {d.hidden && <span className="pill"> {t('oculto')}</span>}
        {d.renamed && <span className="pill"> {t('renombrado')}</span>}
        {d.imported && <span className="pill"> {t('importado')}</span>}
        <br /><span className="muted">{t('{n} vueltas aquí', { n: d.ownLaps })}{d.peerLaps > 0 ? ` · ${t('{n} de otros Howlers', { n: d.peerLaps })}` : ''} · {t('visto {ago}', { ago: ago(d.lastSeen) })}</span>
      </p>
      <div className="row">
        <input type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Nombre de {name}', { name: d.name })} />
        <button type="button" className="btn" disabled={!name.trim() || name.trim() === d.name} onClick={() => run(async () => onList(await adminApi.updateDriver(d.id, { name: name.trim() })), t('Nombre cambiado.'))}>{t('Renombrar')}</button>
        <button type="button" className="btn" onClick={() => run(async () => onList(await adminApi.updateDriver(d.id, { hidden: !d.hidden })), d.hidden ? t('Piloto visible otra vez.') : t('Piloto oculto en la web (sus datos siguen guardados).'))}>{d.hidden ? t('Mostrar') : t('Ocultar')}</button>
      </div>
      <div className="row">
        <select value={into} onChange={(e) => setInto(e.target.value)} aria-label={t('Unir {name} con…', { name: d.name })}>
          <option value="">{t('Unir con otro piloto…')}</option>
          {all.filter((o) => o.id !== d.id).map((o) => <option key={o.id} value={o.id}>{o.name} ({t('{n} vueltas', { n: o.laps })})</option>)}
        </select>
        {into && <ConfirmButton danger label={t('Unir')} confirmLabel={t('Seguro: unir (no se deshace)')} onConfirm={() => run(async () => onList(await adminApi.mergeDriver(d.id, Number(into))), t('«{name}» unido. Todas sus vueltas pasan al otro piloto.', { name: d.name }))} />}
      </div>
    </div>
  );
}

/** Pestaña «Pilotos»: renombrar, ocultar y unir duplicados (los de Howlers vinculados con el mismo Steam ID ya se unen solos). */
export function DriversSection() {
  const { notice, run } = useNotice();
  const [list, setList] = useState<ManagedDriverDto[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { adminApi.managedDrivers().then(setList).catch(() => undefined); }, []);
  const dupes = useMemo(() => {
    const by = new Map<string, ManagedDriverDto[]>();
    for (const d of list ?? []) by.set(norm(d.name), [...(by.get(norm(d.name)) ?? []), d]);
    return [...by.values()].filter((g) => g.length > 1);
  }, [list]);
  if (!list) return <p className="empty">{t('Cargando…')}</p>;
  const shown = list.filter((d) => norm(d.name).includes(norm(q)));
  return (
    <>
      <Notice notice={notice} />
      <p className="muted">{t('Aquí están todos los pilotos, los de este servidor y los de Howlers vinculados. Los que tienen el mismo Steam ID ya se unen solos; usa «Unir» para los que se llaman distinto. El Steam ID nunca se muestra.')}</p>
      {dupes.length > 0 && (
        <Card title={t('Posibles duplicados ({n})', { n: dupes.length })}>
          <ul className="steps">{dupes.map((g) => <li key={g[0]!.id}>{g.map((d) => `${d.name} (${d.laps})`).join(' = ')}</li>)}</ul>
          <p className="muted">{t('Se llaman igual pero son pilotos distintos (distinto Steam ID). Si son la misma persona, únelos abajo.')}</p>
        </Card>
      )}
      <Card title={t('Pilotos ({n})', { n: list.length })}>
        <input type="search" placeholder={t('Buscar por nombre…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length === 0 ? <p className="empty">{t('Ningún piloto coincide.')}</p> : shown.slice(0, 100).map((d) => <Row key={d.id} d={d} all={list} onList={setList} run={run} />)}
        {shown.length > 100 && <p className="muted">{t('Enseñando 100 de {n}: afina la búsqueda.', { n: shown.length })}</p>}
      </Card>
    </>
  );
}
