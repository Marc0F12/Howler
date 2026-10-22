import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Piezas del instalador que NO tocan el servidor de AC (eso lo hace `migrate.ts`): detectar una instalación previa,
 * crear la configuración de Howler, copiar el servidor a una carpeta nueva, y generar los scripts de Windows
 * (cortafuegos, accesos directos, arranque con Windows, desinstalar). Los scripts se generan como TEXTO: nada se
 * ejecuta aquí, así que se pueden probar sin Windows. NO PROBADO contra un Windows ni un servidor real.
 */


export interface ExistingInstall { exists: boolean; hasConfig: boolean; hasData: boolean }

/** ¿Hay ya un Howler instalado en esta carpeta? (para actualizar conservando `data/` y `howler.config.json`). */
export function detectInstall(dir: string): ExistingInstall {
  const hasConfig = existsSync(join(dir, 'howler.config.json'));
  const hasData = existsSync(join(dir, 'data', 'howler.db'));
  return { exists: hasConfig || hasData, hasConfig, hasData };
}

export interface HowlerPorts { web: number; panel: number; acspListen: number; acspServer: number; plugin: number; pluginCommand: number }
export const DEFAULT_PORTS: HowlerPorts = { web: 8420, panel: 8421, acspListen: 12000, acspServer: 11000, plugin: 12001, pluginCommand: 12002 };

/**
 * Crea `howler.config.json` si no existe. Si ya existe NO se toca (actualizar no debe pisar la configuración):
 * devuelve `kept`. El panel solo escucha en 127.0.0.1, así que su puerto no se abre al exterior.
 */
export function writeHowlerConfig(installDir: string, serverDir: string, ports: Partial<HowlerPorts> = {}, server?: { exe?: string; preset?: string }): 'created' | 'kept' {
  const file = join(installDir, 'howler.config.json');
  if (existsSync(file)) return 'kept';
  const p = { ...DEFAULT_PORTS, ...ports };
  const config = {
    serverDir,
    http: { host: '0.0.0.0', port: p.web },
    admin: { port: p.panel },
    acsp: { listenHost: '127.0.0.1', listenPort: p.acspListen, serverHost: '127.0.0.1', serverPort: p.acspServer, pluginPort: p.plugin, pluginCommandPort: p.pluginCommand },
    ...(server?.preset ? { server: { exe: server.exe ?? 'acServer.exe', preset: server.preset } } : {}),
    dataDir: './data',
  };
  mkdirSync(installDir, { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return 'created';
}

/** Carpetas y archivos que NO se copian al montar un servidor nuevo: copias de seguridad, logs y el marcador de una migración anterior (apuntaría a las copias del original). */
const SKIP_WHEN_COPYING = new Set(['howler-backup', 'logs', 'howler-migration.json']);

/** Modo «carpeta nueva»: copia el servidor entero (sin copias de seguridad ni logs) y deja el original intacto. */
export function copyServer(srcDir: string, destDir: string): { files: number } {
  const src = resolve(srcDir), dest = resolve(destDir);
  if (dest === src || dest.startsWith(src + '\\') || dest.startsWith(src + '/')) throw new Error('La carpeta nueva no puede estar dentro de la del servidor actual.');
  if (existsSync(dest) && readdirSync(dest).length > 0) throw new Error('La carpeta nueva ya existe y no está vacía.');
  let files = 0;
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const name = p.split(/[\\/]/).pop()!;
      if (SKIP_WHEN_COPYING.has(name)) return false;
      if (!statSync(p).isDirectory()) files++;
      return true;
    },
  });
  return { files };
}

// --- Scripts de Windows (texto) -----------------------------------------------------------------------------------

const RULE_PREFIX = 'Howler';

/**
 * Reglas de cortafuegos de entrada. Solo se abre la web pública (TCP). Los puertos UDP del servidor de juego los abre
 * quien monta el servidor (Content Manager lo hace); los puertos entre Howler y el plugin son locales (127.0.0.1) y no se abren.
 */
export function firewallScript(ports: Pick<HowlerPorts, 'web'> = DEFAULT_PORTS): { add: string; remove: string } {
  const name = `${RULE_PREFIX} web ${ports.web}`;
  return {
    // Se borra antes la regla del mismo nombre: reinstalar o actualizar no deja reglas repetidas.
    add: `netsh advfirewall firewall delete rule name="${name}" & netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=TCP localport=${ports.web} profile=any`,
    remove: `netsh advfirewall firewall delete rule name="${name}"`,
  };
}

/** Acceso directo de escritorio / menú inicio con PowerShell (`WScript.Shell`). */
export function shortcutScript(target: string, linkPath: string, args = '', workDir = ''): string {
  // PowerShell también trata las comillas tipográficas ‘ ’ ‚ ‛ como comillas simples: todas se duplican.
  const q = (s: string) => `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`;
  return [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(linkPath) + ')',
    `$s.TargetPath = ${q(target)}`,
    args ? `$s.Arguments = ${q(args)}` : '',
    workDir ? `$s.WorkingDirectory = ${q(workDir)}` : '',
    '$s.Save()',
  ].filter(Boolean).join('\n');
}

/** Arranque con Windows (opcional): un acceso directo en la carpeta Inicio del usuario. No toca el registro. */
export function autostartLink(startupDir: string): string { return join(startupDir, 'Howler.lnk'); }

export interface UninstallPlan { remove: string[]; keep: string[]; commands: string[] }

/** Qué borra desinstalar: los programas y accesos; por defecto se CONSERVAN los datos y la configuración. */
export function uninstallPlan(installDir: string, ports: Pick<HowlerPorts, 'web'>, deleteData = false, shortcuts: string[] = []): UninstallPlan {
  const data = [join(installDir, 'data'), join(installDir, 'howler.config.json')];
  return {
    // Los accesos directos (escritorio, menú inicio, arranque con Windows) también se quitan: si no, Windows lanzaría uno roto en cada inicio.
    remove: [join(installDir, 'Howler.exe'), join(installDir, 'web'), join(installDir, 'plugin'), ...shortcuts, ...(deleteData ? data : [])],
    keep: deleteData ? [] : data,
    commands: [firewallScript(ports).remove],
  };
}

/** Línea de `SHA256SUMS` de un archivo (formato `hash  nombre`, como `sha256sum`), para publicar junto al instalador. */
export function sha256Line(file: string): string {
  // Por trozos: un instalador de cientos de MB no se carga entero en memoria.
  const h = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return `${h.digest('hex')}  ${file.split(/[\\/]/).pop()}`;
}
