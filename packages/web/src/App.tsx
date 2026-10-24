import { useApplyTheme } from './modules/appearance-store';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api, useLive } from './api';
import { pretty } from './format';
import { adminApi, detectAdmin } from './admin/adminApi';
import { SoundToggle } from './components/SoundToggle';
import { useRecordSound } from './hooks/useRecordSound';
import { StatusLight } from './components/StatusLight';
import { Icon } from './components/Icon';
import { HowlerMark } from './components/HowlerMark';
import { Splash } from './components/Splash';
import { t } from './i18n';
import { HomePage } from './pages/HomePage';
import { RankingsPage } from './pages/RankingsPage';
import { CarPage } from './pages/CarPage';
import { ChampionshipPage } from './pages/ChampionshipPage';
import { ChampionshipsPage } from './pages/ChampionshipsPage';
import { CarsPage, DriversPage, TracksPage } from './pages/DirectoryPages';
import { DriverPage } from './pages/DriverPage';
import { RecordsPage } from './pages/RecordsPage';
import { SessionPage } from './pages/SessionPage';
import { SessionsPage } from './pages/SessionsPage';
import { TrackPage } from './pages/TrackPage';
import { VersusPage } from './pages/VersusPage';

// El panel y el comparador pesan mucho y no los usa todo el mundo: se descargan solo al abrirlos.
const AdminPanel = lazy(() => import('./admin/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const WorldPage = lazy(() => import('./pages/WorldPage').then((m) => ({ default: m.WorldPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const loading = <p className="empty">{t('Cargando…')}</p>;

type Route =
  | { name: 'home' } | { name: 'records' } | { name: 'panel' }
  | { name: 'sessions' } | { name: 'session'; id: number } | { name: 'rankings' } | { name: 'world' } | { name: 'drivers' } | { name: 'tracks' } | { name: 'cars' }
  | { name: 'driver'; id: number } | { name: 'track'; track: string; layout: string } | { name: 'car'; car: string }
  | { name: 'championships' } | { name: 'championship'; id: number }
  | { name: 'compare'; track: string; layout: string; picks: string[] }
  | { name: 'versus'; a: number; b: number };

/** Ruta por hash: #/ inicio, #/records tiempos, #/drivers|tracks|cars listados, #/driver/ID, #/track/CIRCUITO|LAYOUT, #/car/COCHE, #/panel. */
export function parseRoute(h: string): Route {
  const [, kind = '', rest = ''] = /^#\/([^/]*)\/?(.*)$/.exec(h) ?? [];
  if (kind === 'compare') {
    // #/compare/<circuito|layout>/<idPiloto~coche>/<idPiloto~coche>[/...]
    try {
      const [key = '', ...picks] = rest.split('/').map(decodeURIComponent);
      const i = key.indexOf('|');
      if (i > 0 && picks.length >= 2 && picks.length <= 3 && picks.every((p) => /^\d+~.+/.test(p))) return { name: 'compare', track: key.slice(0, i), layout: key.slice(i + 1), picks };
    } catch { /* ruta mal formada */ }
    return { name: 'records' };
  }
  if (kind === 'versus') {
    // #/versus/<idPiloto>/<idPiloto>
    const [a, b] = rest.split('/').map(Number);
    return Number.isInteger(a) && Number.isInteger(b) && a! > 0 && b! > 0 && a !== b ? { name: 'versus', a: a!, b: b! } : { name: 'drivers' };
  }
  const arg = (() => { try { return decodeURIComponent(rest); } catch { return ''; } })();
  switch (kind) {
    case 'panel': return { name: 'panel' };
    case 'records': return { name: 'records' };
    case 'rankings': return { name: 'rankings' };
    case 'world': return { name: 'world' };
    case 'sessions': return { name: 'sessions' };
    case 'session': { const id = Number(arg); return Number.isInteger(id) && id > 0 ? { name: 'session', id } : { name: 'sessions' }; }
    case 'drivers': return { name: 'drivers' };
    case 'tracks': return { name: 'tracks' };
    case 'cars': return { name: 'cars' };
    case 'championships': return { name: 'championships' };
    case 'championship': { const id = Number(arg); return Number.isInteger(id) && id > 0 ? { name: 'championship', id } : { name: 'championships' }; }
    case 'driver': { const id = Number(arg); return Number.isInteger(id) && id > 0 ? { name: 'driver', id } : { name: 'drivers' }; }
    case 'track': { const i = arg.indexOf('|'); return arg && i > 0 ? { name: 'track', track: arg.slice(0, i), layout: arg.slice(i + 1) } : { name: 'tracks' }; }
    case 'car': return arg ? { name: 'car', car: arg } : { name: 'cars' };
    default: return { name: 'home' };
  }
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** A qué entrada del menú pertenece cada página (una ficha cuenta como su listado). */
const SECTION: Record<Route['name'], string> = {
  home: 'home', records: 'records', panel: 'panel', drivers: 'drivers', rankings: 'more', world: 'more', sessions: 'sessions', session: 'sessions', driver: 'drivers', tracks: 'more', track: 'more', cars: 'more', car: 'more', compare: 'records', versus: 'drivers',
  championships: 'championships', championship: 'championships',
};

/** Ventana de aplicación (Howler.exe): solo el panel, con un botón para abrir la web pública aparte. */
const APP_MODE = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('app') === '1';

function AppShell() {
  const status = useLive(api.status, [], (e) => e.type !== 'lap');
  const s = status.data;
  const [opening, setOpening] = useState(false);
  const openWeb = () => { setOpening(true); void adminApi.openWeb().finally(() => setTimeout(() => setOpening(false), 800)); };
  // La cabecera del panel queda fija al hacer scroll; las pestañas de grupo se pegan justo debajo (su altura va en una variable CSS).
  const headRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--panel-top-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--panel-top-h'); };
  }, []);
  return (
    <div className="app">
      <Splash />
      <header className="top panel-top" ref={headRef}>
        <div className="brand">
          <HowlerMark size={36} live={!!s?.acConnected} />
          <h1>Howler</h1>
        </div>
        <div className="top-status">
          <StatusLight state={status.error ? 'down' : s?.acConnected ? 'live' : 'wait'} />
          <span className="muted">{status.error ? t('Sin conexión con Howler') : s?.acConnected ? t('{n} en pista', { n: s.online.length }) : t('Esperando al servidor de AC')}</span>
          <button type="button" className="btn" onClick={openWeb} disabled={opening} title={t('Abre la web pública (tiempos, pilotos, circuitos...) en tu navegador')}>
            {opening ? t('Abriendo…') : t('Abrir la web')}
          </button>
        </div>
      </header>
      <main><Suspense fallback={loading}><AdminPanel /></Suspense></main>
    </div>
  );
}

export function App() {
  useApplyTheme();
  return APP_MODE ? <AppShell /> : <PublicApp />;
}

function PublicApp() {
  useRecordSound();
  const route = useRoute();
  const [admin, setAdmin] = useState(false);
  useEffect(() => { void detectAdmin().then(setAdmin); }, []);
  const status = useLive(api.status, [], (e) => e.type !== 'lap');
  const s = status.data;
  const session = s?.session;

  const NAV: [string, string, string][] = [
    ['home', '#/', t('Inicio')], ['records', '#/records', t('Tiempos')], ['sessions', '#/sessions', t('Sesiones')], ['drivers', '#/drivers', t('Pilotos')], ['championships', '#/championships', t('Campeonatos')],
  ];
  const NAV_ICON: Record<string, string> = { home: 'home', records: 'timing', sessions: 'sessions', drivers: 'drivers', championships: 'championships' };
  const MORE: [string, string][] = [['#/rankings', t('Rankings')], ['#/world', t('Mapa')], ['#/tracks', t('Circuitos')], ['#/cars', t('Coches')]];
  const inMore = SECTION[route.name] === 'more';
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [route]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <HowlerMark size={36} live={!!s?.acConnected} howlOnRecord />
          <h1>Howler</h1>
        </div>
        <nav className="mainnav" aria-label={t('Secciones')}>
          {NAV.map(([id, href, label]) => <a key={id} href={href} className={SECTION[route.name] === id ? 'on' : ''}><Icon name={NAV_ICON[id] ?? id} active={SECTION[route.name] === id} size={18} />{label}</a>)}
          <button type="button" className={`more-btn${inMore ? ' on' : ''}`} aria-expanded={moreOpen || inMore} onClick={() => setMoreOpen((o) => !o)}><Icon name="more" size={18} />{t('Más')} <span aria-hidden="true">{moreOpen || inMore ? '▴' : '▾'}</span></button>
          {admin && <a href="#/panel" className={route.name === 'panel' ? 'on' : ''}><Icon name="panel" active={route.name === 'panel'} size={18} />{t('Panel')}</a>}
        </nav>
        <div className="top-status">
          <StatusLight state={status.error ? 'down' : s?.acConnected ? 'live' : 'wait'} />
          {s?.exactSectors && <span className="chip" title={t('Sectores medidos por el juego de cada piloto, en directo')}>{t('Sectores exactos')}</span>}
          <span className="muted">
            {status.error
              ? t('Sin conexión con Howler')
              : s?.acConnected
                ? `${pretty(session?.track ?? '')}${session?.layout ? ` · ${pretty(session.layout)}` : ''} — ${t('{n} en pista', { n: s.online.length })}`
                : t('Esperando al servidor de AC')}
          </span>
          <SoundToggle />
        </div>
      </header>

      {(moreOpen || inMore) && (
        <nav className="subnav" aria-label={t('Más secciones')}>
          {MORE.map(([href, label]) => <a key={href} href={href} className={window.location.hash.startsWith(href) || (href === '#/tracks' && route.name === 'track') || (href === '#/cars' && route.name === 'car') ? 'on' : ''}>{label}</a>)}
        </nav>
      )}

      <main>
        <Suspense fallback={loading}>
        {route.name === 'panel' && admin ? <AdminPanel />
          : route.name === 'world' ? <WorldPage />
          : route.name === 'rankings' ? <RankingsPage />
          : route.name === 'records' ? <RecordsPage />
          : route.name === 'sessions' ? <SessionsPage />
          : route.name === 'session' ? <SessionPage id={route.id} />
          : route.name === 'drivers' ? <DriversPage />
          : route.name === 'driver' ? <DriverPage id={route.id} />
          : route.name === 'tracks' ? <TracksPage />
          : route.name === 'track' ? <TrackPage track={route.track} layout={route.layout} />
          : route.name === 'cars' ? <CarsPage />
          : route.name === 'championships' ? <ChampionshipsPage />
          : route.name === 'championship' ? <ChampionshipPage id={route.id} />
          : route.name === 'car' ? <CarPage car={route.car} />
          : route.name === 'versus' ? <VersusPage a={route.a} b={route.b} />
          : route.name === 'compare' ? <ComparePage track={route.track} layout={route.layout} picks={route.picks} />
          : <HomePage status={s ?? null} />}
        </Suspense>
      </main>
    </div>
  );
}
