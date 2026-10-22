import { isMap, isScalar, parseAllDocuments, YAMLMap } from 'yaml';

/**
 * Transformaciones de la configuración de AssettoServer 0.0.54 (y Content Manager) a lo que exige
 * la versión validada con Howler. Funciones puras: texto dentro, texto fuera y la lista de cambios.
 */

export interface Transformed {
  text: string;
  /** Qué se ha cambiado, para enseñárselo al usuario. */
  changes: string[];
  /** Cosas que no se pueden migrar solas y necesitan atención. */
  warnings: string[];
}

export interface PluginOptions {
  /** Puerto UDP donde escucha Howler la interfaz de plugins de AC (UDP_PLUGIN_ADDRESS). */
  acspPort: number;
  /** Puerto donde el servidor espera órdenes de plugins (UDP_PLUGIN_LOCAL_PORT). */
  acspServerPort: number;
}

const BOM = '﻿';

/** server_cfg.ini: valores que la versión nueva rechaza y los puertos de la interfaz de plugins que Howler necesita. */
export function transformServerCfg(input: string, opts: PluginOptions): Transformed {
  const hadBom = input.startsWith(BOM);
  let text = hadBom ? input.slice(1) : input;
  const changes: string[] = [];

  // Content Manager escribe -1 ("todos"); AssettoServer solo admite 0 o más.
  text = text.replace(/^(REVERSED_GRID_RACE_POSITIONS=)(-\d+)([ \t]*\r?)$/m, (_m, k: string, v: string, end: string) => {
    changes.push(`REVERSED_GRID_RACE_POSITIONS ${v} → 0 (la versión nueva no admite negativos)`);
    return `${k}0${end}`;
  });

  const setKey = (key: string, value: string) => {
    const re = new RegExp(`^(${key}=)(.*?)(\\r?)$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, (_m, k: string, old: string, cr: string) => {
        if (old === value) return _m;
        changes.push(`${key} ${old || '(vacío)'} → ${value}`);
        return `${k}${value}${cr}`;
      });
    } else {
      // Se añade justo tras la cabecera de la sección [SERVER] (que es donde AC espera estas claves), con los mismos saltos de línea del archivo.
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const header = /^\[SERVER\][ \t]*\r?\n/im;
      if (!header.test(text)) throw new Error(`server_cfg.ini no tiene la sección [SERVER]: no se puede añadir ${key}.`);
      text = text.replace(header, (m) => `${m}${key}=${value}${eol}`);
      changes.push(`${key} = ${value} (añadido)`);
    }
  };
  setKey('UDP_PLUGIN_ADDRESS', `127.0.0.1:${opts.acspPort}`);
  setKey('UDP_PLUGIN_LOCAL_PORT', String(opts.acspServerPort));

  return { text: (hadBom ? BOM : '') + text, changes, warnings: [] };
}

export interface ExtraCfgOptions {
  /** Plugins que existen en la versión nueva (carpetas de plugins incluidas), con HowlerPlugin. */
  availablePlugins: string[];
  /** Esquema JSON de la versión nueva (cfg/schemas/extra_cfg.schema.json): lo que no esté ahí se quita. */
  schema?: unknown;
}

/** Opciones que cambiaron de sitio entre versiones: qué avisar al quitarlas. */
const KNOWN_MOVES: Record<string, string> = {
  EnableAntiAfk: 'el anti-AFK ahora lo gestiona el plugin AutoModerationPlugin (opcional)',
  MaxAfkTimeMinutes: 'el anti-AFK ahora lo gestiona el plugin AutoModerationPlugin (opcional)',
  AfkKickBehavior: 'el anti-AFK ahora lo gestiona el plugin AutoModerationPlugin (opcional)',
  MaxPing: 'el límite de ping ahora lo gestiona el plugin AutoModerationPlugin (opcional)',
  MaxPingSeconds: 'el límite de ping ahora lo gestiona el plugin AutoModerationPlugin (opcional)',
};

type SchemaNode = { $ref?: string; allOf?: SchemaNode[]; oneOf?: SchemaNode[]; anyOf?: SchemaNode[]; properties?: Record<string, SchemaNode>; additionalProperties?: unknown };

/** Quita de un mapa YAML las claves que el esquema nuevo no conoce (recursivo). Devuelve las rutas quitadas. */
function pruneUnknown(map: YAMLMap, node: SchemaNode, root: { definitions?: Record<string, SchemaNode>; $defs?: Record<string, SchemaNode> }, path = ''): string[] {
  const defs = root.definitions ?? root.$defs ?? {};
  const resolve = (n: SchemaNode | undefined): SchemaNode | undefined => {
    if (!n) return undefined;
    if (n.$ref) return resolve(defs[n.$ref.split('/').pop()!]);
    const alt = n.allOf ?? n.oneOf ?? n.anyOf;
    return alt ? resolve(alt.find((x) => (x as { type?: string }).type !== 'null') ?? alt[0]) : n;
  };
  const here = resolve(node);
  const removed: string[] = [];
  if (!here?.properties) return removed;
  for (const item of [...map.items]) {
    const key = String(isScalar(item.key) ? item.key.value : item.key);
    if (!(key in here.properties)) {
      map.items = map.items.filter((i) => i !== item);
      removed.push(path + key);
    } else if (isMap(item.value)) {
      removed.push(...pruneUnknown(item.value, here.properties[key]!, root, `${path}${key}.`));
    }
  }
  return removed;
}

/**
 * extra_cfg.yml: interfaz de plugins activa, plugin de Howler, sin configuraciones de plugins antiguas.
 * Admite el estilo antiguo con varios documentos YAML separados por `---`: los documentos de configuración de
 * plugins (los que empiezan por una etiqueta !XxxConfiguration) se eliminan y el resto se conserva tal cual.
 */
export function transformExtraCfg(input: string, opts: ExtraCfgOptions): Transformed {
  const hadBom = input.startsWith(BOM);
  // El servidor antiguo toleraba claves repetidas (gana la última); aquí se deja una sola para que el YAML sea válido.
  const docs = parseAllDocuments(hadBom ? input.slice(1) : input, { uniqueKeys: false });
  const changes: string[] = [];
  const warnings: string[] = [];
  for (const d of docs) if (d.errors.length) throw new Error(`extra_cfg.yml no es un YAML válido: ${d.errors[0]!.message}`);
  const doc = docs[0];
  if (!doc || !isMap(doc.contents)) throw new Error('extra_cfg.yml no tiene el formato esperado');

  const last = new Map<string, number>();
  doc.contents.items.forEach((it, i) => last.set(String(isScalar(it.key) ? it.key.value : it.key), i));
  const duplicated = new Set<string>();
  doc.contents.items = doc.contents.items.filter((it, i) => {
    const key = String(isScalar(it.key) ? it.key.value : it.key);
    const keep = last.get(key) === i;
    if (!keep) duplicated.add(key);
    return keep;
  });
  for (const k of duplicated) changes.push(`Clave repetida ${k}: se conserva la última, que era la que aplicaba el servidor`);

  if (doc.get('EnableClientMessages') !== true) {
    doc.set('EnableClientMessages', true);
    changes.push('EnableClientMessages → true (telemetría de los jugadores con CSP: freno real, g, neumáticos)');
  }

  if (doc.get('EnableLegacyPluginInterface') !== true) {
    doc.set('EnableLegacyPluginInterface', true);
    changes.push('EnableLegacyPluginInterface → true (Howler escucha al servidor por ahí)');
  }

  // Los plugins de terceros compilados contra la versión antigua no cargan en la nueva.
  const current = ((doc.get('EnablePlugins') as { toJSON?: () => unknown } | null)?.toJSON?.() as string[] | undefined) ?? [];
  const kept = current.filter((p) => opts.availablePlugins.includes(p));
  const dropped = current.filter((p) => !opts.availablePlugins.includes(p));
  if (!kept.includes('HowlerPlugin')) kept.push('HowlerPlugin');
  if (JSON.stringify(current) !== JSON.stringify(kept)) {
    doc.set('EnablePlugins', kept);
    changes.push(`EnablePlugins → [${kept.join(', ')}]`);
  }
  for (const p of dropped) warnings.push(`El plugin ${p} no existe para la versión nueva y se ha desactivado (su configuración queda en la copia de seguridad).`);

  // Desde la versión nueva los plugins no se configuran aquí, sino en plugin_<nombre>_cfg.yml.
  for (const item of [...doc.contents.items]) {
    const key = String((item.key as { value?: unknown })?.value ?? item.key);
    if (/Plugin$/.test(key) && isMap(item.value)) {
      doc.delete(key);
      changes.push(`Sección ${key} eliminada (los plugins ya no se configuran en extra_cfg.yml)`);
      if (kept.includes(key)) warnings.push(`${key} estaba configurado aquí: hay que recrear su configuración en plugin_*_cfg.yml.`);
    }
  }
  // La versión nueva solo admite UN documento: cualquier `---` adicional se toma por configuración de plugins antigua.
  for (const extra of docs.slice(1)) {
    const tag = isMap(extra.contents) ? extra.contents.tag : undefined;
    const keys = isMap(extra.contents) ? extra.contents.items.map((it) => String(isScalar(it.key) ? it.key.value : it.key)) : [];
    if (tag && /Configuration$/.test(tag)) {
      changes.push(`Documento ${tag} eliminado (los plugins ya no se configuran en extra_cfg.yml)`);
    } else {
      changes.push(`Documento adicional eliminado (la versión nueva solo admite uno): ${keys.join(', ') || 'vacío'}`);
      if (keys.length) warnings.push(`Se eliminó un documento adicional de extra_cfg.yml con: ${keys.join(', ')}. Su contenido queda en la copia de seguridad.`);
    }
  }
  const keptDocs = [doc];

  // Opciones renombradas y opciones que la versión nueva ya no tiene.
  if (opts.schema) {
    const url = doc.get('LoadingImageUrl');
    if (url !== undefined) {
      if (typeof url === 'string' && url.trim()) {
        doc.set('LoadingImageUrls', [url.trim()]);
        changes.push('LoadingImageUrl → LoadingImageUrls (ahora es una lista)');
      }
      doc.delete('LoadingImageUrl');
    }
    for (const d of keptDocs) {
      if (!isMap(d.contents)) continue;
      for (const path of pruneUnknown(d.contents, opts.schema as SchemaNode, opts.schema as never)) {
        const why = KNOWN_MOVES[path];
        changes.push(`Opción ${path} eliminada: ${why ?? 'la versión nueva ya no la tiene'}`);
        if (!why && path !== 'LoadingImageUrl') warnings.push(`${path} ya no existe en la versión nueva y se ha quitado; revisa si hacía algo que necesites.`);
      }
    }
  }

  // La versión nueva exige parámetros de circuito; basta con que algún documento ya lo ignore.
  const ignored = keptDocs.some((d) => d.getIn(['IgnoreConfigurationErrors', 'MissingTrackParams']) === true);
  if (!ignored) {
    doc.setIn(['IgnoreConfigurationErrors', 'MissingTrackParams'], true);
    changes.push('IgnoreConfigurationErrors.MissingTrackParams → true (la versión nueva exige parámetros de circuito)');
  }

  // Cada documento puede traer su propio marcador `---` al principio o al final; se normaliza y se une una sola vez.
  const text = keptDocs
    .map((d) => String(d).replace(/^---[ \t]*\r?\n/, '').replace(/\r?\n---[ \t]*$/, '').replace(/\s+$/, ''))
    .join('\n---\n') + '\n';
  return { text: (hadBom ? BOM : '') + text, changes, warnings };
}

/**
 * Telemetría de cliente siempre activa: `EnableClientMessages: true` en un extra_cfg.yml ya migrado.
 * Devuelve el texto nuevo, o null si ya estaba bien.
 */
export function ensureClientMessages(input: string): string | null {
  const bom = input.startsWith(BOM);
  const body = bom ? input.slice(1) : input;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const re = /^(\s*)EnableClientMessages\s*:.*$/m;
  const m = re.exec(body);
  if (m) {
    if (/^\s*EnableClientMessages\s*:\s*true\s*(#.*)?$/i.test(m[0])) return null;
    return (bom ? BOM : '') + body.replace(re, '$1EnableClientMessages: true');
  }
  return (bom ? BOM : '') + body + (body.endsWith('\n') || body === '' ? '' : eol) + `EnableClientMessages: true${eol}`;
}

/** `ClientTelemetry: false` del plugin (valor de las versiones en que era experimental) pasa a true; null si no hay nada que cambiar. */
export function enableClientTelemetryCfg(input: string): string | null {
  const re = /^(\s*ClientTelemetry\s*:\s*)false\b/m;
  return re.test(input) ? input.replace(re, '$1true') : null;
}
