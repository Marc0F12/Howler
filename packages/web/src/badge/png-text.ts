/** Metadatos de texto (fragmentos `tEXt`) dentro de un PNG ya hecho, sin dependencias. */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Texto a ASCII imprimible: lo que no cabe se escribe como \uXXXX (así el JSON de un diseño con tildes o emojis sigue siendo válido al leerlo). */
export const latin1Safe = (s: string): string => s.replace(/[^\x20-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Devuelve el PNG con un fragmento `tEXt` por entrada (clave de 1-79 caracteres ASCII), colocados antes de los datos de imagen. */
export function addPngText(png: Uint8Array, entries: Record<string, string>): Uint8Array {
  if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('No es un PNG.');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8, insertAt = -1;
  while (pos + 12 <= png.length) {
    const len = dv.getUint32(pos), type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (type === 'IDAT') { insertAt = pos; break; }
    pos += 12 + len;
  }
  if (insertAt < 0) throw new Error('PNG sin datos de imagen.');
  const parts: Uint8Array[] = [png.subarray(0, insertAt)];
  for (const [key, value] of Object.entries(entries)) {
    if (!/^[\x20-\x7e]{1,79}$/.test(key)) throw new Error('Clave de texto no válida.');
    const text = latin1Safe(value);
    const data = new Uint8Array(key.length + 1 + text.length);
    for (let i = 0; i < key.length; i++) data[i] = key.charCodeAt(i);
    for (let i = 0; i < text.length; i++) data[key.length + 1 + i] = text.charCodeAt(i);
    parts.push(chunk('tEXt', data));
  }
  parts.push(png.subarray(insertAt));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Los pares clave → texto de los fragmentos `tEXt` de un PNG (para comprobar y para recuperar un diseño). */
export function readPngText(png: Uint8Array): Record<string, string> {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Record<string, string> = {};
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = dv.getUint32(pos), type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (type === 'tEXt') {
      const data = png.subarray(pos + 8, pos + 8 + len), z = data.indexOf(0);
      if (z > 0) out[String.fromCharCode(...data.subarray(0, z))] = String.fromCharCode(...data.subarray(z + 1));
    }
    pos += 12 + len;
  }
  return out;
}
