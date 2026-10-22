// Set de iconos de Howler (24 px, trazo 1,6; en 16/ versiones propias para tablas). Son decorativos: si un botón solo lleva icono, ponle aria-label.
const FILES = import.meta.glob('../brand/icons/**/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** `active` usa la versión rellena (solo para la pestaña o el filtro activo). */
export function Icon({ name, size = 18, active = false, className = '' }: { name: string; size?: number; active?: boolean; className?: string }) {
  const dir = size <= 16 ? '16/' : '';
  const suffix = active ? '-filled' : '';
  const url = FILES[`../brand/icons/${dir}${name}${suffix}.svg`] ?? FILES[`../brand/icons/${name}${suffix}.svg`] ?? FILES[`../brand/icons/${name}.svg`];
  if (!url) return null;
  return <span className={`icon ${className}`} aria-hidden="true" style={{ width: size, height: size, ['--i' as string]: `url(${JSON.stringify(url)})` }} />;
}
