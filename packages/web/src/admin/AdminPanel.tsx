import { useEffect, useState } from 'react';
import { useLive } from '../api';
import { t } from '../i18n';
import { Icon } from '../components/Icon';
import { adminApi, whoAmI } from './adminApi';
import { AccountsSection } from './AccountsSection';
import { LoginForm } from './LoginForm';
import { AppearanceSection } from './AppearanceSection';
import { ChampionshipsSection } from './ChampionshipsSection';
import { ImportSection } from './ImportSection';
import { LapRulesSection } from './LapRulesSection';
import { LiveControlSection } from './LiveControlSection';
import { UpdateBanner } from './UpdateBanner';
import type { AccountRole, UpdateStateDto, WhoAmIDto } from '@howler/shared';
import { DriversSection } from './DriversSection';
import { MultiHowlerSection } from './MultiHowlerSection';
import { DiscordSection } from './DiscordSection';
import { PenaltiesSection } from './PenaltiesSection';
import { ServerSection } from './ServerSection';
import { CarsScreen, ChecksScreen, SessionScreen, WeatherScreen } from './PrepareScreens';
import { ReviewLapsSection } from './ReviewLapsSection';
import { ScheduleSection } from './ScheduleSection';
import { ServerSheetSection } from './ServerSheetSection';
import { SettingsSection } from './SettingsSection';
import { BackupSection } from './BackupSection';
import { WebDisplayCard } from './WebDisplayCard';
import { SoundsCard } from './SoundsCard';
import { WorldMapCard } from './WorldMapCard';
import { SETTING_INDEX } from './setting-index';

/** Grupos del panel (uso diario → configuración), cada uno con sus subpestañas. */
const GROUPS = [
  ['server', t('Servidor'), [['server', t('Estado y consola')], ['live', t('En directo')], ['review', t('Revisar vueltas')], ['schedule', t('Programación')]]],
  ['prepare', t('Preparar'), [['cars', t('Circuito y coches')], ['session', t('Sesión')], ['weather', t('Clima')], ['checks', t('Comprobaciones')], ['sheet', t('Ficha del servidor')]]],
  ['competition', t('Competición'), [['rules', t('Reglas de vuelta')], ['penalties', t('Penalizaciones')], ['championships', t('Campeonatos')]]],
  ['community', t('Comunidad y web'), [['appearance', t('Apariencia')], ['display', t('Idioma, hora y sonido')], ['world', t('Mapa del mundo')], ['drivers', t('Pilotos')], ['multihowler', 'MultiHowler'], ['discord', 'Discord']]],
  ['system', t('Sistema'), [['general', t('General')], ['import', t('Importar de stracker')], ['backup', t('Copias y exportar')], ['accounts', t('Cuentas')]]],
] as const;
/** Icono de cada grupo y subpestaña (set de marca). */
const ICONS: Record<string, string> = {
  server: 'server', live: 'live-session', review: 'lap-pending', schedule: 'loop', sheet: 'info',
  prepare: 'session-weather', cars: 'cars', session: 'sessions', weather: 'cloudy', checks: 'stability',
  competition: 'competition', rules: 'lap-rules', penalties: 'penalties', championships: 'championships',
  community: 'connections', appearance: 'appearance', display: 'sound', world: 'country', drivers: 'drivers', multihowler: 'multihowler', discord: 'chat',
  system: 'settings', general: 'general', import: 'import', backup: 'backup', accounts: 'team',
};
type Group = (typeof GROUPS)[number][0];
type Tab = (typeof GROUPS)[number][2][number][0];

const groupOf = (tab: string): Group | undefined => GROUPS.find((g) => g[2].some(([id]) => id === tab))?.[0];
const STORE = 'howler.panel';
/** Enlaces antiguos → dónde están ahora. */
const LEGACY: Record<string, [string, string]> = {
  'server/session': ['prepare', 'cars'], 'server/sheet': ['prepare', 'sheet'],
  'settings/appearance': ['community', 'appearance'], 'settings/connections': ['community', 'multihowler'], 'settings/data': ['community', 'drivers'],
  'settings/general': ['system', 'general'], 'settings/accounts': ['system', 'accounts'],
};

