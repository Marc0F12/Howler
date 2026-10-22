import { Component, type ReactNode } from 'react';
import { t } from '../i18n';

/** Si un módulo falla al pintarse, solo él cae: la página sigue y en su sitio sale un hueco. */
export class ModuleBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(`[howler] el módulo «${this.props.id}» falló`, error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel mod-failed" role="alert">
        <p className="empty">{t('Este módulo no está disponible')}</p>
        <p className="empty"><button type="button" className="btn small" onClick={() => this.setState({ failed: false })}>{t('Reintentar')}</button></p>
      </section>
    );
  }
}
