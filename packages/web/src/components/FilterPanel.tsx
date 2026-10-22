import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { carImage, trackImage, useContentNames } from '../content';
import { Carousel3D, Preview, type CardItem } from './Carousel3D';

type Mode = 'track' | 'cars' | null;

/**
 * Panel desplegable «Filtrar»: dos mitades, circuito y coches. Pulsar una abre su ruleta 3D de vistas previas.
 * Circuito: se elige uno (o «todos»). Coches: se marcan varios; «todos» limpia la selección.
 * Las listas llegan ya cruzadas (cada una solo ofrece lo jugado con la otra elección).
 */
export function FilterPanel({ track, cars, tracks, carOptions, onTrack, onCars, onClear, variant = 'filter', names }: {
  /** `pick` = elegir (en vez de filtrar): otros textos y sin hablar de «jugados». */
  variant?: 'filter' | 'pick';
  /** Nombres propios (p. ej. los de lo instalado en AC); por defecto los de lo jugado. */
  names?: { car: (id: string) => string; track: (track: string, layout: string) => string };
  /** Clave `circuito|layout`, o '' para todos. */
  track: string;
  cars: string[];
  tracks: string[];
  carOptions: string[];
  onTrack: (key: string) => void;
  onCars: (ids: string[]) => void;
  onClear: () => void;
}) {
  const content = useContentNames();
  const carName = names?.car ?? content.carName;
  const trackName = names?.track ?? content.trackName;
  const pick = variant === 'pick';
  const T = pick
    ? { toggle: t('Elegir circuito y coches'), allTracks: t('Sin circuito elegido'), allCars: t('Cualquier coche'), count: (n: number) => t('{n} disponibles', { n }), clear: t('Vaciar'), trackHint: t('Pulsa la tarjeta del centro para elegir el circuito.'), carsHint: t('Pulsa la tarjeta del centro para marcar o desmarcar coches; sin ninguno, vale cualquiera.') }
    : { toggle: t('Filtrar'), allTracks: t('Todos los circuitos'), allCars: t('Todos los coches'), count: (n: number) => t('{n} jugados', { n }), clear: t('Quitar filtros'), trackHint: t('Pulsa la tarjeta del centro para elegir el circuito.'), carsHint: t('Pulsa la tarjeta del centro para marcar o desmarcar coches; puedes elegir varios.') };
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(null);

  useEffect(() => { if (!open) setMode(null); }, [open]);

  const split = (key: string) => { const i = key.indexOf('|'); return { track: key.slice(0, i), layout: key.slice(i + 1) }; };
  const trackTitle = (key: string) => { const s = split(key); return trackName(s.track, s.layout); };

  const trackItems: CardItem[] = [
    { key: '', title: T.allTracks, subtitle: T.count(tracks.length), fallback: pick ? '—' : t('TODOS') },
    ...tracks.map((k) => ({ key: k, title: trackTitle(k), image: trackImage(split(k).track, split(k).layout) })),
  ];
  const carItems: CardItem[] = [
    { key: '', title: T.allCars, subtitle: T.count(carOptions.length), fallback: pick ? '—' : t('TODOS') },
    ...carOptions.map((id) => ({ key: id, title: carName(id), image: carImage(id) })),
  ];

  const trackSummary = track ? trackTitle(track) : T.allTracks;
  const carsSummary = cars.length === 0 ? T.allCars : cars.length === 1 ? carName(cars[0]!) : t('{n} coches', { n: cars.length });
  const active = track || cars.length > 0;

  const toggleCar = (id: string) => {
    if (id === '') onCars([]);
    else onCars(cars.includes(id) ? cars.filter((c) => c !== id) : [...cars, id]);
  };

  return (
    <div className="filter">
      <div className="filter-bar">
        <button type="button" className={`filter-toggle ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="filter-body" onClick={() => setOpen(!open)}>
          <span>{T.toggle}</span><span className="filter-caret" aria-hidden="true">▾</span>
        </button>
        <span className="filter-summary">{trackSummary} · {carsSummary}</span>
        {active && <button type="button" className="btn-link" onClick={onClear}>{T.clear}</button>}
      </div>

      <div className={`filter-body ${open ? 'open' : ''}`} id="filter-body" aria-hidden={!open}>
        <div className="filter-inner">
          <div className="filter-tiles">
            <button type="button" className={`filter-tile ${mode === 'track' ? 'on' : ''}`} aria-pressed={mode === 'track'} tabIndex={open ? 0 : -1} onClick={() => setMode(mode === 'track' ? null : 'track')}>
              <Preview className="tile-img" title={trackSummary} fallback={track ? undefined : pick ? '—' : t('TODOS')} image={track ? trackImage(split(track).track, split(track).layout) : undefined} />
              <span className="tile-text"><span className="tile-kind">{t('Circuito')}</span><span className="tile-name">{trackSummary}</span></span>
            </button>
            <button type="button" className={`filter-tile ${mode === 'cars' ? 'on' : ''}`} aria-pressed={mode === 'cars'} tabIndex={open ? 0 : -1} onClick={() => setMode(mode === 'cars' ? null : 'cars')}>
              <span className="tile-stack">
                {(cars.length ? cars.slice(0, 3) : [undefined]).map((id) => (
                  <Preview key={id ?? 'all'} className="tile-img" title={carsSummary} fallback={id ? undefined : pick ? '—' : t('TODOS')} image={id ? carImage(id) : undefined} />
                ))}
              </span>
              <span className="tile-text"><span className="tile-kind">{t('Coches')}</span><span className="tile-name">{carsSummary}</span></span>
            </button>
          </div>

          {mode === 'track' && (
            <Carousel3D
              key={`track-${tracks.join(',')}`}
              label={t('Circuitos')}
              items={trackItems}
              selected={[track]}
              initialKey={track}
              onPick={(k) => { onTrack(k); setMode(null); }}
            />
          )}
          {mode === 'cars' && (
            <Carousel3D
              key={`cars-${carOptions.join(',')}`}
              label={t('Coches')}
              items={carItems}
              selected={cars.length ? cars : ['']}
              initialKey={cars[0] ?? ''}
              onPick={toggleCar}
            />
          )}
          {mode && (
            <p className="filter-hint">
              {mode === 'cars' ? T.carsHint : T.trackHint}
              {' '}{t('Arrastra, usa las flechas o el teclado para moverte.')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
