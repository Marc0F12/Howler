import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { DISCORD_EVENT_IDS } from '@howler/shared';

const collisionRule = z.object({ mode: z.enum(['ignore', 'invalidate']), minSpeedKmh: z.number().min(0).max(500) });
const lapRules = z.object({
  maxCuts: z.number().int().min(0).max(50),
  carCollisions: collisionRule,
  envCollisions: collisionRule,
  minLapMs: z.number().int().min(0).max(3_600_000),
  notifyDriver: z.boolean(),
});
/** Reglas de vuelta válida: ver `@howler/shared` (lap-rules). */
export const lapRulesConfigSchema = z.object({
  default: z.string().min(1).default('cortes'),
  profiles: z.record(z.object({ name: z.string().min(1).max(60), description: z.string().max(300).optional(), rules: lapRules })).default({}),
  tracks: z.record(z.string().min(1)).default({}),
  autoVoidOutLaps: z.boolean().optional(),
});

/** Penalizaciones automáticas de carrera (segundos por corte y por choque); todo en 0 = apagado. */
export const racePenaltiesSchema = z.object({
  cutSeconds: z.number().min(0).max(600).default(0),
  carHitSeconds: z.number().min(0).max(600).default(0),
  carHitMinKmh: z.number().min(0).max(500).default(0),
  envHitSeconds: z.number().min(0).max(600).default(0),
  envHitMinKmh: z.number().min(0).max(500).default(0),
});

/** Avisos a Discord por webhook (el canal pega su enlace en el panel); vacío = apagado. */
export const discordSchema = z.object({
  webhookUrl: z.string().max(300).default(''),
  /** Más canales: cada aviso se manda a todos. El principal (`webhookUrl`) y estos suman. Varios Howlers pueden compartir un mismo webhook. */
  webhooks: z.array(z.object({ id: z.string().regex(/^[a-z0-9]{4,16}$/), name: z.string().trim().min(1).max(40), url: z.string().max(300) })).max(10).default([]),
  /** Nombre del servidor que aparece al pie de cada aviso (útil si varios Howlers escriben en el mismo canal). Vacío = sin pie. */
  serverName: z.string().trim().max(40).default(''),
  publicUrl: z.string().max(300).regex(/^(https?:\/\/.+)?$/, 'La dirección de la web debe empezar por http:// o https://').default(''),
  /** Por aviso: encendido/apagado y título y mensaje propios (vacío = los de Howler). Los ids están en `DISCORD_EVENTS`. */
  events: z.record(z.enum(DISCORD_EVENT_IDS as [string, ...string[]]), z.object({
    enabled: z.boolean().optional(),
    title: z.string().max(120).optional(),
    message: z.string().max(500).optional(),
  })).default({}),
});

/** Qué récords se anuncian en el chat del propio servidor (todo apagado por defecto). */
export const recordAnnounceSchema = z.object({
  session: z.boolean().default(false),
  combo: z.boolean().default(false),
  global: z.boolean().default(false),
  /** Texto propio de cada aviso (vacío = el de Howler). Admite {piloto} {tiempo} {coche} {circuito} {anterior} {mejora}. */
  messages: z.object({ session: z.string().max(150).default(''), combo: z.string().max(150).default(''), global: z.string().max(150).default('') }).default({}),
});

