#!/usr/bin/env bash
# Arranque local: libera puertos típicos de dev y levanta API (8000) + Next (3000).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[dev] Liberando puertos 8000, 3000, 3001 (instancias previas de este proyecto)..."
for port in 8000 3000 3001; do
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti:"${port}" | xargs -r kill -9 2>/dev/null || true
  fi
done
sleep 1

cleanup() {
  echo ""
  echo "[dev] Cerrando uvicorn (pid ${UVICORN_PID:-})..."
  kill "${UVICORN_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT/backend"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
fi
PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"
if ! "$PY" -c "import uvicorn" 2>/dev/null; then
  echo "[dev] Instalando dependencias backend..."
  pip install -q -r requirements.txt
fi

echo "[dev] Backend: http://127.0.0.1:8000"
uvicorn main:app --reload --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!

cd "$ROOT/frontend"
if [[ ! -d node_modules ]]; then
  echo "[dev] Instalando dependencias frontend (npm install)..."
  npm install
fi
echo "[dev] Frontend: http://localhost:3000"
npm run dev
