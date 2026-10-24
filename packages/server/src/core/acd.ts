/**
 * Lector de `data.acd` de Assetto Corsa (el paquete de datos de un coche, cifrado con una clave sacada del nombre de su carpeta).
 * El algoritmo es público: está en AcTools (Content Manager, Ms-PL), en el script «assetto_corsa_acd» de QuickBMS y en el lector
 * de Assetto Server Manager (MIT, https://github.com/JustaPenguin/assetto-server-manager/blob/master/pkg/acd/reader.go), del que
 * se ha portado esta versión. Solo lee; nunca escribe.
 *
 * Las cuentas de la clave se hacen con enteros de 64 bits con signo y con bytes que dan la vuelta (uint8), igual que en Go,
 * por eso se usa BigInt y `wrap8`.
 */
const I64 = (n: bigint) => BigInt.asIntN(64, n);
const wrap8 = (n: number) => n & 0xff;

/** Clave de descifrado a partir del nombre de la carpeta del coche (por ejemplo `ks_mazda_mx5_cup`). */
export function acdCipherKey(folder: string): string {
  const f = Buffer.from(folder, 'latin1');
  const len = f.length;
  const c = (i: number) => BigInt(f[i] ?? 0);
  let p1 = 0n;
  for (let i = 0; i < len; i++) p1 = I64(p1 + c(i));
  let p2 = 0n;
  for (let i = 0; i < len - 1; i++) { p2 = I64(p2 * c(i)); i++; p2 = I64(p2 - c(i)); }
  let p3 = 0n;
  for (let i = 1; i < len - 3; i += 4) {
    p3 = I64(p3 * c(i)); i++;
    const d = BigInt(wrap8((f[i] ?? 0) + 0x1b));
    if (d !== 0n) p3 = I64(p3 / d);
    i -= 2;
    p3 = I64(p3 - 0x1bn - c(i));
  }
  let p4 = 0x1683n;
  for (let i = 1; i < len; i++) p4 = I64(p4 - c(i));
  let p5 = 0x42n;
  for (let i = 1; i < len - 4; i += 4) {
    const n = I64(BigInt(wrap8((f[i] ?? 0) + 0xf)) * p5);
    i--;
    let x = c(i);
    i++;
    x = I64(x + 0xfn);
    x = I64(x * n);
    x = I64(x + 0x16n);
    p5 = x;
  }
  let p6 = 0x65n;
  for (let i = 0; i < len - 2; i += 2) p6 = I64(p6 - c(i));
  let p7 = 0xabn;
  for (let i = 0; i < len - 2; i += 2) { const d = c(i); if (d !== 0n) p7 = I64(p7 % d); }
  let p8 = 0xabn;
  for (let i = 0; i < len - 1; i++) {
    const t = c(i);
    if (t !== 0n) p8 = I64(p8 / t);
    i++;
    p8 = I64(p8 + c(i));
    i--;
  }
  return [p1, p2, p3, p4, p5, p6, p7, p8].map((p) => (p & 0xffn).toString()).join('-');
}

export interface AcdFile { name: string; data: Buffer }

/** Lee todos los archivos de un `data.acd`. `folder` es el nombre de la carpeta del coche. Devuelve [] si el formato no cuadra. */
export function readAcd(buf: Buffer, folder: string): AcdFile[] {
  const key = Buffer.from(acdCipherKey(folder), 'latin1');
  const out: AcdFile[] = [];
  let pos = 0;
  const i32 = () => { if (pos + 4 > buf.length) throw new RangeError('acd corto'); const v = buf.readInt32LE(pos); pos += 4; return v; };
  try {
    while (pos < buf.length) {
      let n = i32();
      if (n === -1111) { i32(); n = i32(); }
      if (n < 0 || n > 512 || pos + n > buf.length) return [];
      const name = buf.subarray(pos, pos + n).toString('latin1'); pos += n;
      const words = i32();
      if (words < 0 || pos + words * 4 > buf.length) return [];
      const raw = Buffer.from(buf.subarray(pos, pos + words * 4)); pos += words * 4;
      // desciframos como en el original: los bytes a cero no se tocan y no gastan clave
      let x = 0;
      for (let b = 0; b < raw.length; b++) {
        if (raw[b] === 0) continue;
        raw[b] = (raw[b]! - key[x % key.length]!) & 0xff;
        x++;
      }
      // el contenido va como UTF-32 pequeño: cada carácter ocupa 4 bytes, nos quedamos con el primero de cada uno
      const data = Buffer.alloc(words);
      for (let k = 0; k < words; k++) data[k] = raw[k * 4]!;
      out.push({ name, data });
    }
  } catch { return []; }
  return out;
}

/** Cifra (solo para pruebas): inversa exacta de lo que hace `readAcd`. */
export function writeAcdForTests(files: AcdFile[], folder: string): Buffer {
  const key = Buffer.from(acdCipherKey(folder), 'latin1');
  const parts: Buffer[] = [];
  const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
  for (const f of files) {
    const nm = Buffer.from(f.name, 'latin1');
    const raw = Buffer.alloc(f.data.length * 4);
    for (let k = 0; k < f.data.length; k++) raw[k * 4] = f.data[k]!;
    let x = 0;
    for (let b = 0; b < raw.length; b++) {
      if (raw[b] === 0) continue;
      raw[b] = (raw[b]! + key[x % key.length]!) & 0xff;
      x++;
    }
    parts.push(i32(nm.length), nm, i32(f.data.length), raw);
  }
  return Buffer.concat(parts);
}
