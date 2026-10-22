import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bbcodeToHtml, cleanBbcode, imageUrlWarning, normalizeImageUrl, sheetProblems } from '@howler/shared';
import { readDescriptionText, readServerSheet, readSessionsText, readTitleText, saveServerSheet, setDescriptionText, setTitleText } from './server-sheet';

const INI = '﻿[SERVER]\r\nNAME=Viejo\r\nCARS=a\r\n\r\n[PRACTICE]\r\nNAME=Practice\r\nTIME=10\r\n';
const EXTRA = '# Server description\r\nServerDescription: \'\'\r\n# otra\r\nEnableWeatherFx: true\r\n';

function fake(ini = INI, extra = EXTRA) {
  const dir = join(mkdtempSync(join(tmpdir(), 'howler-sheet-')), 'server');
  mkdirSync(join(dir, 'presets', 'P'), { recursive: true });
  writeFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), ini);
  writeFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), extra);
  return dir;
}

describe('título (NAME de [SERVER])', () => {
  it('lee y cambia solo el de [SERVER], no el de otras secciones, y conserva BOM y CRLF', () => {
    expect(readTitleText(INI)).toBe('Viejo');
    const next = setTitleText(INI, '🏁 Nuevo // Servidor');
    expect(readTitleText(next)).toBe('🏁 Nuevo // Servidor');
    expect(next).toContain('[PRACTICE]\r\nNAME=Practice');
    expect(next.startsWith('﻿[SERVER]\r\n')).toBe(true);
    expect(next).not.toMatch(/[^\r]\n/);
  });
  it('añade NAME si no existía y rechaza saltos de línea', () => {
    expect(readTitleText(setTitleText('[SERVER]\nCARS=a\n', 'X'))).toBe('X');
    expect(() => setTitleText(INI, 'a\nb')).toThrow();
  });
});

describe('descripción (ServerDescription)', () => {
  it('escribe una línea entre comillas dobles que se lee igual, con saltos, comillas y barras', () => {
    const text = 'Línea 1\nCon "comillas" y \\barra\\ y [b]negrita[/b]\n🏁';
    const next = setDescriptionText(EXTRA, text);
    expect(next).toContain('ServerDescription: "');
    expect(next).toContain('# otra\r\nEnableWeatherFx: true');
    expect(readDescriptionText(next)).toBe(text);
    expect(next).not.toMatch(/[^\r]\n/);
  });
  it('reemplaza una descripción de varias líneas (bloque |) entera', () => {
    const extra = 'A: 1\nServerDescription: |\n  hola\n  adiós\n\nB: 2\n';
    expect(readDescriptionText(extra)).toBe('hola\nadiós');
    expect(setDescriptionText(extra, 'nueva')).toBe('A: 1\nServerDescription: "nueva"\n\nB: 2\n');
  });
  it('lee comillas simples, texto plano y entre comillas partido en varias líneas', () => {
    expect(readDescriptionText("ServerDescription: 'it''s ok'\n")).toBe("it's ok");
    expect(readDescriptionText('ServerDescription: hola mundo\n')).toBe('hola mundo');
    expect(readDescriptionText('ServerDescription: "uno\n  dos"\nX: 1\n')).toBe('uno dos');
    expect(readDescriptionText('X: 1\n')).toBe('');
  });
  it('añade la clave si no existe', () => {
    expect(setDescriptionText('X: 1\n', 'hola')).toBe('X: 1\nServerDescription: "hola"\n');
  });
});

describe('sesiones y contraseña', () => {
  it('lee práctica, clasificación y carrera del preset', () => {
    const ini = ['[SERVER]', 'PASSWORD=abc', '[PRACTICE]', 'NAME=Practice', 'TIME=90', '[RACE]', 'NAME=Race', 'LAPS=0', 'TIME=15', ''].join('\n');
    expect(readSessionsText(ini)).toEqual({ hasPassword: true, sessions: [{ kind: 'practice', minutes: 90, laps: 0 }, { kind: 'race', minutes: 15, laps: 0 }] });
    expect(readSessionsText(INI).hasPassword).toBe(false);
    expect(readSessionsText(INI).sessions).toEqual([{ kind: 'practice', minutes: 10, laps: 0 }]);
  });
});

