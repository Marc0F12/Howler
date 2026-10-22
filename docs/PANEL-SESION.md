# Panel de sesión completo (propuesta para la 0.1.5)

Pedido por Marc el 2026-10-19: un panel «super completo y super intuitivo» con **todos los ajustes que existan para la sesión**, los importantes más grandes y a la vista, y que se entienda de un vistazo. Referencia: lo que ofrece ACSM (neumáticos, setups fijos, mantas…).

Las claves de abajo están leídas del **código fuente de AssettoServer pre35** (`vendor/assettoserver-src-pre35`, ficheros `ServerConfiguration.cs`, `SessionConfiguration.cs`, `EntryList.cs`, `DynamicTrackConfiguration.cs`, `WeatherConfiguration.cs`, `CarSetups.cs`) y del `server_cfg.ini` que escribe Content Manager. Lo que no se pudo comprobar así va marcado ⚠.

## Qué controla Howler hoy
Solo combustible, daños y desgaste (`admin/server-config.ts`), más circuito, coches (lista de plazas), descripción y título. **Todo lo demás de abajo es nuevo.** Las plazas ya tienen `FIXED_SETUP` en el parser (`admin/entry-list.ts`) pero no hay forma de elegir el archivo.

## Inventario de ajustes

### Grandes (arriba, en tarjetas)
| Tarjeta | Ajustes |
|---|---|
| **Sesiones** | Práctica, clasificación y carrera: activar o no (CM las desactiva renombrando la sección a `__CM_<NOMBRE>_OFF`), `TIME` (minutos) o `LAPS`, `IS_OPEN` (cerrada / abierta / se cierra al empezar), `WAIT_TIME` (espera de la carrera), `INFINITE` |
| **Condiciones** | `FUEL_RATE`, `DAMAGE_MULTIPLIER`, `TYRE_WEAR_RATE` (ya están), agarre del asfalto: `DYNAMIC_TRACK` (`SESSION_START`, `RANDOMNESS`, `LAP_GAIN`, `SESSION_TRANSFER`) |
| **Ayudas** | `ABS_ALLOWED` y `TC_ALLOWED` (0 prohibido, 1 solo si el coche las trae de fábrica, 2 todos), `STABILITY_ALLOWED`, `AUTOCLUTCH_ALLOWED` |
| **Neumáticos** | `TYRE_BLANKETS_ALLOWED` (mantas térmicas), `ALLOWED_TYRES_OUT` (ruedas fuera de pista antes de contar como corte; -1 = sin límite), `LEGAL_TYRES` (compuestos permitidos, global y por coche) |
| **Reglas de carrera** | `START_RULE` (salida en falso) ⚠ valores exactos, `RACE_GAS_PENALTY_DISABLED`, `RACE_EXTRA_LAP`, `REVERSED_GRID_RACE_POSITIONS` (parrilla invertida: nº de puestos), ventana de boxes `RACE_PIT_WINDOW_START/END`, `MAX_CONTACTS_PER_KM` |
| **Clima y hora** | Ya existe (pestaña «Sesión y clima»); añadir `SUN_ANGLE`, `TIME_OF_DAY_MULT`, y por clima `BASE_TEMPERATURE_AMBIENT/ROAD`, `VARIATION_*`, viento (`WIND_BASE_SPEED_MIN/MAX`, `WIND_BASE_DIRECTION`, `WIND_VARIATION_DIRECTION`) |

### Medios (plegados bajo las tarjetas)
`QUALIFY_MAX_WAIT_PERC`, `RACE_OVER_TIME`, `RESULT_SCREEN_TIME`, `MAX_BALLAST_KG`, `FORCE_VIRTUAL_MIRROR`, `LOOP_MODE`, `PICKUP_MODE_ENABLED`, `MAX_CLIENTS`, `PASSWORD` (ya existe), votaciones (`KICK_QUORUM`, `VOTING_QUORUM`, `VOTE_DURATION`), `BLACKLIST_MODE`, `WELCOME_MESSAGE` (ruta a un archivo de texto).
De `extra_cfg.yml` (AssettoServer): `EnableCarReset`, `EnableSessionVote`, `EnableKickPlayerVote`, `VoteKickMinimumConnectedPlayers`, `EnableGlobalDrs`, `EnableUnlimitedP2P`, `ForceLights`, `MinimumCSPVersion`, `RainTrackGripReductionPercent`, `EnableRealTime`, `LockServerDate`, `EnableAi`.

