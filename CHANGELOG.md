# Cambios · Changelog

Cada versión agrupa sus cambios en **Novedades**, **Mejoras**, **Arreglos** y **Diseño**, con una línea por cambio. El texto de cada versión es el que sale en el aviso de actualización del panel.

## 0.1.5

<!-- lang:es -->
### Novedades
- Panel de sesión completo: ajustes de combustible, daños, neumáticos, ayudas, reglas de carrera, sesiones y más, con presets y setups fijos.
- Eventos programados: a una hora (una vez o cada semana) aplica un preset, cambia circuito y coches y arranca el servidor, con avisos por el chat y por Discord y parada automática. Atajos para un fin de semana de carrera y para una carrera de un campeonato.
- Cuentas del panel: usuario y contraseña creados desde Ajustes → Cuentas para abrir el panel desde otros equipos, con roles de administrador, moderador y solo ver.
- Howler funciona en Linux (servidor, panel y plugin).
- Ventana propia para el panel, con el nombre e icono de Howler y los colores del tema, en lugar de la de Edge.
- Límites contra abusos en la web pública.

### Mejoras
- La actualización automática espera a que se cierre la ventana vieja, comprueba que Howler arranca y deja un registro (update.log).
- Cabeceras de seguridad en la web y el panel.
- Biblioteca de emblemas propia para las insignias de campeonato.

### Arreglos
- Con un túnel hacia el panel, ya no se entra sin contraseña.
- Guardar las sesiones en un server_cfg.ini escrito por Content Manager podía duplicar una clave y dejar el servidor sin arrancar.

<!-- lang:en -->
### New
- Full session panel: fuel, damage, tyres, assists, race rules, sessions and more, with presets and fixed setups.
- Scheduled events: at a set time (once or weekly) it applies a preset, changes track and cars and starts the server, with chat and Discord announcements and automatic stop. Shortcuts for a race weekend and for a championship race.
- Panel accounts: usernames and passwords created in Settings → Accounts to open the panel from other computers, with administrator, moderator and view-only roles.
- Howler runs on Linux (server, panel and plugin).
- Own window for the panel, with Howler's name, icon and theme colours, instead of Edge's.
- Abuse limits on the public website.

### Improved
- Automatic update waits for the old window to close, checks that Howler starts and writes a log (update.log).
- Security headers on the website and the panel.
- Own emblem library for championship badges.

### Fixed
- Behind a tunnel to the panel, you can no longer get in without a password.
- Saving sessions in a server_cfg.ini written by Content Manager could duplicate a key and stop the server from starting.

## 0.1.4

<!-- lang:es -->
### Novedades
- Ficha del servidor: edita el título y la descripción que Content Manager enseña de tu servidor, con editor de formato, vista previa como la real y presets guardables.
- Animación de abrir el panel: el mono aúlla y cae la palabra «Howler». Una vez por ventana, se salta con un clic o una tecla.
- El mono de la cabecera late mientras hay sesión en directo y aúlla cuando alguien bate un récord.
- Nueva banda de «NUEVO RÉCORD» con tipografía animada y colores editables en los temas.
- Opción para anular automáticamente las salidas de boxes.
- Ajustes rápidos On/Off/Auto en «Sesión y clima» (WeatherFX, datos del circuito, data.acd).
- Reenvío de la interfaz UDP de AC a otros plugins (penalizaciones...) y trayectorias compartidas entre Howlers vinculados (opcional).
- Telemetría de los jugadores con CSP (freno real, fuerzas g, neumáticos) activa de serie; el instalador la deja puesta.

### Mejoras
- La cabecera y las pestañas del panel se quedan fijas al hacer scroll.
- La consola marca [HOWLER] en ocre.
- El sonido de récord viene en «Sin sonido» (se elige en Ajustes → General).

### Diseño
- Set de iconos propio en las pestañas del panel.
- Icono de la barra de tareas nítido (ICO multitamaño).

<!-- lang:en -->
### New
- Server sheet: edit the title and description Content Manager shows for your server, with a formatting editor, a faithful preview and savable presets.
- Opening animation for the panel: the monkey howls and the word "Howler" drops in. Once per window; click or press a key to skip.
- The header monkey pulses while a session is live and howls when someone sets a record.
- New "NEW RECORD" banner with animated type and theme-editable colours.
- Option to automatically void pit-exit laps.
- Quick On/Off/Auto settings in "Session and weather" (WeatherFX, track data, data.acd).
- Forwarding of AC's UDP interface to other plugins (penalties...) and optional shared lap traces between linked Howlers.
- Telemetry from players with CSP (real brake, g-forces, tyres) is on by default; the installer leaves it on.

