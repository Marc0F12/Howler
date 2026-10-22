# Howler en Linux o en un VPS

Estado: **comprobado en Linux (Ubuntu) con GitHub Actions** (`.github/workflows/linux.yml`, 2026-10-20): los tests, la compilación de la web, el arranque de Howler, el panel (lectura y escritura de los ajustes de sesión), el arranque y la parada de un «servidor de AC» falso desde el panel, la detección con `pgrep`, el simulador registrando vueltas y la compilación de `HowlerPlugin` con .NET 9 pasan en Linux. **No comprobado:** AssettoServer real en Linux con jugadores, `xdg-open` en un escritorio, el servicio de systemd y el túnel SSH de esta guía.

## Instalación rápida (paquete de Linux)
Descarga `Howler-<versión>-linux.tar.gz` de la última release (https://github.com/Marc0F12/Howler/releases), y con Node 24 instalado:
```bash
tar -xzf Howler-*-linux.tar.gz && cd howler
bash install.sh --server /ruta/a/tu/servidor     # copia el plugin, prepara el servidor y crea howler.config.json
bash start.sh                                    # arranca Howler
```
Con `--service` además lo deja como servicio de systemd (de tu usuario, o del sistema si lo ejecutas como root). Para actualizar, descomprime la versión nueva sobre la misma carpeta y repite `install.sh`: `howler.config.json` y `data/` no se tocan. El paquete ya lleva el plugin compilado, así que no hace falta .NET.

Lo que sigue explica cada paso a mano, por si prefieres hacerlo tú o instalar desde el código.

## Qué necesitas
| Pieza | Para qué | Notas |
|---|---|---|
| **Node.js 24** | Howler (usa `node:sqlite`, incluido; no hay dependencias nativas) | `node --version` debe decir 24 o más |
| **AssettoServer v0.0.55-pre35 para Linux** | El servidor de AC | Descarga `assetto-server-linux-x64` de https://github.com/compujuckel/AssettoServer/releases/tag/v0.0.55-pre35 |
| **El contenido de Assetto Corsa** | Coches y circuitos | Un VPS no lo trae. Copia `content/cars`, `content/tracks` y `system/data` desde un Windows con el juego |
| **.NET 9 SDK** | Solo para compilar `HowlerPlugin` | El plugin hay que compilarlo en Linux o copiar el ya compilado (`plugin/dist/HowlerPlugin/`) |

El contenido de los mods de pago o con licencia no se puede repartir: cada quien aporta el suyo.

## Pasos
1. **Instalar Howler.** Descarga el código de Howler y, dentro de la carpeta:
   ```bash
   npm ci
   npm run build
   ```
2. **Preparar el servidor.** Descomprime AssettoServer en una carpeta (por ejemplo `~/ac/server`), copia ahí `content/` y `system/` y haz el binario ejecutable:
   ```bash
   chmod +x ~/ac/server/AssettoServer
   ```
3. **Instalar el plugin.** Copia `HowlerPlugin.dll` (y su `.deps.json`) a `~/ac/server/plugins/HowlerPlugin/`. En `extra_cfg.yml` del preset pon `EnablePlugins: [HowlerPlugin]` y `EnableLegacyPluginInterface: true`, y en `server_cfg.ini` `UDP_PLUGIN_ADDRESS=127.0.0.1:12000` y `UDP_PLUGIN_LOCAL_PORT=11000`.
4. **Configurar Howler.** Copia `howler.config.example.json` a `howler.config.json` y pon en `serverDir` la carpeta del servidor (`/home/usuario/ac/server`). En Linux el ejecutable por defecto es `AssettoServer`.
5. **Arrancar.**
   ```bash
   npm start
   ```

## Abrir el panel desde tu PC
El panel solo escucha en `127.0.0.1:8421` por seguridad. En un VPS ábrelo con un túnel SSH, desde tu PC:
```bash
ssh -L 8421:127.0.0.1:8421 usuario@tu-servidor
```
y entra en `http://127.0.0.1:8421`. La web pública (puerto 8420) se ve desde cualquier sitio si el puerto está abierto.

## Puertos que hay que abrir en el cortafuegos del VPS
| Puerto | Protocolo | Para qué |
|---|---|---|
| 9600 (o el que uses) | TCP y UDP | El juego |
| 8081 (o el que uses) | TCP | HTTP de AssettoServer |
| 8420 | TCP | Web pública de Howler |

No abras el 8421 (panel) ni el 11000/12000/12001/12002 (comunicación interna).

## Dejarlo siempre encendido (systemd)
Archivo `/etc/systemd/system/howler.service`:
```ini
[Unit]
Description=Howler
After=network-online.target

[Service]
Type=simple
User=usuario
WorkingDirectory=/home/usuario/howler
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Después:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now howler
journalctl -u howler -f
```
Howler arranca y para el servidor de AC por ti (con aviso a los jugadores), así que un solo servicio basta.

## Qué cambia respecto a Windows
- No hay instalador ni `Howler.exe`: se ejecuta desde el código con Node.
- «Abrir la web» y «Conectar» del panel intentan usar `xdg-open`; en un servidor sin escritorio no hacen nada (copia el enlace a mano).
- La actualización automática desde el panel no está disponible: se actualiza bajando la versión nueva y reiniciando.
- La detección de «servidor en marcha fuera de Howler» usa `pgrep`.
- El selector de setups fijos lee `Documentos/Assetto Corsa/setups`, que en un VPS no existe: copia a mano los `.ini` a la carpeta `setups/` del servidor.

## Docker
No hay imagen de Docker todavía. Docker sería una «caja» con Howler, Node y AssettoServer ya preparados para arrancar con un solo comando; solo ayuda a quien tiene un VPS y no es necesario para usar Howler en Linux.
