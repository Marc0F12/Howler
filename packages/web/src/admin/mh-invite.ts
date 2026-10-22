/** Lo que se pasan dos personas para vincular sus Howlers: la dirección de la web y la clave. */
export interface Invite { url?: string; key?: string }

const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const KEY_RE = /HWL(?:-[A-Z0-9]{4}){4}/i;

/** Saca la dirección y la clave de un texto pegado (la invitación entera, o solo una de las dos cosas). */
export function parseInvite(text: string): Invite {
  const url = URL_RE.exec(text)?.[0]?.replace(/[.,;)]+$/, '');
  const key = KEY_RE.exec(text)?.[0]?.toUpperCase();
  return { ...(url ? { url } : {}), ...(key ? { key } : {}) };
}

/** La invitación para pasar por Discord o WhatsApp. */
export function inviteText(address: string, key: string): string {
  return `Dirección: ${address.trim()}\nClave: ${key}`;
}
