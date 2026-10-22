import type { BadgeBg, BadgeColorKey, BadgeFinish, BadgeOrnament, BadgeRim, BadgeShape, BadgeTextMode } from '@howler/shared';
import { t } from '../../i18n';

export const SHAPE_LABELS: Record<BadgeShape, string> = { circle: t('Círculo'), shield: t('Escudo'), hex: t('Hexágono'), squircle: t('Cuadrado') };
export const RIM_LABELS: Record<BadgeRim, string> = { solid: t('Liso'), checker: t('Ajedrezado'), double: t('Doble filete'), pearls: t('Perlas'), rope: t('Cuerda') };
export const BG_LABELS: Record<BadgeBg, string> = { solid: t('Liso'), split: t('Dividido'), sunburst: t('Rayos'), stripes: t('Franjas'), checker: t('Ajedrez'), sunset: t('Degradado'), carbon: t('Carbono') };
export const FINISH_LABELS: Record<BadgeFinish, string> = { flat: t('Plano'), gloss: t('Brillante'), metal: t('Metálico'), enamel: t('Esmalte'), carbon: t('Carbono') };
export const TEXT_MODE_LABELS: Record<BadgeTextMode, string> = {
  band: t('Banda inferior'), rim: t('En el borde (abajo)'), rim2: t('En el borde (arriba y abajo)'), ribbon: t('Cinta que sobresale'), none: t('Sin texto'),
};
export const ORNAMENT_LABELS: Record<BadgeOrnament, string> = {
  rays: t('Rayos de sol'), laurel: t('Laurel'), stars: t('Estrellas'), dots: t('Anillo de puntos'), rivets: t('Remaches'),
  wings: t('Alas'), flags: t('Banderas cruzadas'), flames: t('Llamas'), crown: t('Corona'),
};
export const COLOR_LABELS: Record<BadgeColorKey, string> = {
  rim1: t('Marco'), rim2: t('Marco 2'), bg1: t('Fondo'), bg2: t('Fondo 2 / banda'), accent: t('Adorno'), emblem: t('Emblema'), outline: t('Contorno'), text: t('Texto'),
};
export const PALETTE_LABELS: Record<string, string> = {
  Circuito: t('Circuito'), 'Oro y marino': t('Oro y marino'), 'Plata cielo': t('Plata cielo'), 'Rojo carrera': t('Rojo carrera'),
  'Verde bosque': t('Verde bosque'), Neón: t('Neón'), Bronce: t('Bronce'), Monocromo: t('Monocromo'),
};
export const PRESET_LABELS: Record<string, string> = {
  Circuito: t('Circuito'), Moneda: t('Moneda'), Escudo: t('Escudo'), Alas: t('Alas'), Hexágono: t('Hexágono'), Sello: t('Sello'),
};
export const CATEGORY_LABELS: Record<string, string> = {
  propios: t('Dibujados aquí'), carreras: t('Carreras'), premios: t('Premios y rango'), coronas: t('Coronas y cascos'), alas: t('Alas y vuelo'),
  escudos: t('Escudos'), simbolos: t('Símbolos'), animales: t('Animales'), muerte: t('Calaveras y muerte'), energia: t('Energía y elementos'), abstracto: t('Abstractos'),
};