### Improved
- The panel header and tabs stay fixed while scrolling.
- The console shows [HOWLER] in ochre.
- The record sound now defaults to "No sound" (choose it under Settings → General).

### Design
- Own icon set on the panel tabs.
- Sharp taskbar icon (multi-size ICO).

## 0.1.3

<!-- lang:es -->
### Novedades
- Si el servidor no arranca, Howler dice la causa real (circuito sin datos de ubicación, puerto en uso, plugin que falta...) y, cuando puede, lo arregla con un clic.
- La consola del servidor sale en colores: avisos en ámbar, errores en rojo.

### Diseño
- Logo e iconos nuevos: Howler.exe, instalador, pestaña del navegador y web.

### Arreglos
- El aviso de «coches sin data.acd» ya no salta por error cuando la consola solo habla de sumas de control.
- Con los temas que ponen el puesto en un cuadrito (Essential, GT), los números de la tabla de mejores tiempos del circuito y de las fichas de piloto salían invisibles.
- Al actualizar, ya no queda abierta la ventana vieja del panel junto a la nueva.

<!-- lang:en -->
### New
- If the server fails to start, Howler names the real cause (track without location data, port in use, missing plugin...) and, where it can, fixes it with one click.
- The server console is now colour-coded: warnings in amber, errors in red.

### Design
- New logo and icons: Howler.exe, installer, browser tab and website.

### Fixed
- The "cars without data.acd" warning no longer fires by mistake when the console merely mentions checksums.
- With themes that show the position in a small box (Essential, GT), the numbers in the track's best-times table and in driver profiles were invisible.
- When updating, the old panel window no longer stays open next to the new one.

## 0.1.2

<!-- lang:es -->
### Novedades
- El aviso de versión nueva enseña lo que trae y tiene dos botones: Actualizar y Ahora no.
- La opción «Crear un servidor nuevo» se ve siempre; sin Assetto Corsa sale apagada y explica por qué, con un botón para buscarlo.
- Los neumáticos de los fantasmas avisan cuando no hay datos de ruedas.

### Mejoras
- El «Patinazo» pasa a llamarse Agarre: 100 % es que no derrapa.
- Howler ya no enseña direcciones IP; el manual explica cómo averiguarlas.

### Arreglos
- Howler acepta un `howler.config.json` guardado con BOM (Notepad lo añade).

<!-- lang:en -->
### New
- The new-version notice shows what it brings and has two buttons: Update and Not now.
- “Create a new server” is always visible; without Assetto Corsa it is greyed out and explains why, with a button to find it.
- The ghosts' tyre panel says so when there is no wheel data.

### Improved
- “Wheel slip” is now called Grip: 100 % means no sliding.
- Howler no longer shows IP addresses; the manual explains how to find them.

### Fixed
- Howler accepts a `howler.config.json` saved with a BOM (Notepad adds one).

## 0.1.1

<!-- lang:es -->
### Novedades
- El instalador puede crear un servidor nuevo si tienes Assetto Corsa y ningún servidor.
- AssettoServer va dentro del instalador: ya no se descarga.
- Dos tipos de instalación: Completa o Sin abrir puertos.
- La pantalla final y Ajustes → General enseñan la dirección de tu web, con botón para copiarla.

### Mejoras
- Sin servidor detectado, el instalador propone la opción adecuada.
- Ya no parpadean ventanas de consola al instalar ni al usar el panel.

### Arreglos
- Los botones «Cerrar» del instalador y del desinstalador ya cierran la ventana.
- La ventana del instalador sale con el logo de Howler en la barra de tareas.

### Diseño
- Las notas de versión se muestran con etiquetas por categoría.

<!-- lang:en -->
### New
- The installer can create a new server if you have Assetto Corsa and no server.
- AssettoServer now ships inside the installer: no download needed.
- Two installation types: Complete or No open ports.
- The final screen and Settings → General show your website address, with a copy button.

### Improved
- With no server detected, the installer suggests the right option.
- Console windows no longer flash during install or when using the panel.

### Fixed
- The installer's and uninstaller's “Close” buttons now close the window.
- The installer window shows the Howler logo in the taskbar.

### Design
- Release notes are shown with category tags.

## 0.1.0

<!-- lang:es -->
### Novedades
- Primera versión pública: tiempos, sectores, récords, comparador de vueltas, campeonatos y panel de control.

<!-- lang:en -->
### New
- First public release: lap times, sectors, records, lap comparer, championships and control panel.
