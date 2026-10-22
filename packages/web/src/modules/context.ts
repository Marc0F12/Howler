import type { StatusDto, TimingDto } from '@howler/shared';

/** Datos que una página ya cargó y reparte a sus módulos (así un módulo no repite peticiones y todos ven lo mismo). */
export interface SessionCtx {
  kind: 'session';
  /** home = la última sesión en la portada; history = una sesión del historial. */
  variant: 'home' | 'history';
  data: TimingDto;
  session: NonNullable<TimingDto['session']>;
  live: boolean;
  status: StatusDto | null;
  cars: string[];
}
export type PageCtx = SessionCtx;
