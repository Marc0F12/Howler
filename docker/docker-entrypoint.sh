#!/bin/sh
# Prepara /state (configuración y datos de Howler) y /server (AssettoServer) la primera vez y arranca Howler.
set -eu
APP=/opt/howler
mkdir -p /state /server
for d in app web plugin; do ln -sfn "$APP/$d" "/state/$d"; done

# AssettoServer: si la carpeta del servidor está vacía de programa, se copia el de la imagen.
if [ ! -e /server/AssettoServer ]; then
  echo "[docker] Copiando AssettoServer a /server…"
  cp -a /opt/assetto/. /server/
fi
chmod +x /server/AssettoServer 2>/dev/null || true

# Preparar el servidor para Howler (plugin, puertos y configuración) si todavía no hay configuración.
if [ ! -e "$HOWLER_CONFIG" ]; then
  if [ -d /server/presets ] && [ -n "$(ls -A /server/presets 2>/dev/null)" ]; then
    node /state/app/setup-linux.mjs --server /server --home /state
  else
    echo "[docker] Aún no hay ningún preset en /server/presets: Howler arranca sin servidor. Pon ahí tu servidor (presets, content y system) y reinicia el contenedor."
    node /state/app/setup-linux.mjs --init --home /state
  fi
  # El panel escucha en la red del contenedor para poder abrirlo desde el equipo (con usuario y contraseña).
  node -e "
    const fs=require('fs');const f=process.env.HOWLER_CONFIG;const c=JSON.parse(fs.readFileSync(f,'utf8'));
    c.admin={...(c.admin||{}),remote:{enabled:true}};
    if(!c.serverDir) c.serverDir='/server';
    fs.writeFileSync(f,JSON.stringify(c,null,2)+'\n');"
fi

# Cuenta del panel desde variables de entorno (se crea una vez, hablando con el panel desde dentro del contenedor).
if [ -n "${HOWLER_ADMIN_PASSWORD:-}" ]; then
  (
    for i in $(seq 1 60); do
      if node -e "fetch('http://127.0.0.1:8421/admin/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
      sleep 1
    done
    node -e "
      fetch('http://127.0.0.1:8421/admin/api/accounts',{method:'POST',headers:{'content-type':'application/json','x-howler-admin':'1'},
        body:JSON.stringify({name:process.env.HOWLER_ADMIN_USER||'admin',password:process.env.HOWLER_ADMIN_PASSWORD,role:'admin'})})
      .then(async r=>{console.log('[docker] cuenta del panel:',r.ok?'creada':(await r.text()))}).catch(e=>console.log('[docker]',e.message))" || true
  ) &
fi

cd /state
exec node app/howler.mjs
