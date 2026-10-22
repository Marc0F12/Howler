// Ajustes inteligentes del servidor (On / Off / Auto): lo que comparten servidor y panel.
export type SmartKey = 'weatherFx' | 'trackParams' | 'carChecksums';
export type SmartMode = 'on' | 'off' | 'auto';
export const SMART_KEYS: SmartKey[] = ['weatherFx', 'trackParams', 'carChecksums'];

export interface SmartSettingDto {
  key: SmartKey;
  /** Lo elegido; null = nunca se ha elegido (se respeta lo que haya en el archivo). */
  mode: SmartMode | null;
  /** Valor que tiene ahora el archivo de configuración. */
  current: boolean;
  /** Valor que se aplicará al arrancar (con Auto, lo que decide Howler; con On/Off, ese; sin elegir, el actual). */
  effective: boolean;
  /** Texto (en español, se traduce en la web) de por qué Auto decide lo que decide. */
  reason: string;
  /** Dato concreto de esa razón (circuito, coches...), sin traducir. */
  detail: string | null;
}
