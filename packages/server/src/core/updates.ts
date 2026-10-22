import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compareVersions, parseVersion, pickNotes, type Lang, type UpdateInfoDto, type UpdateStateDto } from '@howler/shared';

/** Release de GitHub (solo lo que usamos). */
export interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

export interface UpdateSettings { check: boolean; channel: 'stable' | 'beta'; repo: string; dismissed: string }

export interface UpdateDeps {
  current: string;
  settings: () => UpdateSettings;
  /** Guarda «ahora no» para una versión. */
  saveDismissed: (version: string) => void;
  lang: () => Lang;
  /** Carpeta donde se descargan los instaladores. */
  dir: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Lanza el instalador descargado y cierra Howler. En pruebas se sustituye. */
  launch?: (file: string) => Promise<void>;
  platform?: NodeJS.Platform;
}

const CHECK_EVERY_MS = 6 * 3_600_000;
const MAX_DOWNLOAD = 600 * 1024 * 1024;
/** Tiempo máximo de la descarga entera: una conexión parada no deja «descargando» para siempre. */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
/** Solo se descarga de GitHub: la release trae enlaces a estos servidores. */
const DOWNLOAD_HOSTS = /^(?:github\.com|api\.github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|github-releases\.githubusercontent\.com)$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const INSTALLER = /(?:setup|installer|instalador).*\.(?:exe|msi)$/i;

export const isGithubDownload = (u: string): boolean => {
  try { const x = new URL(u); return x.protocol === 'https:' && DOWNLOAD_HOSTS.test(x.hostname); } catch { return false; }
};

/** Qué instalador y qué archivo de sumas corresponden a esta release (Windows). */
export function pickInstaller(r: GhRelease, platform: NodeJS.Platform = process.platform): { installer: GhRelease['assets'][number]; sums: GhRelease['assets'][number] } | null {
  if (platform !== 'win32') return null;
  const installer = r.assets.find((a) => INSTALLER.test(a.name));
  if (!installer) return null;
  const sums = r.assets.find((a) => a.name === `${installer.name}.sha256`) ?? r.assets.find((a) => /^sha256sums?(?:\.txt)?$/i.test(a.name));
  return sums ? { installer, sums } : null;
}

/** Busca el hash de `file` en un archivo de sumas (`<hash>  <archivo>` por línea, o solo el hash). */
export function hashFromSums(text: string, file: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$/.exec(line.trim());
    if (m && (!m[2] || m[2] === file)) return m[1]!.toLowerCase();
  }
  return null;
}

/** Comprueba GitHub, guarda lo último que supo y descarga/instala la versión nueva cuando se pide. */
export class UpdateService {
  private release: GhRelease | null = null;
  private checkedAt: number | null = null;
  private error: string | null = null;
  private checking = false;
  private install: UpdateStateDto['install'] = { state: 'idle', percent: 0, error: null };
  private timer: NodeJS.Timeout | null = null;
  private ready: string | null = null;

  constructor(private d: UpdateDeps) {}

