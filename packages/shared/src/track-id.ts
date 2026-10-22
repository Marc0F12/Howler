/**
 * Deja un identificador de circuito en el nombre de su carpeta. AssettoServer y Content Manager guardan rutas CSP tipo
 * «csp/3465/../D/../leroy_gandia» (versión de CSP, layout y circuito): solo el último tramo es el circuito. También limpia lo que a veces
 * se pega junto al nombre («Nombre (TRACK=csp/…)»).
 */
export function cleanTrackId(raw: string): string {
  const inner = /\(\s*TRACK\s*=\s*([^)]*)\)/i.exec(raw);
  const parts = (inner ? inner[1]! : raw).split(/[\/]/).map((p) => p.trim()).filter((p) => p && p !== '..' && p !== '.');
  const rest = /^csp$/i.test(parts[0] ?? '') ? parts.slice(1).filter((p) => !/^\d+$/.test(p)) : parts;
  return rest.at(-1) ?? raw.trim();
}

/** Forma comparable de un nombre de carpeta: minúsculas y todo lo que no sea letra o cifra como «_» («Euphoria Hillside Park» ≈ «euphoria_hillside_park»). */
export const folderKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
