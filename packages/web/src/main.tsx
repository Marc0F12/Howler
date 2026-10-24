import './fonts';
import './styles/base.css';
import './styles/panel-map.css';
import './styles/sheet.css';
import './styles/home-session.css';
import './styles/filter-ghost.css';
import './styles/profiles.css';
import './styles/compare.css';
import './styles/championships.css';
import './styles/cup.css';
import './styles/features.css';
import './styles/badge.css';
import './styles/brand.css';
import './styles/session-panel.css';
import './styles/world.css';
import { syncDisplay } from './display-sync';

// Primero se averigua el idioma, la hora, la fecha y las medidas que eligió el panel; después se carga la web, que los lee al arrancar.
void (async () => {
  await syncDisplay();
  const [{ createRoot }, { App }, { applyCachedTheme }] = await Promise.all([import('react-dom/client'), import('./App'), import('./theme-apply')]);
  applyCachedTheme();
  createRoot(document.getElementById('root')!).render(<App />);
})();
