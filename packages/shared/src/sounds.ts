/** Sonidos de la web (aviso de récord). Los de serie los genera el navegador; los personalizados los sube el administrador. */
export const MAX_SOUND_SECONDS = 5;
export const MAX_SOUND_BYTES = 400_000;
export const MAX_CUSTOM_SOUNDS = 12;

export const BUILTIN_SOUNDS = ['soft', 'howl', 'horn', 'chime', 'fanfare', 'blip'] as const;
export type BuiltinSound = (typeof BUILTIN_SOUNDS)[number];
/** Sonido de serie por defecto: «Destello», abstracto y sutil. */
export const DEFAULT_SOUND = 'off';
/** Sin sonido. */
export const NO_SOUND = 'off';

export interface CustomSoundDto { id: string; name: string; url: string; seconds: number }
export interface SoundsDto {
  /** Sonido del aviso de récord: uno de serie, el id de uno personalizado o `off`. */
  record: string;
  custom: CustomSoundDto[];
  maxSeconds: number;
  /** Control de volumen de la web pública. */
  volumeStyle: VolumeStyle;
}

export const isBuiltinSound = (id: string): id is BuiltinSound => (BUILTIN_SOUNDS as readonly string[]).includes(id);

/** Cómo se regula el volumen en la web pública (lo elige el administrador): lanzando una banana, con una ruleta o con un deslizador. */
export const VOLUME_STYLES = ['banana', 'roulette', 'slider'] as const;
export type VolumeStyle = (typeof VOLUME_STYLES)[number];
export const isVolumeStyle = (v: unknown): v is VolumeStyle => (VOLUME_STYLES as readonly unknown[]).includes(v);
