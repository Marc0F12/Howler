<p align="center"><img src="assets/howler-cabecera-readme-1280x320.png" alt="Howler"></p>

# Howler

**Tiempos, estadísticas y control para servidores de Assetto Corsa** (AssettoServer v0.0.55-pre35).
**Lap times, stats and control for Assetto Corsa servers.**

Howler recoge las vueltas, los sectores y los incidentes de tu servidor, los guarda en una base de datos propia y los enseña en una web pública (tiempos, sesiones, pilotos, campeonatos, comparador de vueltas, fantasmas) y en un panel de control (arrancar y parar el servidor, ajustes de sesión, clima, penalizaciones, campeonatos, Discord…). Sustituye a stracker. Software libre bajo AGPL-3.0.

- 🇪🇸 [Manual en español](docs/MANUAL.md) · 🇬🇧 [Manual in English](docs/MANUAL.en.md)
- [Howler en Linux / on Linux](docs/LINUX.md)
- [Cambios / Changelog](CHANGELOG.md)

## Descargar / Download

Las versiones están en [Releases](../../releases):

| Sistema | Archivo | Cómo |
|---|---|---|
| Windows 10/11 | `Howler-Setup.exe` | Ábrelo y sigue el asistente (instala solo para tu usuario, sin administrador). |
| Linux | `Howler-<versión>-linux.tar.gz` | `tar -xzf Howler-*-linux.tar.gz && cd howler && bash install.sh --server /ruta/a/tu/servidor && bash start.sh` (necesita Node 24). |

Cada release trae un `SHA256SUMS` para comprobar la descarga. Los instaladores de Windows se firman a partir de la primera versión firmada con SignPath (ver más abajo); en las anteriores Windows puede avisar de «editor desconocido»: comprueba el `SHA256SUMS` (el manual explica cómo). / Installers are signed from the first release signed through SignPath; earlier ones may trigger Windows' "unknown publisher" warning: check the `SHA256SUMS`.

## Compilar desde el código / Build from source

Necesitas Node.js 24 y, para el plugin y la ventana de Windows, el SDK de .NET 9.

```bash
npm ci
npm run typecheck
npm test
npm run build            # la web, en packages/web/dist
npm run dev              # servidor (8420) + web con recarga (5173)
npm run sim              # simulador de AssettoServer (no hace falta tener Assetto Corsa)
```

El instalador de Windows y el paquete de Linux se construyen en GitHub Actions (`.github/workflows/release.yml`) a partir de este mismo código; los pasos manuales están en `scripts/package-*.mjs`.

## Estructura

- `packages/server` — servidor de Howler (UDP con AssettoServer, base de datos SQLite, API, panel).
- `packages/web` — web pública y panel (React + Vite).
- `packages/shared` — tipos y utilidades comunes (protocolo, reglas, campeonatos, idiomas).
- `packages/simulator` — finge ser un AssettoServer para probar sin el juego.
- `packages/installer` — instalador de Windows y preparador de servidor para Linux.
- `plugin/HowlerPlugin` — plugin de AssettoServer (C#, AGPL-3.0): sectores exactos y órdenes del panel.
- `window/HowlerWindow` — ventana propia del panel en Windows (WinForms + WebView2).

## Licencia / License

[AGPL-3.0](LICENSE), con un permiso adicional para módulos, temas y disposiciones de terceros y la reserva del nombre y el logo (resumen en [LICENSE-NOTES.txt](LICENSE-NOTES.txt)). El nombre y el logo de Howler están reservados ([política de marca](docs/TRADEMARK.md)). Los componentes de terceros y sus licencias están en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Política de firma de código / Code signing policy

Los instaladores de Windows de las releases se construyen en GitHub Actions a partir del código de este repositorio y se firman con un certificado proporcionado por la **SignPath Foundation**. Firma de código gratuita proporcionada por [SignPath.io](https://signpath.io), certificado de [SignPath Foundation](https://signpath.org).

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). The Windows installers in the releases are built by GitHub Actions from the code in this repository and signed through SignPath.

**Equipo y funciones / Team roles** — proyecto con un solo mantenedor, que usa verificación en dos pasos en GitHub y en SignPath:

| Función / Role | Persona / Person |
|---|---|
| Autor y revisor de los cambios / Author and reviewer | [ElPatata](https://github.com/Marc0F12) |
| Aprobador de cada firma / Approver of each signing request | [ElPatata](https://github.com/Marc0F12) |

Solo se firman binarios propios (`Howler.exe`, `HowlerWindow.exe` y el instalador `Howler-Setup.exe`) generados por el flujo `release.yml` a partir de una etiqueta `vX.Y.Z`. Cada firma la aprueba el mantenedor a mano. El instalador incluye sin modificar AssettoServer, que es de terceros y mantiene su propia licencia (AGPL-3.0, [código fuente](https://github.com/compujuckel/AssettoServer)).

## Política de privacidad / Privacy policy

Howler **no envía telemetría ni datos de uso a nadie** y no tiene cuentas en ningún servicio. Todo se guarda en tu equipo (carpeta `data/`). Solo se conecta a internet para lo siguiente, y todo es opcional o se puede apagar:

| Qué | A dónde | Cuándo |
|---|---|---|
| Buscar actualizaciones | `api.github.com` (repositorio de Howler) | Al arrancar y cada 6 horas; se apaga en Ajustes → General |
| Fotos de perfil de los pilotos | `steamcommunity.com` (perfil público, sin clave) | Solo desde tu servidor, nunca desde el navegador del visitante; se apaga con `profiles.steamAvatars: false` |
| Avisos a Discord | El *webhook* que tú configures | Solo si lo configuras |
| Leer la ficha de un mod | La web del mod que tú pegues | Solo cuando el administrador lo pide en el asistente de campeonatos |
| Sincronizar con otro Howler (MultiHowler) | La dirección del Howler que tú vincules | Solo si vinculas otro Howler y el otro lado lo aprueba |

El Steam ID de los pilotos no sale nunca por la API ni se muestra. El instalador de Windows modifica los archivos de tu servidor de Assetto Corsa solo si se lo pides, guardando antes una copia de seguridad, y se desinstala desde «Aplicaciones» de Windows (conserva tus datos salvo que marques borrarlos).

Howler sends no telemetry or usage data to anyone and has no accounts on any service. Everything is stored on your machine (`data/` folder). It only goes online for the items in the table above, all optional or switchable off. Players' Steam IDs never leave through the API and are never shown. The Windows installer changes your Assetto Corsa server files only if you ask it to, after making a backup, and it uninstalls from Windows "Apps" (your data is kept unless you tick delete).

## Seguridad / Security

Si encuentras un fallo de seguridad, **no abras una incidencia pública**: avisa en privado al mantenedor (perfil de GitHub o [aviso de seguridad privado](../../security/advisories/new)).
