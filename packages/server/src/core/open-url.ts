import { spawn } from 'node:child_process';

/**
 * Abre un enlace en el navegador (o en Content Manager) de quien usa el PC, sin pasar por ningún intérprete de órdenes:
 * ningún carácter del enlace se interpreta como comando. En un servidor sin escritorio (un VPS) no hay a quién enseñárselo
 * y el intento falla en silencio.
 */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) throw new Error('Solo se abren enlaces http(s).');
  const { cmd, args } = openCommand(url);
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined); // sin escritorio (o sin xdg-open) no hay nada que abrir: no debe caerse Howler
  child.unref();
}