describe('BBCode de Content Manager', () => {
  it('conserva las etiquetas conocidas con valores válidos y quita las inválidas', () => {
    const src = '[size=20][color=#ff4500][b]Hola[/b][/color][/size]\n[url=https://discord.gg/x]Discord[/url] [u]u[/u] [i]i[/i] [s]s[/s] [mono]m[/mono] [sup]2[/sup]';
    expect(cleanBbcode(src)).toBe(src);
    expect(cleanBbcode('[url=javascript:alert(1)]x[/url]')).toBe('x');
    expect(cleanBbcode('[color=red]a[/color]')).toBe('[color=red]a[/color]'); // CM acepta nombres de color
    expect(cleanBbcode('[color=#zzz]a[/color][size=99]b[/size][size=3]c[/size]')).toBe('abc');
    expect(cleanBbcode('[b]sin cerrar')).toBe('[b]sin cerrar[/b]');
  });
  it('lo que CM ignora se conserva en el archivo pero CM lo traga al dibujar', () => {
    // CM distingue mayúsculas: [B] y [PRO] no son etiquetas conocidas, desaparecen y queda su texto
    expect(cleanBbcode('[PRO]hola[/PRO] [B]x[/B]')).toBe('[PRO]hola[/PRO] [B]x[/B]');
    expect(bbcodeToHtml('[PRO]hola[/PRO] [B]x[/B]')).toBe('hola x');
    expect(bbcodeToHtml('suelto[/b] fin')).toBe('suelto fin');
  });
  it('[center] no existe en CM: se quita al guardar', () => {
    expect(cleanBbcode('[center]hola[/center]')).toBe('hola');
    expect(bbcodeToHtml('[center]hola[/center]')).toBe('hola');
  });
  it('[br] es un salto de línea y \\[ un corchete literal', () => {
    expect(bbcodeToHtml('a[br]b')).toBe('a<br>b');
    expect(bbcodeToHtml('a[BR]b')).toBe('a<br>b');
    // solo «\[» es escape en CM; el «]» suelto es texto
    expect(bbcodeToHtml('\\[PRO] hola')).toBe('[PRO] hola');
    expect(cleanBbcode('\\[PRO] hola')).toBe('\\[PRO] hola');
  });
  it('el valor de una etiqueta puede ir entre comillas y sin ellas termina en el primer espacio', () => {
    expect(cleanBbcode('[url="https://a.com/x"]t[/url]')).toBe('[url=https://a.com/x]t[/url]');
    expect(cleanBbcode("[color='red']t[/color]")).toBe('[color=red]t[/color]');
  });
  it('la imagen se escribe como CM: [img=URL|tamaño]texto[/img]', () => {
    expect(cleanBbcode('[img=https://a.com/x.png|200]logo[/img]')).toBe('[img=https://a.com/x.png|200]logo[/img]');
    expect(cleanBbcode('[img=https://a.com/x.png]logo[/img]')).toBe('[img=https://a.com/x.png]logo[/img]');
    // sin texto dentro CM no dibuja nada: se pone el nombre del archivo
    expect(cleanBbcode('[img=https://a.com/mi-logo.png|100][/img]')).toBe('[img=https://a.com/mi-logo.png|100]mi-logo[/img]');
    // formatos antiguos de Howler: se convierten
    expect(cleanBbcode('[img]https://a.com/x.png[/img]')).toBe('[img=https://a.com/x.png]x[/img]');
    expect(cleanBbcode('[img=150]https://a.com/x.png[/img]')).toBe('[img=https://a.com/x.png|150]x[/img]');
    // tamaño absurdo o dirección peligrosa
    expect(cleanBbcode('[img=https://a.com/x.png|9999]a[/img]')).toBe('[img=https://a.com/x.png]a[/img]');
    expect(cleanBbcode('[img=javascript:alert(1)|50]a[/img]')).toBe('');
    expect(cleanBbcode('[img=ftp://a.com/x.png]a[/img]')).toBe('');
  });
  it('una imagen dentro de un enlace se conserva (clicable)', () => {
    const src = '[url=https://github.com/x][img=https://a.com/x.png|400]Howler[/img][/url]';
    expect(cleanBbcode(src)).toBe(src);
  });
  it('CM convierte en enlace las URL sueltas del texto, no las de dentro de una etiqueta', () => {
    expect(bbcodeToHtml('mira https://github.com/x/y y discord.gg/abc.')).toBe('mira <a href="https://github.com/x/y" target="_blank" rel="noreferrer noopener">https://github.com/x/y</a> y <a href="http://discord.gg/abc" target="_blank" rel="noreferrer noopener">discord.gg/abc</a>.');
    const img = bbcodeToHtml('[img=https://a.com/x.png]x[/img]');
    expect(img.match(/<a /g)).toBeNull(); // la dirección del atributo no se enlaza
    expect(bbcodeToHtml('[url=https://a.com/x]https://a.com/x[/url]').match(/<a /g)).toHaveLength(1);
    expect(bbcodeToHtml('foto.png y hola.com')).not.toContain('foto.png</a>');
  });
  it('lo convierte a HTML escapado, sin dejar pasar etiquetas HTML ni enlaces peligrosos', () => {
    const html = bbcodeToHtml('<script>x</script>[b]a[/b]\nb [url=javascript:x]c[/url] [img=https://a.com/x.png|200]i"<b>[/img]');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<b>a</b><br>b');
    expect(html).not.toContain('javascript');
    expect(html).toContain('style="max-width:200px;max-height:200px"');
    expect(html).not.toContain('<b>"');
  });
  it('el título de la cabecera también pasa por BBCode: [EU] desaparece y las direcciones son enlaces', () => {
    // la ficha de CM dibuja el título con las mismas reglas (SelectableBbCodeBlock, modo completo)
    const html = bbcodeToHtml('[EU] Patata School discord.gg/abc');
    expect(html).not.toContain('EU');
    expect(html).toContain('<a href="http://discord.gg/abc"');
  });
  it('el tamaño de letra es en píxeles', () => {
    expect(bbcodeToHtml('[size=20]x[/size]')).toBe('<span style="font-size:20px">x</span>');
  });
  it('valida título y longitud', () => {
    expect(sheetProblems('ok', 'x')).toEqual([]);
    expect(sheetProblems('', 'x')).toHaveLength(1);
    expect(sheetProblems('ok', 'x'.repeat(7000))).toHaveLength(1);
  });
  it('convierte el enlace de página de GitHub en el enlace directo de la imagen', () => {
    expect(normalizeImageUrl('https://github.com/Marc0F12/Howler/blob/main/assets/howler-logo-vertical-720.png')).toBe('https://raw.githubusercontent.com/Marc0F12/Howler/main/assets/howler-logo-vertical-720.png');
    expect(normalizeImageUrl('  https://i.imgur.com/abc.png ')).toBe('https://i.imgur.com/abc.png');
  });
  it('avisa de enlaces de Discord (caducan) y de páginas que no son una imagen', () => {
    expect(imageUrlWarning('https://cdn.discordapp.com/attachments/1/2/x.png?ex=1&hm=2')).toBe('discord');
    expect(imageUrlWarning('https://imgur.com/gallery/abc')).toBe('page');
    expect(imageUrlWarning('https://i.imgur.com/abc.png')).toBeNull();
    expect(imageUrlWarning('https://raw.githubusercontent.com/a/b/main/x.png')).toBeNull();
    expect(imageUrlWarning('https://a.com/foto.JPG')).toBeNull();
  });
});

