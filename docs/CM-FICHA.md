# Cómo dibuja Content Manager la ficha de un servidor

Referencia para la pestaña «Ficha del servidor» de Howler. **Todo sale del código fuente de CM**
(<https://github.com/gro-ove/actools>, rama `master`, leído el 2026-10-17), no de suposiciones. Si CM cambia, rehacer la lectura.

## De dónde sale cada dato
| Lo que ve el jugador | De dónde lo saca CM | Archivo de CM |
|---|---|---|
| Título (lista) | `NAME` de `[SERVER]` + « ℹ<puerto>» que añade AssettoServer. CM quita el sufijo, pasa tabuladores a espacios y **colapsa los espacios repetidos**. | `ServerEntry.Utils.cs` (`CleanUp`) |
| Título (lista) se dibuja con | `BbCodeBlock Mode="WithoutBbCodes"`: los corchetes se ven tal cual. | `OnlineServer.xaml` línea 35 |
| Título (cabecera de la ficha) | `SelectableBbCodeBlock` en modo completo: **interpreta BBCode, enlaza URLs y convierte emojis**. Un `[EU]` en el título desaparece aquí. | `OnlineServer.xaml` línea 206 |
| Descripción | `ServerDescription` del `extra_cfg.yml`, que AssettoServer manda tal cual en `/api/details` (`Description`) y CM asigna sin tocarlo. Solo se enseña con `EnableServerDetails: true`. | `ServerEntry.Extended.cs` línea 217; `HttpController.cs` de AssettoServer |
| Descripción se dibuja con | `BbCodeBlock Text=… Margin="0 20 0 0" TextWrapping="Wrap" AllowImages=<ajuste del jugador>` | `OnlineServer.xaml` línea 545 |
| Ajuste de imágenes | `Settings.OnlineSettings.LoadDescriptionImages`, **activado de serie** pero cada jugador puede quitarlo («Load images in server descriptions»). | `SettingsHolder.Online.cs` |
| Letra | Segoe UI, **13 px** (12 px con «Small font»). | `Fonts.xaml`, `AppearanceManager.cs` |

## Etiquetas que entiende CM (`BbCodeParser.cs`, `BbCodeLexer.cs`)
`[b] [i] [u] [s] [mono] [sup] [color=…] [size=píxeles] [url=enlace]texto[/url] [img=dirección|tamaño]texto[/img] [ico=…] [br]`

- **Distingue mayúsculas.** Cualquier etiqueta que no conozca (`[center]`, `[PRO]`, `[B]`…) **se traga**: desaparece y queda su texto. No existe `[center]`.
- `\[` escribe un `[` literal. Un `]` suelto es texto.
- `[br]` (en cualquier mayúscula) y cada salto de línea son un salto de línea.
- El valor de una etiqueta va entre comillas o sin ellas; **sin comillas termina en el primer espacio**.
- `[color=…]`: cualquier valor que acepte `ColorConverter` de WPF (`#rgb`, `#rrggbb`, nombres como `red`).
- `[size=N]`: **píxeles** (no una escala 1–7).
- **Imagen:** `[img=URL|N]texto[/img]`. La dirección va **en la etiqueta**; `|N` es el tamaño máximo (ancho **y** alto). **Hace falta texto dentro** (es la ayuda al pasar el ratón) o no se dibuja. `[img]URL[/img]` NO funciona (CM enseña la dirección como texto). Sin `|N`: tamaño natural y no reacciona al pulsarla. **Con `|N` la imagen es «ampliable»** (mano y visor al pulsarla). Dentro de `[url]` es un enlace. Los emojis los convierte CM en imágenes `emoji://`.
- **URLs sueltas** (`https://…`, `discord.gg/abc`) se convierten solas en enlaces (`HighlightUrls`, `UrlHelper.IsWebUrl`): no si van justo detrás de una letra, `=`, `.`, `/`, comillas…; no hace falta `[url]`.
- Cada etiqueta de cierre no se comprueba contra una pila: `[/b]` apaga la negrita aunque estuviera anidada.

## Qué hace Howler con esto
- `packages/shared/src/server-sheet.ts` es la implementación: `cleanBbcode` (lo que se guarda: etiquetas conocidas limpias, lo que CM ignoraría se conserva tal cual, `[center]` se quita, formatos antiguos de Howler se convierten), `bbcodeToHtml` (cómo lo dibuja CM, para editor y vista previa), `normalizeImageUrl`/`imageUrlWarning`.
- El editor escapa como `\[` cualquier corchete escrito a mano para que CM no se lo trague.
- `packages/server/src/admin/server-sheet.test.ts` tiene un test por cada regla de arriba.

## Lo que NO se pudo comprobar (necesita CM real)
- El aspecto exacto (márgenes, anchos); la vista previa imita la estructura del XAML, no cada píxel.
- Que los emojis del título se vean como en la vista previa (CM los dibuja como imágenes).
- Qué pasa con una imagen más ancha que la columna (el parser no la limita; la vista previa la reduce al ancho disponible).
