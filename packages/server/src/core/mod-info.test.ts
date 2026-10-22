import { describe, expect, it } from 'vitest';
import { assertPublicUrl, cleanModTitle, fetchModInfo, isPrivateAddress, parseModHtml } from './mod-info';

// Páginas de EJEMPLO escritas a mano con el formato típico (OpenGraph + datos etiquetados); no son copias de ninguna web real.
const CAR_PAGE = `<html><head><title>Porsche 911 Singer | Overtake</title>
<meta property="og:title" content="Porsche 911 Singer &amp; DLS">
<meta property="og:description" content="Restomod de 4.0 L, muy fiel.">
<meta property="og:image" content="/media/singer.jpg"><meta property="og:site_name" content="Overtake">
</head><body><ul><li>Power: 500 hp</li><li>Torque: 460 Nm</li><li>Weight: 1.250 kg</li><li>Drivetrain: RWD</li><li>Gears: 6 speed</li></ul>
<script>var power = "Power: 99999 hp";</script></body></html>`;
const TRACK_PAGE = `<html><head><title>Las Vegas</title><script type="application/ld+json">{"@type":"Product","name":"Las Vegas Street","description":"Circuito urbano","image":["https://cdn.example.com/lv.jpg"]}</script></head>
<body><p>Country: United States</p><p>Length: 5.8 km</p></body></html>`;

describe('lectura de fichas de mods', () => {
  it('saca título, descripción, imagen y especificaciones de una página de coche', () => {
    const m = parseModHtml(CAR_PAGE, 'https://www.example.com/cars/porsche-911-singer.29318/');
    expect(m).toMatchObject({ title: 'Porsche 911 Singer & DLS', description: 'Restomod de 4.0 L, muy fiel.', imageUrl: 'https://www.example.com/media/singer.jpg', siteName: 'Overtake', kind: 'car' });
    expect(m.specs).toMatchObject({ Potencia: '500 hp', Par: '460 Nm', Peso: '1.250 kg', Tracción: 'RWD', Marchas: '6' });
    expect(m.specs.Potencia).not.toContain('99999'); // el texto de los scripts no cuenta
  });

  it('usa JSON-LD si no hay OpenGraph, y detecta circuitos con país y longitud', () => {
    const m = parseModHtml(TRACK_PAGE, 'https://x.example.com/tracks/las_vegas/');
    expect(m).toMatchObject({ title: 'Las Vegas Street', description: 'Circuito urbano', imageUrl: 'https://cdn.example.com/lv.jpg', kind: 'track' });
    expect(m.specs).toMatchObject({ País: 'United States', Longitud: '5.8 km' });
  });

  it('una página sin datos no revienta y no inventa nada; imágenes que no son http(s) se descartan', () => {
    const m = parseModHtml('<html><meta property="og:image" content="javascript:alert(1)"><body>hola</body></html>', 'https://x.example.com/foo');
    expect(m).toMatchObject({ title: null, description: null, imageUrl: null, kind: 'other', specs: {} });
  });

  it('no visita direcciones privadas ni esquemas raros', async () => {
    const pub = async () => ['93.184.216.34'];
    for (const bad of ['http://127.0.0.1/x', 'http://localhost/x', 'http://192.168.1.5/', 'http://[::1]/', 'http://10.0.0.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/'])
      await expect(assertPublicUrl(bad, pub)).rejects.toThrow();
    await expect(assertPublicUrl('https://interno.example.com/', async () => ['10.1.2.3'])).rejects.toThrow(/no es pública/);
    expect((await assertPublicUrl('https://example.com/a', pub)).hostname).toBe('example.com');
    expect(['::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '100.64.0.1', '0.0.0.0'].every(isPrivateAddress)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('sigue redirecciones comprobando cada salto y no se deja llevar a una dirección privada', async () => {
    const resolve = async (h: string) => (h === 'evil.example.com' ? ['127.0.0.1'] : ['93.184.216.34']);
    const ok = async (u: string) => (u.includes('/old') ? new Response(null, { status: 301, headers: { location: '/new' } }) : new Response(CAR_PAGE, { headers: { 'content-type': 'text/html' } }));
    expect((await fetchModInfo('https://example.com/old', { fetcher: ok as never, resolve })).title).toContain('Singer');
    const evil = async () => new Response(null, { status: 302, headers: { location: 'http://evil.example.com/' } });
    await expect(fetchModInfo('https://example.com/a', { fetcher: evil as never, resolve })).rejects.toThrow(/no es pública/);
    const loop = async () => new Response(null, { status: 302, headers: { location: '/otra' } });
    await expect(fetchModInfo('https://example.com/a', { fetcher: loop as never, resolve })).rejects.toThrow(/redirecciones/);
  });

  it('explica el fallo cuando la web bloquea o no es HTML', async () => {
    const resolve = async () => ['93.184.216.34'];
    await expect(fetchModInfo('https://example.com/a', { fetcher: (async () => new Response('no', { status: 403 })) as never, resolve })).rejects.toThrow(/a mano/);
    await expect(fetchModInfo('https://example.com/a', { fetcher: (async () => new Response('x', { headers: { 'content-type': 'application/zip' } })) as never, resolve })).rejects.toThrow(/descarga directa/);
  });
});

describe('cleanModTitle', () => {
  it('quita la publicidad de la web pero no parte del nombre', () => {
    expect(cleanModTitle('Ferrari 488 GT3 | Download Free Car Mod - Assetto Hub')).toBe('Ferrari 488 GT3');
    expect(cleanModTitle('Imola 2024 - Free Download | AssettoCorsaMods')).toBe('Imola 2024');
    expect(cleanModTitle('Porsche 911 Singer | Overtake')).toBe('Porsche 911 Singer');
    expect(cleanModTitle('BMW M3 E30 - Drift Edition')).toBe('BMW M3 E30 - Drift Edition'); // el guion forma parte del nombre
    expect(cleanModTitle('Nordschleife - Tourist | Download Free Track Mod')).toBe('Nordschleife - Tourist');
    expect(cleanModTitle('Solo nombre')).toBe('Solo nombre');
    expect(cleanModTitle('| Download Free')).toBe('| Download Free'); // nunca devuelve vacío
    expect(cleanModTitle(null)).toBeNull();
  });
});

describe('direcciones IPv6 con IPv4 escondida', () => {
  it('rechaza todas las formas de llegar a una IPv4 privada', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '::1', '::', 'fe80::1', 'fd12::1', 'ff02::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['2606:4700:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001::200e']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('plainText no se dispara con muchas etiquetas sin cerrar', () => {
    const html = '<html><body>' + '<script '.repeat(60_000) + '</body></html>';
    const t0 = performance.now();
    parseModHtml(html, 'https://example.com/');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