export const schema = z.object({
  /** Idioma de los mensajes que genera Howler (chat del servidor, Discord...): 'es' o 'en'. */
  language: z.enum(['es', 'en']).default('es'),
  /** Avisos de versión nueva (Releases de GitHub). `dismissed` = la versión a la que se dijo «ahora no». */
  updates: z.object({
    check: z.boolean().default(true),
    channel: z.enum(['stable', 'beta']).default('stable'),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default('Marc0F12/Howler'),
    dismissed: z.string().max(40).default(''),
  }).default({}),
  /** Copias de seguridad automáticas de los datos (en <dataDir>/backups): una cada `everyDays` días, conservando las últimas `keep`. */
  backup: z.object({
    auto: z.boolean().default(true),
    everyDays: z.number().int().min(1).max(90).default(1),
    keep: z.number().int().min(1).max(60).default(7),
  }).default({}),
  /** Carpeta del servidor de AC (donde está el ejecutable: acServer.exe o AssettoServer.exe en Windows, AssettoServer en Linux). Vacía hasta que el panel la configure. */
  serverDir: z.string().default(''),
  http: z
    .object({
      host: z.string().default('0.0.0.0'),
      // 8420: poco usado, para no chocar con otros servicios. Configurable.
      port: z.number().int().min(1).max(65535).default(8420),
      /** Límites contra abusos de la web pública (el panel no los tiene). Los de serie no los nota nadie que use la web con normalidad. */
      rateLimit: z
        .object({
          enabled: z.boolean().default(true),
          perMinute: z.number().int().min(30).max(100_000).default(600),
          heavyPerMinute: z.number().int().min(10).max(100_000).default(120),
          liveConnectionsPerIp: z.number().int().min(1).max(1000).default(12),
          liveConnectionsTotal: z.number().int().min(10).max(100_000).default(400),
        })
        .default({}),
    })
    .default({}),
  acsp: z
    .object({
      /** Donde escucha Howler: debe coincidir con UDP_PLUGIN_ADDRESS del server_cfg.ini. */
      listenHost: z.string().default('127.0.0.1'),
      listenPort: z.number().int().default(12000),
      /** Donde escucha el servidor: UDP_PLUGIN_LOCAL_PORT del server_cfg.ini. */
      serverHost: z.string().default('127.0.0.1'),
      serverPort: z.number().int().default(11000),
      positionIntervalMs: z.number().int().min(20).max(1000).default(100),
      /**
       * Puertos UDP (en este mismo PC) de OTROS plugins de AC que también necesitan `UDP_PLUGIN_ADDRESS` (penalizaciones, etc.).
       * El servidor solo manda ese puerto a un destino: Howler copia cada paquete a estos puertos y devuelve al servidor lo que contesten.
       */
      forward: z.array(z.number().int().min(1024).max(65535)).max(5).default([]),
      /**
       * Metros que se adelanta el punto del coche (en la dirección de su velocidad) para detectar el cruce de líneas.
       * AC mide con otro punto del coche que el origen del paquete; 1 m reproduce mejor sus sectores (calibrado con
       * vueltas reales: error medio de 11 ms a 7 ms).
       */
      referenceOffsetM: z.number().min(-5).max(5).default(1),
      /** Donde escucha Howler al plugin HowlerPlugin (sectores exactos); debe coincidir con Port en el extra_cfg.yml. */
      pluginHost: z.string().default('127.0.0.1'),
      pluginPort: z.number().int().min(1).max(65535).default(12001),
      /** Puerto (solo 127.0.0.1) del canal de órdenes del plugin: hora, clima, lastre... 0 = sin canal. */
      pluginCommandPort: z.number().int().min(0).max(65535).default(12002),
    })
    .default({}),
  /** Panel de control: solo escucha en 127.0.0.1 (nadie más que quien esté en este PC puede abrirlo). */
  admin: z
    .object({
      port: z.number().int().min(1).max(65535).default(8421),
      /** Acceso al panel desde otros equipos con usuario y contraseña (cuentas creadas en el panel). Apagado de serie: el panel solo escucha en este PC. */
      remote: z.object({ enabled: z.boolean().default(false) }).default({}),
    })
    .default({}),
  /** Cómo arrancar y parar el servidor de AC desde el panel. */
  server: z
    .object({
      /** Nombre del ejecutable dentro de serverDir. */
      exe: z.string().default(process.platform === 'win32' ? 'acServer.exe' : 'AssettoServer'),
      /** Preset de Content Manager (carpeta de presets/) con el que arrancar. Vacío = configuración de cfg/. */
      preset: z.string().default('SERVER_00'),
      /** Arrancar el servidor de AC automáticamente al arrancar Howler. */
      startWithHowler: z.boolean().default(false),
      /** Segundos de aviso a los jugadores antes de parar o reiniciar. */
      stopWarningSeconds: z.number().int().min(0).max(300).default(10),
    })
    .default({}),
  /** Fichas de pilotos. */
  profiles: z
    .object({
      /** Mostrar la foto de perfil de Steam de cada piloto (Howler la descarga de su perfil público y la sirve él mismo). */
      steamAvatars: z.boolean().default(true),
    })
    .default({}),
  lapRules: lapRulesConfigSchema.default({}),
  racePenalties: racePenaltiesSchema.default({}),
  /** Ajustes inteligentes del servidor (On/Off/Auto); sin definir = Howler no toca ese archivo. */
  smartSettings: z.object({ weatherFx: z.enum(['on', 'off', 'auto']).optional(), trackParams: z.enum(['on', 'off', 'auto']).optional(), carChecksums: z.enum(['on', 'off', 'auto']).optional() }).default({}),
  /** Mapa del mundo: mapas en línea (satélite/calles) permitidos y ubicaciones manuales de circuitos (`circuito|layout`). */
  worldMap: z.object({
    online: z.boolean().default(false),
    manual: z.record(z.string().max(220), z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })).default({}),
  }).default({}),
  discord: discordSchema.default({}),
  recordAnnounce: recordAnnounceSchema.default({}),
  /** Disposición de módulos de la web. Se valida y limpia con `sanitizeAppearance` (@howler/shared) al guardar y al servir. */
  appearance: z.object({ layouts: z.record(z.unknown()).default({}), theme: z.unknown().optional(), panelTheme: z.unknown().optional(), display: z.unknown().optional() }).default({}),
  dataDir: z.string().default('./data'),
  /** Fronteras de sector por circuito cuando el circuito no trae sections.ini: un número (sectores iguales) o la lista de fronteras 0..1. */
  trackSectors: z.record(z.union([z.number().int().min(2).max(12), z.array(z.number().gt(0).lt(1)).min(1)])).default({}),
});