/** Lee `#/panel/<grupo>/<pestaña>` (o la última vista guardada) para saber dónde abrir. */
function initialPlace(): Record<Group, Tab> & { group: Group } {
  const first = Object.fromEntries(GROUPS.map((g) => [g[0], g[2][0][0]])) as Record<Group, Tab>;
  let saved: Partial<Record<string, string>> = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as typeof saved; } catch { /* sin almacenamiento */ }
  for (const g of GROUPS) if (typeof saved[g[0]] === 'string' && g[2].some(([id]) => id === saved[g[0]])) first[g[0]] = saved[g[0]] as Tab;
  let [, g = '', tab = ''] = /^#\/panel\/([^/]+)\/([^/]+)/.exec(window.location.hash) ?? [];
  // Direcciones de antes de las reorganizaciones: llevan a su sitio nuevo
  const moved = LEGACY[`${g}/${tab}`];
  if (moved) [g, tab] = moved;
  let group: Group = GROUPS.find((x) => x[0] === saved.group)?.[0] ?? 'server';
  if (groupOf(tab) === g && g) { group = g as Group; first[group] = tab as Tab; }
  return { ...first, group };
}

/** Subpestañas que ve cada rol (el servidor comprueba los permisos de verdad; esto solo esconde lo que no se puede usar). Desde el propio PC se ve todo. */
const ROLE_TABS: Record<AccountRole, string[] | 'all'> = {
  admin: 'all',
  moderator: ['server', 'live', 'review', 'rules', 'penalties'],
  viewer: ['server', 'schedule', 'penalties'],
};
const REMOTE_HIDDEN = ['general', 'accounts', 'import', 'backup']; // ajustes del programa y cuentas: solo desde el PC de Howler

/** Panel de control del servidor: en el propio PC sin contraseña; desde otro equipo, con una cuenta. */
export function AdminPanel() {
  const [me, setMe] = useState<WhoAmIDto | null>(null);
  const reload = () => { void whoAmI().then(setMe); };
  useEffect(() => {
    reload();
    window.addEventListener('howler-auth', reload);
    return () => window.removeEventListener('howler-auth', reload);
  }, []);
  if (!me) return <p className="empty">{t('Cargando el panel…')}</p>;
  if (!me.admin) return me.login ? <LoginForm onDone={reload} /> : <p className="empty">{t('El panel solo se abre desde el PC de Howler.')}</p>;
  return <AdminPanelInner me={me} onSignOut={reload} />;
}

