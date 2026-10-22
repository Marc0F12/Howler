// Empaqueta Howler para Linux: dist-linux/Howler-<versión>-linux.tar.gz (Node 24 + AssettoServer v0.0.55-pre35 por su cuenta).
// Lleva el programa ya compilado (app/howler.mjs), la web, el plugin compilado (la DLL es la misma en cualquier sistema),
// un preparador de servidor (app/setup-linux.mjs), install.sh, start.sh y una plantilla de systemd.
// Uso: npm run package:linux   (requiere plugin/dist/HowlerPlugin: se compila con dotnet build -c Release en plugin/HowlerPlugin)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const name = `Howler-${version}-linux`;
const outRoot = join(root, 'dist-linux');
const dir = join(outRoot, 'howler');
const pluginSrc = join(root, 'plugin', 'dist', 'HowlerPlugin');
if (!existsSync(join(pluginSrc, 'HowlerPlugin.dll'))) throw new Error('Falta plugin/dist/HowlerPlugin/HowlerPlugin.dll: compílalo con «dotnet build -c Release» en plugin/HowlerPlugin.');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(join(dir, 'app'), { recursive: true });
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });

const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
for (const [entry, outfile] of [['packages/server/src/index.ts', 'app/howler.mjs'], ['packages/installer/src/linux-cli.ts', 'app/setup-linux.mjs']]) {
  await build({ entryPoints: [join(root, entry)], outfile: join(dir, outfile), bundle: true, platform: 'node', format: 'esm', target: 'node24', banner, logLevel: 'warning' });
}
cpSync(join(root, 'packages/web/dist'), join(dir, 'web'), { recursive: true });
cpSync(pluginSrc, join(dir, 'plugin', 'HowlerPlugin'), { recursive: true });
for (const f of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) if (existsSync(join(root, f))) cpSync(join(root, f), join(dir, f));
cpSync(join(root, 'docs', 'LINUX.md'), join(dir, 'LINUX.md'));

const sh = (s) => s.replace(/^\n/, ''); // los scripts van con saltos de línea de Unix
writeFileSync(join(dir, 'start.sh'), sh(`
#!/usr/bin/env bash
# Arranca Howler (la web en el puerto 8420; el panel solo en 127.0.0.1:8421).
cd "$(dirname "$0")" || exit 1
export HOWLER_HOME="$PWD"
exec node app/howler.mjs
`));

writeFileSync(join(dir, 'install.sh'), sh(`
#!/usr/bin/env bash
# Prepara Howler y, si le dices dónde está, tu servidor de AssettoServer.
#   bash install.sh --server /ruta/al/servidor [--preset SERVER_00] [--service]
#   bash install.sh --init                      (solo crea howler.config.json; el servidor lo pones después)
set -euo pipefail
cd "$(dirname "$0")"
HOME_DIR="$PWD"
SERVER=""; PRESET=""; SERVICE=0; INIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="\${2:-}"; shift 2 ;;
    --preset) PRESET="\${2:-}"; shift 2 ;;
    --service) SERVICE=1; shift ;;
    --init) INIT=1; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "No entiendo «$1». Mira: bash install.sh --help"; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js 24 o más. Instálalo (https://nodejs.org, o con nvm: «nvm install 24») y vuelve a ejecutar esto."; exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 24 ]; then
  echo "Tienes Node $(node -v) y Howler necesita la 24 o más (usa node:sqlite). Actualízalo y vuelve a ejecutar esto."; exit 1
fi

if [ -n "$SERVER" ]; then
  node app/setup-linux.mjs --server "$SERVER" \${PRESET:+--preset "$PRESET"}
elif [ "$INIT" -eq 1 ]; then
  node app/setup-linux.mjs --init
else
  echo "Dime dónde está tu servidor:  bash install.sh --server /ruta/al/servidor"
  echo "(o «bash install.sh --init» para crear solo la configuración y poner el servidor después)"; exit 1
fi
chmod +x start.sh || true

if [ "$SERVICE" -eq 1 ]; then
  NODE_BIN="$(command -v node)"
  UNIT="[Unit]
Description=Howler
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$HOME_DIR
Environment=HOWLER_HOME=$HOME_DIR
ExecStart=$NODE_BIN $HOME_DIR/app/howler.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=60

[Install]
WantedBy=@TARGET@"
  if [ "$(id -u)" -eq 0 ]; then
    printf '%s\\n' "\${UNIT//@TARGET@/multi-user.target}" > /etc/systemd/system/howler.service
    systemctl daemon-reload && systemctl enable --now howler
    echo "Servicio howler instalado y en marcha. Registro: journalctl -u howler -f"
  else
    mkdir -p "$HOME/.config/systemd/user"
    printf '%s\\n' "\${UNIT//@TARGET@/default.target}" > "$HOME/.config/systemd/user/howler.service"
    systemctl --user daemon-reload && systemctl --user enable --now howler
    echo "Servicio howler (de tu usuario) instalado y en marcha. Registro: journalctl --user -u howler -f"
    echo "Para que arranque con el sistema sin iniciar sesión: sudo loginctl enable-linger $USER"
  fi
fi

echo
echo "Listo. Arranca Howler con:  bash $HOME_DIR/start.sh"
echo "La web quedará en http://<IP de este equipo>:8420 y el panel en http://127.0.0.1:8421"
echo "(desde tu PC: ssh -L 8421:127.0.0.1:8421 usuario@servidor  y abre http://127.0.0.1:8421). Más en LINUX.md."
`));

writeFileSync(join(dir, 'LEEME.txt'), `Howler ${version} para Linux
=========================
Necesitas Node.js 24 o más y un AssettoServer v0.0.55-pre35 para Linux ya descomprimido
(con su carpeta content/ y system/; mira LINUX.md).

  bash install.sh --server /ruta/al/servidor      prepara el servidor y la configuración
  bash start.sh                                   arranca Howler
  bash install.sh --server /ruta --service        además lo deja como servicio de systemd

Para actualizar: descomprime la versión nueva sobre la carpeta de Howler y ejecuta otra vez install.sh
(tu configuración y tus datos, howler.config.json y data/, no se tocan).

Howler ${version} for Linux
=========================
You need Node.js 24 or newer and an AssettoServer v0.0.55-pre35 for Linux already unpacked
(with its content/ and system/ folders; see LINUX.md).

  bash install.sh --server /path/to/server        prepares the server and the configuration
  bash start.sh                                   starts Howler
  bash install.sh --server /path --service        also installs it as a systemd service

To update: unpack the new version over Howler's folder and run install.sh again
(your configuration and data, howler.config.json and data/, are not touched).
`);

// tar.gz con el tar del sistema (GNU tar en Git Bash/Linux; bsdtar en Windows): sin propietario, permisos normales.
const tgz = join(outRoot, `${name}.tar.gz`);
// Rutas relativas desde dist-linux: GNU tar toma «C:\...» por un equipo remoto.
execFileSync('tar', ['-czf', `${name}.tar.gz`, 'howler'], { cwd: outRoot, stdio: 'inherit' });
console.log(`Listo: ${tgz}`);
