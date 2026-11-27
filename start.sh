#!/usr/bin/env bash
# Anonymous Faculty Feedback System - one-click start for macOS / Linux.
# Uses Node.js 22.13+ if installed, otherwise downloads a private copy into .runtime/,
# installs packages, imports legacy-data/ if present, starts the server and opens the browser.
set -euo pipefail
cd "$(dirname "$0")"
NODE_VERSION=v22.21.1
PORT="${PORT:-3000}"
export PORT

node_ok() { command -v node >/dev/null 2>&1 && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; }

if ! node_ok; then
  case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; *) arch=x64 ;; esac
  dir=".runtime/node-$NODE_VERSION-$os-$arch"
  if [ ! -x "$dir/bin/node" ]; then
    echo "[1/4] Node.js 22.13+ not found - downloading a private copy (one time only)..."
    mkdir -p .runtime
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$os-$arch.tar.gz" | tar -xz -C .runtime
  fi
  export PATH="$PWD/$dir/bin:$PATH"
fi
echo "[1/4] Using Node.js $(node -v)"

if [ ! -f node_modules/.installed-stamp ] || [ package-lock.json -nt node_modules/.installed-stamp ]; then
  echo "[2/4] Installing packages..."
  npm ci --omit=dev --no-audit --no-fund --loglevel=error || npm install --omit=dev --no-audit --no-fund --loglevel=error
  touch node_modules/.installed-stamp
else
  echo "[2/4] Packages already installed"
fi

mkdir -p data
if ls legacy-data/*.csv >/dev/null 2>&1 && [ ! -f data/.legacy-imported ]; then
  echo "[3/4] Importing the old system's CSV files from legacy-data/ ..."
  npm run import-legacy --silent -- legacy-data && touch data/.legacy-imported
else
  echo "[3/4] No new legacy data to import"
fi

echo "[4/4] Starting on http://localhost:$PORT  (Ctrl+C to stop)"
( sleep 3; (command -v open >/dev/null && open "http://localhost:$PORT/") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/") || true ) >/dev/null 2>&1 &
exec node --disable-warning=ExperimentalWarning server/index.js
