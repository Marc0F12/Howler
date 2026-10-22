// Condiciones de una vuelta: temperaturas y ayudas del piloto. Las ayudas solo se conocen cuando vienen de una importación
// (stracker con un servidor que las reporta); en directo con AssettoServer no se pueden medir.

/** Ayudas como las guarda stracker: 0 = apagada; > 0 = activa (ABS y TC: 1 de serie, 2 activada). */
export interface LapAids {
  abs?: number;
  tc?: number;
  /** Punta-tacón automático. */
  blip?: number;
  /** Frenada automática. */
  brake?: number;
  clutch?: number;
  /** Cambio automático. */
  shift?: number;
  /** Línea ideal. */
  line?: number;
  /** Control de estabilidad, 0-1. */
  stability?: number;
  /** Multiplicador del rebufo (1 = normal). */
  slip?: number;
  blankets?: number;
}

/** Ayudas activas en texto corto, p. ej. ['ABS', 'TC', 'Estabilidad 50 %']. Vacío = ninguna (o no se sabe). */
export function formatAids(a: LapAids | null | undefined): string[] {
  if (!a) return [];
  const out: string[] = [];
  if ((a.abs ?? 0) > 0) out.push('ABS');
  if ((a.tc ?? 0) > 0) out.push('TC');
  if ((a.stability ?? 0) > 0) out.push(`Estabilidad ${Math.round((a.stability ?? 0) * 100)} %`);
  if ((a.blip ?? 0) > 0) out.push('Punta-tacón auto');
  if ((a.brake ?? 0) > 0) out.push('Frenada auto');
  if ((a.clutch ?? 0) > 0) out.push('Embrague auto');
  if ((a.shift ?? 0) > 0) out.push('Cambio auto');
  if ((a.line ?? 0) > 0) out.push('Línea ideal');
  if (a.slip != null && a.slip !== 1 && a.slip > 0) out.push(`Rebufo ×${Math.round(a.slip * 100) / 100}`);
  if ((a.blankets ?? 0) > 0) out.push('Calentadores');
  return out;
}

/** Temperatura en °C o `null` si no tiene sentido (vacía o fuera de lo razonable). */
export function sanitizeTemp(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > -50 && v < 100 ? Math.round(v) : null;
}

/** Ajustes con los que se corrió una sesión (porcentajes como en el server_cfg.ini: 100 = normal). `null` = no se sabe. */
export interface SessionConditions {
  fuelPct: number | null;
  damagePct: number | null;
  tyreWearPct: number | null;
  /** Neumáticos que pueden salirse de la pista antes de contar como corte. */
  tyresOut: number | null;
}

/** Condiciones de la sesión en texto corto para la cabecera: «Combustible 100 %», «Sin daños»... Vacío si no se sabe nada. */
export function formatConditions(c: SessionConditions | null | undefined): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.fuelPct != null) out.push(c.fuelPct === 0 ? 'Sin consumo de combustible' : `Combustible ${c.fuelPct} %`);
  if (c.damagePct != null) out.push(c.damagePct === 0 ? 'Sin daños' : `Daños ${c.damagePct} %`);
  if (c.tyreWearPct != null) out.push(c.tyreWearPct === 0 ? 'Sin desgaste de neumáticos' : `Desgaste ${c.tyreWearPct} %`);
  if (c.tyresOut != null && c.tyresOut >= 0) out.push(`${c.tyresOut} ${c.tyresOut === 1 ? 'neumático fuera' : 'neumáticos fuera'} permitidos`);
  return out;
}

/** Valor de stracker (1 = 100 %) → porcentaje entero; `null` si no es un número razonable. */
export function ratioToPct(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10 ? Math.round(v * 100) : null;
}
