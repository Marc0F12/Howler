/** Archivos de datos de un coche (`data/*.ini`), sueltos o dentro de `data.acd` cifrado. Solo lectura, con memoria por coche. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readAcd, type AcdFile } from './acd';

const cache = new Map<string, { stamp: string; files: Map<string, string> }>();

/** Lee un archivo de texto de `data` del coche (por ejemplo `tyres.ini`). null si no existe o no se puede leer. */
export function readCarDataFile(carDir: string, file: string): string | null {
  const wanted = file.toLowerCase();
  try {
    const loose = join(carDir, 'data', file);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').replace(/^﻿/, '');
    const acd = join(carDir, 'data.acd');
    if (!existsSync(acd)) return null;
    const stamp = String(statSync(acd).mtimeMs);
    let hit = cache.get(acd);
    if (!hit || hit.stamp !== stamp) {
      const files = new Map<string, string>();
      for (const f of readAcd(readFileSync(acd), basename(carDir)) as AcdFile[]) {
        if (/\.(ini|json)$/i.test(f.name)) files.set(f.name.toLowerCase(), f.data.toString('utf8').replace(/^﻿/, ''));
      }
      hit = { stamp, files };
      if (cache.size > 200) cache.clear();
      cache.set(acd, hit);
    }
    return hit.files.get(wanted) ?? null;
  } catch { return null; }
}

export interface CarTyre { short: string; name: string }

/** Compuestos de un `tyres.ini`: las secciones [FRONT], [FRONT_1], [FRONT_2]... (las `__CM_…` son copias de Content Manager). */
export function parseTyresIni(text: string): CarTyre[] {
  const out: CarTyre[] = [];
  let sec = '';
  let cur: { name?: string; short?: string } | null = null;
  const flush = () => { if (cur?.short && !/\s/.test(cur.short) && !out.some((t) => t.short === cur!.short)) out.push({ short: cur.short, name: cur.name || cur.short }); cur = null; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(';')[0]!.trim();
    const s = /^\[(.+)\]$/.exec(line);
    if (s) { flush(); sec = s[1]!.toUpperCase(); cur = /^FRONT(_\d+)?$/.test(sec) ? {} : null; continue; }
    if (!cur) continue;
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (!kv) continue;
    const k = kv[1]!.trim().toUpperCase(), v = kv[2]!.trim();
    if (k === 'NAME') cur.name = v;
    if (k === 'SHORT_NAME') cur.short = v;
  }
  flush();
  return out;
}

export function carTyres(carDir: string): CarTyre[] {
  const t = readCarDataFile(carDir, 'tyres.ini');
  return t ? parseTyresIni(t) : [];
}