describe('guardar y leer la ficha', () => {
  it('guarda título y descripción, enciende EnableServerDetails y deja copia .howler-prev', () => {
    const dir = fake();
    const saved = saveServerSheet(dir, 'P', 'Mi servidor', '[b]Hola[/b]\n[url=ftp://x]y[/url]');
    expect(saved.title).toBe('Mi servidor');
    expect(saved.description).toBe('[b]Hola[/b]\ny');
    expect(saved.detailsEnabled).toBe(true);
    const extra = readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml'), 'utf8');
    expect(extra).toContain('EnableServerDetails: true');
    expect(readFileSync(join(dir, 'presets', 'P', 'extra_cfg.yml.howler-prev'), 'utf8')).toBe(EXTRA);
    expect(readFileSync(join(dir, 'presets', 'P', 'server_cfg.ini.howler-prev'), 'utf8')).toBe(INI);
  });
  it('lee lo que ya hay en el servidor', () => {
    const dir = fake(INI, 'ServerDescription: "[b]Previo[/b]"\n');
    expect(readServerSheet(dir, 'P')).toMatchObject({ title: 'Viejo', description: '[b]Previo[/b]', missing: null });
  });
  it('no escribe nada si algo no es válido', () => {
    const dir = fake();
    expect(() => saveServerSheet(dir, 'P', '', 'x')).toThrow(/título/);
    expect(readFileSync(join(dir, 'presets', 'P', 'server_cfg.ini'), 'utf8')).toBe(INI);
  });
});
