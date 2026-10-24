# Howler en Linux: guía paso a paso (para quien nunca lo ha hecho)

Esta guía sirve aunque no hayas usado Linux en tu vida. Cada comando va en su propio recuadro: **cópialo entero y pégalo en el terminal** (en la mayoría de terminales se pega con `Ctrl+Shift+V`). Si algo falla, ve a [Si algo falla](#si-algo-falla): están los errores más probables con su solución.

> **Aviso honesto:** el instalador de Linux está comprobado con pruebas automáticas en Ubuntu, pero todavía no con un servidor de Assetto Corsa real y jugadores. Si algo no funciona como aquí se cuenta, es un fallo nuestro, no tuyo: copia la información que pide el apartado [Pedir ayuda](#pedir-ayuda) y avísanos.

---

## 1. Qué es esto y qué necesitas

**Howler** guarda los tiempos y estadísticas de tu servidor de Assetto Corsa y te da una web y un panel de control. En Linux se instala con un asistente que hace casi todo por ti.

Necesitas:

| Cosa | Para qué | Cómo saber si la tienes |
|---|---|---|
| Un equipo con **Linux** (Ubuntu, Debian, Fedora, Mint, Arch…) de **64 bits** | Donde vivirá Howler | Mira el apartado 2 |
| **Conexión a internet** durante la instalación | Para descargar Node.js y AssettoServer (unos 80 MB) | — |
| **El contenido de Assetto Corsa** (coches y circuitos) | AssettoServer los necesita para funcionar | Si juegas a AC en ese mismo Linux con Steam, ya lo tienes. Si es un servidor remoto (VPS), hay que copiarlo (apartado 6) |

**No** necesitas saber programar, ni instalar Node.js, ni .NET: el asistente se ocupa.

---

## 2. Antes de empezar: dos comprobaciones

Abre un **terminal** (en Ubuntu: `Ctrl+Alt+T`; en otros escritorios, busca «Terminal» en el menú de aplicaciones).

**¿Mi equipo es de 64 bits?**
```bash
uname -m
```
- Si dice `x86_64` o `aarch64`: perfecto.
- Si dice `i686`, `armv7l` u otra cosa: **no** funcionará (AssettoServer solo existe para 64 bits).

**¿Tengo lo básico para descargar?**
```bash
curl --version
```
- Si sale una versión, bien.
- Si dice «command not found», instálalo (pide tu contraseña de usuario):
  - Ubuntu / Debian / Mint: `sudo apt update && sudo apt install -y curl`
  - Fedora: `sudo dnf install -y curl`
  - Arch: `sudo pacman -S curl`

---

## 3. Instalación con doble clic (la forma fácil)

1. En un navegador, entra en https://github.com/Marc0F12/Howler/releases y descarga el archivo **`Howler-<versión>-linux.tar.gz`** de la versión más reciente.
2. Ve a la carpeta de Descargas, **clic derecho sobre el archivo → «Extraer aquí»**. Aparece una carpeta llamada `howler`.
3. Muévela a un sitio **fijo** donde no la borres sin querer (por ejemplo, tu carpeta personal). Howler guardará ahí su configuración y sus datos.
4. Entra en la carpeta `howler` y haz **doble clic en «Instalar Howler»**.
   - Si tu gestor de archivos pregunta qué hacer, elige **«Ejecutar»** o **«Confiar y ejecutar»**.
   - Se abre una ventana negra (el terminal) con el asistente.
5. **Responde pulsando Intro a todo.** Lo que se propone entre corchetes, por ejemplo `[1]` o `[s]`, suele ser lo correcto. El asistente hace esto:
   - Descarga Node.js dentro de la carpeta de Howler si hace falta (tarda un minuto; no necesita contraseña de administrador).
   - Busca un servidor de AssettoServer que ya tengas. Si no encuentra ninguno, te ofrece **crear uno nuevo** (si tienes Assetto Corsa instalado) o indicar la carpeta de uno que ya tengas.
   - Prepara el plugin de Howler y los archivos del servidor (guarda una copia de lo que cambia, con el final `.howler-prev`).
   - Pregunta si quieres que Howler **arranque solo cuando enciendas el equipo**. Te recomendamos que sí.
6. Al final verás «¡Listo!» con las direcciones.

**Para abrirlo otro día:** doble clic en **«Iniciar Howler»** (si dijiste que sí al arranque automático, ya está encendido y no hace falta).

### Si el doble clic no hace nada

Algunos escritorios no ejecutan ese tipo de archivos. Usa el terminal, es lo mismo:

```bash
cd ~/howler
bash install.sh
```
(Cambia `~/howler` por la carpeta donde pusiste Howler.) Para arrancarlo después:
```bash
cd ~/howler
bash start.sh
```

---

## 4. Abrir Howler

| Qué | Dirección | Quién puede verla |
|---|---|---|
| **Web** (tiempos, récords, campeonatos) | `http://127.0.0.1:8420` en el propio equipo, o `http://IP-DEL-EQUIPO:8420` desde otros | Cualquiera que llegue a ese puerto |
| **Panel de control** (arrancar el servidor, ajustes…) | `http://127.0.0.1:8421` | **Solo desde el propio equipo**, por seguridad |

Para saber la **IP del equipo** en tu red:
```bash
hostname -I
```
Usa el primer número que salga (algo como `192.168.1.35`).

---

## 5. Servidor remoto (VPS) o equipo sin pantalla

Si tu Linux no tiene escritorio (lo normal en un VPS), no hay doble clic ni navegador en esa máquina. Todo se hace por **SSH** desde tu PC.

### 5.1 Conectarte
Desde tu PC (en Windows, abre PowerShell; en Mac/Linux, el terminal):
```bash
ssh TU_USUARIO@IP_DEL_SERVIDOR
```
La primera vez pregunta si confías en el servidor: escribe `yes`. Luego te pide la contraseña.

### 5.2 Descargar e instalar
Ya dentro del servidor (cambia `0.1.6` por la versión que quieras):
```bash
cd ~
curl -fL -o howler.tar.gz https://github.com/Marc0F12/Howler/releases/download/v0.1.6/Howler-0.1.6-linux.tar.gz
tar -xzf howler.tar.gz
cd howler
bash install.sh
```
El asistente es el mismo que el del doble clic: pulsa Intro a todo. Si dices que sí a «arrancar con el equipo», Howler queda funcionando solo.

### 5.3 Abrir el panel desde tu PC (túnel SSH)
El panel solo escucha dentro del servidor. Para verlo desde tu PC, abre **otro** terminal en tu PC y deja esto corriendo:
```bash
ssh -L 8421:127.0.0.1:8421 TU_USUARIO@IP_DEL_SERVIDOR
```
Mientras esa ventana esté abierta, entra en `http://127.0.0.1:8421` con el navegador de tu PC y verás el panel.

> Alternativa sin túnel: en el panel, **Ajustes → Cuentas**, crea un usuario y contraseña y activa el acceso remoto. Léete antes lo que avisa el panel sobre usarlo con https.

### 5.4 Abrir puertos (cortafuegos)
Para que tus pilotos vean la web y puedan jugar, estos puertos deben estar abiertos **en el servidor y en el panel de tu proveedor** (en muchos VPS hay un cortafuegos aparte en su web, a veces llamado «Security group» o «Firewall»):

| Puerto | Tipo | Para qué |
|---|---|---|
| 9600 | TCP **y** UDP | El juego (si usas otro puerto, ese) |
| 8081 | TCP | HTTP de AssettoServer (lista de servidores, Content Manager) |
| 8420 | TCP | La web de Howler |

**No abras** el 8421 (panel) ni los 11000, 12000, 12001 y 12002 (comunicación interna).

Si usas `ufw` (Ubuntu / Debian):
```bash
sudo ufw allow 9600/tcp
sudo ufw allow 9600/udp
sudo ufw allow 8081/tcp
sudo ufw allow 8420/tcp
sudo ufw status
```
> Si `ufw status` dice «inactive», el cortafuegos del sistema está apagado y no hace falta abrir nada ahí (pero sí en el panel de tu proveedor, si lo tiene).

Si usas `firewalld` (Fedora, CentOS):
```bash
sudo firewall-cmd --permanent --add-port=9600/tcp --add-port=9600/udp --add-port=8081/tcp --add-port=8420/tcp
sudo firewall-cmd --reload
```

---

## 6. El contenido de Assetto Corsa (coches y circuitos)

AssettoServer necesita los coches y circuitos para funcionar. De dónde salen depende de tu caso.

**Caso A: juegas a AC en ese mismo Linux con Steam.** El asistente lo encuentra solo y crea el servidor sin que hagas nada más.

**Caso B: el Linux es un servidor remoto (sin Assetto Corsa).** Tienes que copiar un mínimo del contenido desde un PC con Windows que tenga el juego. Se trata de montar una carpeta `ac` con esta forma:

```
ac/
  content/cars/...      (los coches que quieras usar)
  content/tracks/...    (los circuitos que quieras usar)
  system/data/...       (la carpeta «data» de assettocorsa/server/system, o de assettocorsa/system)
```

1. **Prepara la carpeta en tu PC** copiando desde tu instalación de Assetto Corsa (`...\steamapps\common\assettocorsa`): la carpeta `content` entera (o solo los coches y circuitos que vayas a usar) y la carpeta `data` que está en `server\system\data`, que debe quedar como `ac\system\data`.
2. **Súbela al servidor.** Desde PowerShell en tu PC:
   ```powershell
   scp -r "C:\ruta\a\ac" TU_USUARIO@IP_DEL_SERVIDOR:~/ac
   ```
   (Con un programa con ventanas como WinSCP o FileZilla es más cómodo para carpetas grandes.)
3. **Ejecuta el asistente** en el servidor y elige **«Crear un servidor nuevo para mí»**; cuando pregunte por la carpeta de Assetto Corsa, escribe `/home/TU_USUARIO/ac`:
   ```bash
   cd ~/howler
   bash install.sh
   ```
   Crea un servidor de prueba (un circuito y un coche que existan) en `~/howler/server`.
4. **Pon tu configuración real.** Copia a `~/howler/server/presets/SERVER_00/` los archivos `server_cfg.ini`, `entry_list.ini` y `extra_cfg.yml` de tu servidor de Windows (por ejemplo con `scp`), vuelve a ejecutar `bash install.sh` (elige «Usar el servidor que ya tienes») para que reaplique el plugin, y reinicia el servidor desde el panel. También puedes ajustar casi todo directamente desde el panel (**Preparar → Sesión**, **Circuito y coches**).

> **Linux distingue mayúsculas de minúsculas** y Windows no. Una carpeta `Content/Cars` no es lo mismo que `content/cars`. Si algo «no se encuentra», comprueba que los nombres de las carpetas estén **en minúsculas** tal y como se indican aquí.

---

## 7. Cómo comprobar que funciona

1. **Howler está vivo:**
   ```bash
   curl -s http://127.0.0.1:8420/api/status
   ```
   Tiene que devolver un texto con llaves `{...}`. Si dice «Connection refused», Howler no está en marcha (mira [Si algo falla](#si-algo-falla)).
2. **El panel responde:** abre `http://127.0.0.1:8421`. Debe verse el panel.
3. **Arranca el servidor de AC:** en el panel, **Servidor → Estado y consola → Arrancar**. En la consola tienen que salir líneas; el indicador pasa a verde cuando el servidor está listo.
4. **Entra a jugar** y da una vuelta: en la web, en «Tiempos», debe aparecer tu tiempo.

Si usas el servicio automático, estas dos órdenes cuentan cómo va (usa la que corresponda a lo que te dijo el asistente al final):
```bash
systemctl --user status howler
```
```bash
sudo systemctl status howler
```

---

## 8. Día a día

Si instalaste Howler como servicio (arranque automático), estas órdenes controlan Howler. Si el asistente dijo «servicio **de tu usuario**», usa la versión con `--user` (sin `sudo`); si dijo «servicio **del sistema**», usa `sudo systemctl`.

| Quiero… | Servicio de tu usuario | Servicio del sistema |
|---|---|---|
| Ver si está encendido | `systemctl --user status howler` | `sudo systemctl status howler` |
| Pararlo | `systemctl --user stop howler` | `sudo systemctl stop howler` |
| Encenderlo | `systemctl --user start howler` | `sudo systemctl start howler` |
| Reiniciarlo | `systemctl --user restart howler` | `sudo systemctl restart howler` |
| Ver lo que escribe (registro) | `journalctl --user -u howler -f` | `sudo journalctl -u howler -f` |

(Para salir del registro, `Ctrl+C`.)

Sin servicio: arráncalo con `bash start.sh` dentro de la carpeta de Howler y páralo con `Ctrl+C` en esa ventana. **Si cierras el terminal, se apaga.**

### Actualizar a una versión nueva
1. Descarga la versión nueva (apartado 3 o 5.2).
2. Descomprímela **encima de la misma carpeta** (si te pregunta, «reemplazar»). Tu configuración (`howler.config.json`) y tus datos (carpeta `data`) no se tocan.
3. Vuelve a ejecutar el asistente (`bash install.sh`) y reinicia Howler.

Antes de actualizar, puedes hacer una copia de seguridad desde el panel (**Ajustes → Sistema → Copias y exportar**).

### Desinstalar
```bash
systemctl --user disable --now howler 2>/dev/null; sudo systemctl disable --now howler 2>/dev/null
rm -f ~/.config/systemd/user/howler.service
sudo rm -f /etc/systemd/system/howler.service
```
Luego borra la carpeta `howler`. Los archivos de tu servidor de AC llevan copias `.howler-prev` de lo que Howler cambió, por si quieres deshacerlo; también se puede quitar el plugin borrando `plugins/HowlerPlugin` dentro de la carpeta del servidor.

---

## Si algo falla

Busca tu síntoma. Si no está, ve a [Pedir ayuda](#pedir-ayuda).

### El doble clic no hace nada, o se abre un editor de texto
Tu escritorio no ejecuta ese tipo de archivos. Abre un terminal y escribe `cd ~/howler` y después `bash install.sh` (cambia la ruta si pusiste Howler en otro sitio).
Si prefieres arreglar el doble clic: clic derecho sobre «Instalar Howler» → **Propiedades → Permisos → «Permitir ejecutar como programa»** (el nombre exacto depende del escritorio). En GNOME, además, clic derecho → **«Permitir lanzar»**.

### `Permission denied` al ejecutar `./install.sh`
Escríbelo con `bash` delante, así no hace falta permiso especial:
```bash
bash install.sh
```

### `command not found: bash` / `sh: bash: not found`
Estás en un sistema muy mínimo (por ejemplo Alpine). Instala bash: `apk add bash`. El resto de la guía no está pensado para Alpine; usa Ubuntu, Debian o Fedora.

### «Necesito curl o wget para descargar Node.js»
Instala uno (apartado 2): `sudo apt install -y curl`.

### «La descarga de Node.js no coincide con su suma de comprobación»
La descarga llegó corrupta o alguien la alteró por el camino. Lo borramos por seguridad. Vuelve a intentarlo:
```bash
rm -rf ~/howler/runtime
cd ~/howler && bash install.sh
```
Si pasa siempre, mira si tu red usa un proxy o filtro que modifica las descargas. Alternativa: instala tú Node.js 24 o superior (https://nodejs.org) y vuelve a ejecutar el asistente; usará el tuyo.

### «No se pudo descargar» / se queda parado descargando
Sin internet o con un cortafuegos que bloquea GitHub o nodejs.org. Prueba:
```bash
curl -I https://github.com
curl -I https://nodejs.org
```
Si alguno falla, el problema es de tu red, no de Howler. En un VPS, comprueba que el DNS funciona (`ping -c 2 8.8.8.8` y `ping -c 2 google.com`).

### «Procesador no soportado»
Tu equipo no es de 64 bits (apartado 2). No hay solución: AssettoServer solo existe para `x86_64` y `aarch64`.

### «La descarga de AssettoServer no coincide con su suma de comprobación»
Igual que lo de Node: se descartó por seguridad. Reintenta; si se repite, revisa tu conexión.

### `tar: command not found` o `Cannot open: No such file`
Falta `tar` (instálalo: `sudo apt install -y tar`) o estás en la carpeta equivocada. Comprueba dónde está el archivo con `ls ~/Descargas` o `ls ~/Downloads` (según el idioma del sistema) y usa esa ruta.

### «La carpeta no existe» al indicar el servidor
Escribe la ruta **completa y sin errores**. Para ver el contenido de una carpeta: `ls /ruta`. Recuerda que Linux distingue mayúsculas: `Servidor` ≠ `servidor`. Una ruta con espacios hay que escribirla tal cual en el asistente (no hace falta ponerle comillas ahí).

### «Howler necesita AssettoServer v0.0.55-pre35, no el acServer antiguo»
La carpeta que indicaste tiene el servidor antiguo (`acServer`). Howler necesita **AssettoServer**. Deja que el asistente cree un servidor nuevo, o descarga `assetto-server-linux-x64.tar.gz` de https://github.com/compujuckel/AssettoServer/releases/tag/v0.0.55-pre35 y descomprímelo dentro de tu carpeta del servidor.

### «No encuentro ningún coche/circuito en la instalación de Assetto Corsa»
La carpeta de Assetto Corsa que indicaste no tiene `content/cars` o `content/tracks`. En Steam suele ser `~/.steam/steam/steamapps/common/assettocorsa` o `~/.local/share/Steam/steamapps/common/assettocorsa`. Comprueba:
```bash
ls ~/.steam/steam/steamapps/common/assettocorsa/content
```
Si el juego está en otro disco, busca la ruta en Steam (clic derecho en el juego → Administrar → Ver archivos locales).

### El asistente no encuentra mi Assetto Corsa de Steam
Si lo tienes instalado en otra biblioteca de Steam, indícalo a mano: en el asistente elige «Crear un servidor nuevo» y, cuando pregunte, escribe la ruta de la carpeta `assettocorsa`.

### Howler no arranca: «Falta Node» o «node: command not found» con `start.sh`
`start.sh` usa el Node de la carpeta `runtime` si existe; si no, el del sistema. Vuelve a ejecutar `bash install.sh` para que lo descargue.

### «Address already in use» / el puerto 8420 (u otro) está ocupado
Otro programa (o otro Howler) usa el puerto. Mira cuál:
```bash
ss -tlnp | grep -E '8420|8421'
```
Para el que sea (si es un Howler viejo: `systemctl --user stop howler` o `pkill -f howler.mjs`) y arranca de nuevo. También puedes cambiar el puerto en `howler.config.json` (campo `http.port`).

### La web abre en el propio equipo, pero no desde otro
Es casi siempre el cortafuegos:
1. ¿El puerto 8420 está abierto en el equipo? (apartado 5.4)
2. ¿Y en el panel de tu proveedor (VPS) o en tu **router** (si está en casa y quieres que entren desde internet: «reenvío de puertos», `8420` → IP del equipo)?
3. Prueba desde otro equipo de **la misma red**: `http://IP-LOCAL:8420`. Si eso funciona y desde internet no, es el router o el proveedor.

### El panel (puerto 8421) no abre desde otro equipo
Es normal: **solo escucha en el propio equipo** a propósito. Usa el túnel SSH (apartado 5.3) o las cuentas del panel remoto.

### El servidor de AC no arranca desde el panel
Mira la consola del panel (**Servidor → Estado y consola**): Howler traduce los errores más habituales y muchas veces ofrece un botón para arreglarlo con un clic. Los más comunes:
- **«No track params found»**: el circuito no tiene datos de zona horaria. El panel ofrece «Permitir» o ajustarlo.
- **Faltan archivos de un coche (`data.acd`)**: igual, el panel lo explica y lo arregla.
- **«Permission denied» al lanzar `AssettoServer`**: falta el permiso de ejecución. Dáselo:
  ```bash
  chmod +x ~/howler/server/AssettoServer
  ```
  (cambia la ruta por la de tu servidor).
- **«cannot execute: required file not found»** / error de librerías: tu Linux es de 32 bits o muy raro (apartado 2).
- **Error de «ICU» o «libicu»**: arranca el servidor con esta variable puesta. Si usas el servicio, añade en `~/.config/systemd/user/howler.service`, dentro de `[Service]`, la línea `Environment=DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` y luego `systemctl --user daemon-reload && systemctl --user restart howler`.
- **«No such file or directory» con rutas que parecen bien**: las mayúsculas (ver más arriba, apartado 6).

### El servidor de AC arranca pero Howler no registra vueltas
Comprueba que el plugin está activo: en el panel, **Servidor → Estado**, el indicador del plugin debe estar vivo. Si no:
1. Vuelve a ejecutar `bash install.sh` (reaplica el plugin y la configuración).
2. Reinicia el servidor de AC **desde el panel** (el plugin solo se carga al arrancar).
3. Comprueba que en `presets/SERVER_00/server_cfg.ini` hay `UDP_PLUGIN_ADDRESS=127.0.0.1:12000` y `UDP_PLUGIN_LOCAL_PORT=11000`.

### Howler no arranca solo después de reiniciar el equipo
- Si el servicio es **de tu usuario**, solo arranca al **iniciar tu sesión**, a no ser que actives esto (una vez, pide contraseña):
  ```bash
  sudo loginctl enable-linger $USER
  ```
- Comprueba que está activado: `systemctl --user is-enabled howler` debe decir `enabled`.
- En sistemas sin systemd (WSL antiguo, contenedores, Alpine) no hay servicio: usa `bash start.sh`, o Docker (apartado siguiente).

### `Failed to connect to bus` al usar `systemctl --user`
Estás conectado por SSH sin sesión «completa». Prueba:
```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status howler
```
Si lo necesitas siempre, instálalo como servicio **del sistema**: ejecuta el asistente con `sudo bash install.sh`.

### «Read-only file system» o «noexec» al ejecutar
Has puesto Howler en un disco montado sin permiso de ejecución (por ejemplo un USB o `/tmp`). Muévelo a tu carpeta personal (`~/howler`).

### SELinux (Fedora, CentOS, RHEL) bloquea el servicio
Síntoma: el servicio falla con «permission denied» aunque los permisos estén bien. Mira `sudo journalctl -xe | grep -i avc`. Si lo ves, la solución cómoda para probar es ejecutar Howler con `bash start.sh` (sin servicio) y, para un uso permanente, pedir ayuda (apartado siguiente) con ese mensaje.

### Me quedé sin espacio en disco
Howler guarda su base de datos y copias en la carpeta `data`; el servidor de AC y su contenido pueden ocupar varios GB. Comprueba el espacio con `df -h ~` y el de la carpeta con `du -sh ~/howler/*`.

### Quiero ver todo lo que pasa
```bash
journalctl --user -u howler -n 100 --no-pager
```
(o `sudo journalctl -u howler -n 100 --no-pager` si es un servicio del sistema). Sin servicio, verás el mismo texto en la ventana donde lanzaste `bash start.sh`.

---

## Docker (opcional)

Si ya usas Docker, hay una imagen con todo dentro en la carpeta `docker/` del repositorio. Los pasos están en [`LINUX.md`](LINUX.md#docker). Aviso: esa parte aún no se ha probado con Docker real.

---

## Pedir ayuda

Si no encuentras tu problema, cuéntalo con **esta información** (cópiala y pégala en tu mensaje; nada de lo que sale es secreto salvo que pegues tus contraseñas, no lo hagas):

```bash
uname -a
cat /etc/os-release | head -3
ls ~/howler
journalctl --user -u howler -n 60 --no-pager
```
y di **qué hacías** cuando falló y **qué mensaje exacto** salió. Puedes abrir una incidencia en https://github.com/Marc0F12/Howler/issues.
