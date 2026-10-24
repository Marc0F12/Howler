// Empaqueta Howler para Linux: dist-linux/Howler-<versión>-linux.tar.gz (Node 24 + AssettoServer v0.0.55-pre35 por su cuenta).
// Lleva el programa ya compilado (app/howler.mjs), la web, el plugin compilado (la DLL es la misma en cualquier sistema),
// un preparador de servidor (app/setup-linux.mjs), install.sh, start.sh y una plantilla de systemd.
// Uso: npm run package:linux   (requiere plugin/dist/HowlerPlugin: se compila con dotnet build -c Release en plugin/HowlerPlugin)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
cpSync(join(root, 'docs', 'LINUX-GUIA.md'), join(dir, 'LINUX-GUIA.md'));

const sh = (s) => s.replace(/^\n/, ''); // los scripts van con saltos de línea de Unix
writeFileSync(join(dir, 'start.sh'), sh(`
#!/usr/bin/env bash
# Arranca Howler (la web en el puerto 8420; el panel solo en 127.0.0.1:8421).
cd "$(dirname "$0")" || exit 1
export HOWLER_HOME="$PWD"
if [ -x runtime/bin/node ]; then NODE=runtime/bin/node; else NODE=node; fi
exec "$NODE" app/howler.mjs
`));

writeFileSync(join(dir, 'install.sh'), sh(`
#!/usr/bin/env bash
# Instala Howler. Lo normal: doble clic en «Instalar Howler» (o «bash install.sh» sin nada más): un asistente
# te pregunta lo mínimo y lo hace todo (Node, servidor, plugin, arranque automático).
# Para quien prefiere indicarlo a mano:
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
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "No entiendo «$1». Mira: bash install.sh --help"; exit 1 ;;
  esac
done

get() { # get <url> <archivo>
  if command -v curl >/dev/null 2>&1; then curl -fL --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "Necesito curl o wget para descargar Node.js. Instala uno (por ejemplo: sudo apt install curl)."; exit 1; fi
}

# Node 24: el del sistema si sirve; si no, se descarga UNA vez a la carpeta runtime/ (sin permisos de administrador).
ensure_node() {
  if [ -x runtime/bin/node ]; then NODE="$PWD/runtime/bin/node"; return; fi
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then NODE="$(command -v node)"; return; fi
  case "$(uname -m)" in x86_64|amd64) A=x64 ;; aarch64|arm64) A=arm64 ;; *) echo "Procesador no soportado: $(uname -m)"; exit 1 ;; esac
  echo "Howler necesita Node.js 24. Lo descargo ahora a la carpeta de Howler (una sola vez, unos 30 MB)…"
  BASE="https://nodejs.org/dist/latest-v24.x"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  get "$BASE/SHASUMS256.txt" "$TMP/sums"
  LINE="$(grep -E "node-v24[0-9.]*-linux-$A\.tar\.gz\$" "$TMP/sums" | head -n1)"
  [ -n "$LINE" ] || { echo "No encuentro Node 24 para tu procesador."; exit 1; }
  FILE="\${LINE##* }"
  get "$BASE/$FILE" "$TMP/$FILE"
  (cd "$TMP" && echo "$LINE" | sha256sum -c - >/dev/null) || { echo "La descarga de Node.js no coincide con su suma de comprobación: la descarto."; exit 1; }
  mkdir -p runtime && tar -xzf "$TMP/$FILE" -C runtime --strip-components=1
  NODE="$PWD/runtime/bin/node"
}
ensure_node
chmod +x start.sh install.sh 2>/dev/null || true

if [ -n "$SERVER" ]; then
  "$NODE" app/setup-linux.mjs --server "$SERVER" \${PRESET:+--preset "$PRESET"}
elif [ "$INIT" -eq 1 ]; then
  "$NODE" app/setup-linux.mjs --init
else
  "$NODE" app/setup-linux.mjs --wizard --node "$NODE"
  if [ -f .start-now ]; then rm -f .start-now; echo; echo "Arrancando Howler… (ciérralo con Ctrl+C)"; exec bash start.sh; fi
  exit 0
fi

if [ "$SERVICE" -eq 1 ]; then
  "$NODE" app/setup-linux.mjs --service --node "$NODE"
fi

echo
echo "Listo. Arranca Howler con:  bash $HOME_DIR/start.sh"
echo "La web quedará en http://<IP de este equipo>:8420 y el panel en http://127.0.0.1:8421"
echo "(desde tu PC: ssh -L 8421:127.0.0.1:8421 usuario@servidor  y abre http://127.0.0.1:8421). Más en LINUX.md."
`));

// Doble clic (GNOME, KDE, Cinnamon…): abre un terminal y ejecuta el asistente. %k = ruta de este mismo archivo.
const desktop = (es, en, cmd) => `[Desktop Entry]
Type=Application
Version=1.0
Name=${es}
Name[en]=${en}
Comment=Howler
Exec=bash -c 'cd "$(dirname "$1")" && ${cmd}; echo; read -r -p "Pulsa Intro para cerrar / Press Enter to close " _' _ %k
Terminal=true
Categories=Game;Utility;
`;
writeFileSync(join(dir, 'Instalar Howler.desktop'), desktop('Instalar Howler', 'Install Howler', 'bash install.sh'));
writeFileSync(join(dir, 'Iniciar Howler.desktop'), desktop('Iniciar Howler', 'Start Howler', 'bash start.sh'));
if (process.platform !== 'win32') for (const f of ['install.sh', 'start.sh', 'Instalar Howler.desktop', 'Iniciar Howler.desktop']) chmodSync(join(dir, f), 0o755);

writeFileSync(join(dir, 'LEEME.txt'), `Howler ${version} para Linux
=========================
Haz doble clic en «Instalar Howler» (si tu gestor de archivos pregunta, elige «Ejecutar» o «Confiar y ejecutar»;
si no, abre un terminal en esta carpeta y escribe: bash install.sh). Un asistente te pregunta lo mínimo y se encarga
de Node, del servidor, del plugin y del arranque automático. Para arrancar después: «Iniciar Howler».

Guía paso a paso con todos los comandos y soluciones a los errores: LINUX-GUIA.md

Para quien prefiera hacerlo a mano:
  bash install.sh --server /ruta/al/servidor      prepara el servidor y la configuración
  bash start.sh                                   arranca Howler
  bash install.sh --server /ruta --service        además lo deja como servicio de systemd

Para actualizar: descomprime la versión nueva sobre la carpeta de Howler y ejecuta otra vez install.sh
(tu configuración y tus datos, howler.config.json y data/, no se tocan).

Howler ${version} for Linux
=========================
Double-click "Install Howler" (if your file manager asks, choose "Run" or "Trust and run"; otherwise open a terminal
in this folder and type: bash install.sh). A wizard asks the minimum and takes care of Node, the server, the plugin
and starting automatically. To start later: "Start Howler".

Step-by-step guide (in Spanish) with every command and fixes for common errors: LINUX-GUIA.md

If you prefer to do it by hand:

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