### Por plaza (ya en «Coches del servidor»)
`MODEL`, `SKIN`, `SPECTATOR_MODE`, `DRIVERNAME`, `TEAM`, `GUID`, `BALLAST`, `RESTRICTOR`, `FIXED_SETUP` (**falta el selector**) y `LEGAL_TYRES` por coche (**falta**).

### Técnicos (escondidos en «Avanzado», con aviso)
Puertos (`UDP_PORT`, `TCP_PORT`, `HTTP_PORT`), `CLIENT_SEND_INTERVAL_HZ`, `NUM_THREADS`, `SEND_BUFFER_SIZE`, `RECV_BUFFER_SIZE`, `REGISTER_TO_LOBBY`, `UDP_PLUGIN_*`, `AUTH_PLUGIN_ADDRESS`. Los `UDP_PLUGIN_*` son de Howler: nunca editables aquí.

## Setups fijos (`FIXED_SETUP`)
- El servidor busca el archivo en la carpeta `setups/` (ruta relativa a la carpeta de configuración) y lo manda al jugador; cada plaza puede llevar el suyo. ⚠ Falta confirmar la carpeta exacta (¿`cfg/setups` o `presets/<preset>/setups`?) con el servidor real.
- Formato: el `.ini` que exporta AC/CM (`[CAR] MODEL=…` y una sección por ajuste con `VALUE=`). Howler no necesita entenderlo, solo copiarlo.
- **Idea:** como el servidor y AC suelen estar en el mismo PC, listar los setups de `Documentos\Assetto Corsa\setups\<coche>\<circuito>\` y dejar elegir uno para copiarlo a la carpeta del servidor y asignarlo a las plazas de ese coche. Mostrar qué plazas lo usan y avisar si el setup es de otro coche.

## Neumáticos: la limitación
`LEGAL_TYRES` usa los **nombres cortos** de los compuestos del coche (por ejemplo `SV`, `H`, `M`). Esos nombres están en `data/tyres.ini`, que en los coches de Kunos va cifrado en `data.acd`. ⚠ Habrá que ver si se puede leer (como pasa con `drivetrain.ini`); si no, el panel mostrará una lista conocida para los coches de serie y dejará escribir el nombre a mano en el resto.

## Clima personalizado (no prioritario)
- Con el sistema clásico: un clima es una carpeta en `content/weather/` (con `weather.ini`) que el servidor referencia en `[WEATHER_n] GRAPHICS=`. «Subirlo» = copiar la carpeta al servidor. Howler ya lista los que haya.
- Con WeatherFX (Pure, Sol): los climas los pone cada jugador; el servidor solo manda el tipo.
- **Propuesta mínima:** botón «Añadir clima desde una carpeta o .zip» que valide `weather.ini` y lo copie. Dejarlo para después de lo demás.

## Cómo se vería (para que se entienda a simple vista)
1. **Franja resumen arriba** con lo que está activo ahora, en una línea legible: «Carrera 10 vueltas · Combustible infinito · Daños 200 % · ABS y TC permitidos · Mantas sí». Es lo primero que se lee.
2. **Tarjetas grandes** (las de la tabla «Grandes») con controles directos: interruptores, deslizadores con valor visible y atajos del tipo «Realista / Arcade / Sin daños».
3. **Medios** en secciones plegables. **Técnicos** en «Avanzado».
4. **Buscador** que encuentra cualquier ajuste por su nombre en español o por la clave técnica (`TYRE_BLANKETS_ALLOWED`).
5. Cada ajuste dice qué hace en una frase, su valor por defecto y si se aplica **al reiniciar**; los cambiados respecto al valor de serie se marcan.
6. **Presets de sesión** (guardar y cargar un conjunto de ajustes con nombre): es lo que más se echa de menos de ACSM.
7. Guardar siempre con copia `.howler-prev`, como ahora; aviso si el servidor está en marcha («se aplica al reiniciar»).

## Orden de trabajo propuesto
1. Capa de lectura y escritura genérica del `server_cfg.ini` (todas las claves, con tipo, rango y descripción en un registro único, como `DISCORD_EVENTS`), con tests y conservando BOM y CRLF.
2. Pestaña nueva con la franja resumen y las tarjetas grandes (sesiones, condiciones, ayudas, neumáticos, reglas de carrera).
3. Medios y avanzado con buscador.
4. Setups fijos: selector y copia desde `Documentos\Assetto Corsa\setups`.
5. Presets de sesión.
6. Clima personalizado.

## Para verificar en el PC de Marc
Pendiente de comprobar al implementarlo: carpeta de `setups`, valores de `START_RULE`, lectura de compuestos, que CM respeta las claves nuevas y no las pisa, y el comportamiento de las secciones `__CM_*_OFF`.