  private get fetchFn() { return this.d.fetchFn ?? fetch; }
  private now() { return (this.d.now ?? Date.now)(); }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), 30 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.check(), 15_000).unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Pregunta a GitHub (como mucho cada 6 horas salvo que se fuerce). */
  async check(force = false): Promise<UpdateStateDto> {
    const s = this.d.settings();
    if (!force && (!s.check || (this.checkedAt != null && this.now() - this.checkedAt < CHECK_EVERY_MS) || this.checking)) return this.state();
    if (!REPO.test(s.repo)) { this.error = 'El repositorio de actualizaciones no es válido.'; return this.state(); }
    this.checking = true;
    try {
      const url = s.channel === 'beta' ? `https://api.github.com/repos/${s.repo}/releases?per_page=15` : `https://api.github.com/repos/${s.repo}/releases/latest`;
      const res = await this.fetchFn(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Howler-updater' }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 && s.channel === 'stable') { this.release = null; this.error = null; this.checkedAt = this.now(); return this.state(); } // aún no hay ninguna release
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub pide esperar un poco antes de volver a comprobar.' : `GitHub respondió con un error (${res.status}).`);
      const json = (await res.json()) as GhRelease | GhRelease[];
      const list = (Array.isArray(json) ? json : [json]).filter((r) => !r.draft && parseVersion(r.tag_name));
      this.release = list.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null;
      this.error = null;
      this.checkedAt = this.now();
    } catch (e) {
      this.error = e instanceof Error && e.name === 'TimeoutError' ? 'GitHub no responde.' : e instanceof Error && /GitHub/.test(e.message) ? e.message : 'No se pudo comprobar si hay una versión nueva (¿sin internet?).';
    } finally {
      this.checking = false;
    }
    return this.state();
  }

  private info(r: GhRelease): UpdateInfoDto {
    return {
      version: r.tag_name.replace(/^v/, ''), name: r.name || r.tag_name, notes: pickNotes(r.body ?? '', this.d.lang()), publishedAt: r.published_at ?? '',
      url: r.html_url, prerelease: r.prerelease, assets: r.assets.map((a) => ({ name: a.name, sizeBytes: a.size })), installable: pickInstaller(r, this.d.platform) != null,
    };
  }

  state(): UpdateStateDto {
    const s = this.d.settings();
    const r = this.release;
    const available = !!r && compareVersions(r.tag_name, this.d.current) > 0;
    return {
      current: this.d.current, latest: r ? this.info(r) : null, available,
      dismissed: available && s.dismissed === r!.tag_name.replace(/^v/, ''),
      checkedAt: this.checkedAt != null ? new Date(this.checkedAt).toISOString() : null, checking: this.checking, error: this.error,
      settings: { check: s.check, channel: s.channel }, install: this.install,
    };
  }

  /** «Ahora no»: se oculta el aviso de esa versión; sigue disponible en Ajustes y, si sale otra más nueva, vuelve a avisar. */
  dismiss(version: string) { this.d.saveDismissed(version); }

  /** Descarga el instalador, comprueba su suma SHA-256 y (si `launch`) lo abre y cierra Howler. */
  async apply(): Promise<UpdateStateDto> {
    const r = this.release;
    let pick: ReturnType<typeof pickInstaller>;
    try {
      if (!r || compareVersions(r.tag_name, this.d.current) <= 0) throw new Error('No hay ninguna versión nueva que instalar.');
      if (this.install.state === 'downloading') throw new Error('Ya se está descargando.');
      pick = pickInstaller(r, this.d.platform);
      if (!pick) throw new Error('Esta versión no trae un instalador con su comprobación: descárgala desde la página de la release.');
      if (!isGithubDownload(pick.installer.browser_download_url) || !isGithubDownload(pick.sums.browser_download_url)) throw new Error('El enlace de descarga no es de GitHub.');
      if (pick.installer.size > MAX_DOWNLOAD) throw new Error('El instalador es demasiado grande.');
    } catch (e) {
      if (this.install.state !== 'downloading') this.install = { state: 'error', percent: 0, error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
    this.install = { state: 'downloading', percent: 0, error: null };
    let file: string | null = null;
    try {
      const sumsRes = await this.fetchFn(pick.sums.browser_download_url, { signal: AbortSignal.timeout(20_000) });
      if (!sumsRes.ok) throw new Error('No se pudo descargar la suma de comprobación.');
      const expected = hashFromSums(await sumsRes.text(), pick.installer.name);
      if (!expected) throw new Error('La suma de comprobación no incluye este instalador.');
      mkdirSync(this.d.dir, { recursive: true });
      const target = (file = join(this.d.dir, pick.installer.name.replace(/[^\w.-]/g, '_')));
      const res = await this.fetchFn(pick.installer.browser_download_url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok || !res.body) throw new Error('No se pudo descargar el instalador.');
      if (res.url && !isGithubDownload(res.url)) throw new Error('La descarga acabó en un servidor que no es de GitHub.');
      const hash = createHash('sha256');
      let got = 0;
      const total = pick.installer.size || Number(res.headers.get('content-length')) || 0;
      const body = Readable.fromWeb(res.body as never);
      body.on('data', (c: Buffer) => {
        got += c.length;
        if (got > MAX_DOWNLOAD) body.destroy(new Error('El instalador es demasiado grande.'));
        hash.update(c);
        this.install = { state: 'downloading', percent: total ? Math.min(99, Math.round((got / total) * 100)) : 0, error: null };
      });
      await pipeline(body, createWriteStream(target));
      if (hash.digest('hex') !== expected) { throw new Error('La descarga no coincide con su suma de comprobación: se ha descartado.'); }
      this.ready = target;
      this.install = { state: 'ready', percent: 100, error: null };
      if (this.d.launch) await this.d.launch(target);
    } catch (e) {
      if (file && this.ready !== file) rmSync(file, { force: true }); // un archivo a medias o que no coincide no se deja en disco
      this.install = { state: 'error', percent: 0, error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
    return this.state();
  }

  get downloaded(): string | null { return this.ready; }
}