export type HowlerConfig = z.infer<typeof schema>;

/** Raíz del monorepo; el cwd de npm workspaces es el del paquete, así que se resuelve desde aquí. */
export const ROOT = process.env.HOWLER_HOME ? resolve(process.env.HOWLER_HOME) : resolve(import.meta.dirname, '../../..');

export function loadConfig(): HowlerConfig {
  const path = process.env.HOWLER_CONFIG ?? resolve(ROOT, 'howler.config.json');
  // Notepad y otros editores añaden una marca al principio (BOM): se ignora para que el JSON siga siendo válido.
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) : {};
  const cfg = schema.parse(raw);
  return { ...cfg, dataDir: resolve(ROOT, cfg.dataDir) };
}

export function configPath(): string {
  return process.env.HOWLER_CONFIG ?? resolve(ROOT, 'howler.config.json');
}

/** Mezcla profunda de objetos planos (los arrays y valores se reemplazan). */
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
      ? merge(cur as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}

/**
 * Guarda un cambio parcial en howler.config.json, validándolo antes: si el resultado no es válido no se escribe nada.
 * Devuelve la configuración resultante tal como queda en el archivo (sin rutas resueltas).
 */
export function saveConfig(patch: Record<string, unknown>, path = configPath(), replace: string[] = []): z.input<typeof schema> {
  const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>) : {};
  // Las secciones de `replace` se sustituyen enteras (así se pueden borrar claves); el resto se mezcla.
  const next = merge(current, Object.fromEntries(Object.entries(patch).filter(([k]) => !replace.includes(k))));
  for (const k of replace) if (k in patch) next[k] = patch[k];
  schema.parse(next); // lanza ZodError si algo no es válido
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
  return next as z.input<typeof schema>;
}
