/** Cuentas del panel para el acceso remoto (usuario y contraseña); las crea y cambia el administrador desde el panel, en el propio PC. */

export const ACCOUNT_ROLES = ['admin', 'moderator', 'viewer'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface AccountDto {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: string;
  lastLogin: string | null;
}

export interface AccountsStateDto {
  accounts: AccountDto[];
  /** ¿Escucha el panel también fuera de este PC? (cambiarlo requiere reiniciar Howler) */
  remoteEnabled: boolean;
  /** Puerto del panel, para explicar a qué dirección conectarse. */
  port: number;
}

/** Lo que el panel sabe de quien lo está usando. */
export interface WhoAmIDto {
  /** ¿Puede usar el panel (en el PC de Howler, o con la sesión iniciada)? */
  admin: boolean;
  /** Hay que iniciar sesión (acceso remoto sin sesión). */
  login: boolean;
  role: AccountRole | null;
  name: string | null;
  /** Se abre desde el propio PC de Howler. */
  local: boolean;
}

export const MAX_ACCOUNTS = 20;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
export const ACCOUNT_NAME = /^[\p{L}\p{N}._-]{3,32}$/u;