function AdminPanelInner({ me, onSignOut }: { me: WhoAmIDto; onSignOut: () => void }) {
  const GROUPS_FOR = GROUPS.map((g) => [g[0], g[1], g[2].filter(([id]) => {
    if (me.local) return true;
    const allowed = ROLE_TABS[me.role ?? 'viewer'];
    return !REMOTE_HIDDEN.includes(id) && (allowed === 'all' || allowed.includes(id));
  })] as const).filter((g) => g[2].length > 0);
  const [place, setPlace] = useState(initialPlace);
  // Con un rol limitado, si la última vista guardada ya no se puede ver se cae a la primera permitida.
  const group: Group = GROUPS_FOR.some((g) => g[0] === place.group) ? place.group : GROUPS_FOR[0]![0];
  const tabsOf = GROUPS_FOR.find((g) => g[0] === group)![2];
  const tab: Tab = tabsOf.some(([id]) => id === place[group]) ? place[group] : tabsOf[0]![0];
  const go = (g: Group, tb: Tab) => {
    const next = { ...place, group: g, [g]: tb };
    setPlace(next);
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
    // Dirección propia de cada pestaña, para poder guardarla en favoritos (sin llenar el historial).
    if (window.location.hash.startsWith('#/panel')) window.history.replaceState(null, '', `#/panel/${g}/${tb}`);
  };
  const { data: state, error, refresh } = useLive(adminApi.state, [], (e) => e.type === 'server' || e.type === 'status' || e.type === 'session');

  const [update, setUpdate] = useState<UpdateStateDto | null>(null);
  useEffect(() => {
    const load = () => adminApi.update().then(setUpdate).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [mhPending, setMhPending] = useState(0);
  useEffect(() => {
    const load = () => adminApi.multihowler().then((s) => setMhPending(s.peers.filter((p) => p.direction === 'incoming' && p.status === 'pending').length)).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const pending = useLive(() => adminApi.laps(100, true), [], (e) => e.type === 'lap' || e.type === 'results').data?.length ?? 0;

  const badge = (g: Group) => (g === 'community' ? mhPending : g === 'system' ? (update?.available ? 1 : 0) : g === 'server' ? pending : 0);

  if (error && !state) return <p className="empty">{t('No se pudo cargar el panel:')} {error}</p>;
  if (!state) return <p className="empty">{t('Cargando el panel…')}</p>;

  return (
    <div className="admin">
      {!me.local && (
        <p className="panel-user">
          {t('Sesión de {name}', { name: me.name ?? '' })} · {me.role === 'admin' ? t('Administrador') : me.role === 'moderator' ? t('Moderador') : t('Solo ver')}{' '}
          <button type="button" className="btn small" onClick={() => { void adminApi.logout().finally(onSignOut); }}>{t('Salir')}</button>
        </p>
      )}
      <PanelSearch tabs={GROUPS_FOR} onGo={(g, tb) => go(g as Group, tb as Tab)} />
      <nav className="tabs" role="tablist" aria-label={t('Secciones del panel')}>
        {GROUPS_FOR.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={group === id} className={group === id ? 'on' : ''} onClick={() => go(id, place[id])}>
            <Icon name={ICONS[id]!} active={group === id} size={18} />{label}
            {badge(id) > 0 && <span className="tab-count" title={t('Hay avisos dentro')}>{badge(id)}</span>}
          </button>
        ))}
      </nav>
      <nav className="subtabs panel-sub" role="tablist" aria-label={t('Subsecciones')}>
        {tabsOf.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go(group, id)}>
            <Icon name={ICONS[id]!} active={tab === id} size={16} />{label}
            {id === 'multihowler' && mhPending > 0 && <span className="tab-count" title={t('Solicitudes de vínculo pendientes')}>{mhPending}</span>}
            {id === 'general' && update?.available && <span className="tab-count" title={t('Nueva versión disponible')}>1</span>}
            {id === 'review' && pending > 0 && <span className="tab-count" title={t('Vueltas pendientes de revisión')}>{pending}</span>}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {update && <UpdateBanner s={update} onChange={setUpdate} />}
        {tab === 'server' && <ServerSection state={state} refresh={refresh} />}
        {tab === 'live' && <LiveControlSection state={state} />}
        {tab === 'cars' && <CarsScreen state={state} />}
        {tab === 'session' && <SessionScreen state={state} />}
        {tab === 'weather' && <WeatherScreen state={state} />}
        {tab === 'checks' && <ChecksScreen state={state} />}
        {tab === 'review' && <ReviewLapsSection />}
        {tab === 'schedule' && <ScheduleSection />}
        {tab === 'sheet' && <ServerSheetSection state={state} />}
        {tab === 'rules' && <LapRulesSection />}
        {tab === 'multihowler' && <MultiHowlerSection />}
        {tab === 'discord' && <DiscordSection />}
        {tab === 'display' && <div className="sx"><WebDisplayCard /><SoundsCard /></div>}
        {tab === 'world' && <div className="sx"><WorldMapCard /></div>}
        {tab === 'drivers' && <DriversSection />}
        {tab === 'import' && <ImportSection />}
        {tab === 'backup' && <BackupSection />}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'penalties' && <PenaltiesSection />}
        {tab === 'championships' && <ChampionshipsSection />}
        {tab === 'accounts' && <AccountsSection />}
        {tab === 'general' && <SettingsSection state={state} refresh={refresh} update={update} onUpdate={setUpdate} />}
      </div>
    </div>
  );
}

/** Buscador de ajustes: escribe lo que buscas («puerto», «idioma», «clima»…) y te lleva a su pantalla. */
function PanelSearch({ tabs, onGo }: { tabs: readonly (readonly [string, string, readonly (readonly [string, string])[]])[]; onGo: (group: string, tab: string) => void }) {
  const [q, setQ] = useState('');
  const visible = new Set(tabs.flatMap((g) => g[2].map(([id]) => id)));
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hits = words.length === 0 ? [] : SETTING_INDEX.filter((e) => visible.has(e.tab) && words.every((w) => norm(t(e.label) + ' ' + e.words).includes(w))).slice(0, 8);
  const groupOfTab = (tb: string) => tabs.find((g) => g[2].some(([id]) => id === tb))!;
  return (
    <div className="panel-find">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar un ajuste (puerto, idioma, clima…)')} aria-label={t('Buscar un ajuste')} />
      {hits.length > 0 && (
        <ul className="panel-find-list">
          {hits.map((e) => {
            const g = groupOfTab(e.tab);
            const label = g[2].find(([id]) => id === e.tab)![1];
            return <li key={e.label}><button type="button" onClick={() => { onGo(g[0], e.tab); setQ(''); }}>{t(e.label)}<span>{g[1]} → {label}</span></button></li>;
          })}
        </ul>
      )}
      {words.length > 0 && hits.length === 0 && <p className="panel-find-none">{t('No encuentro ningún ajuste con eso.')}</p>}
    </div>
  );
}
