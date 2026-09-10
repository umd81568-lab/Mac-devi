#!/usr/bin/env bash
# Run the BhashaMedia toolbox and Professional Studio as one local stack.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f .env.local ]]; then
  echo ".env.local is missing. Run ./setup_master.sh first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.local
set +a

if ! command -v brew >/dev/null 2>&1; then
  for brew_candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "${brew_candidate}" ]]; then
      BREW_PREFIX="$("${brew_candidate}" --prefix)"
      export PATH="${BREW_PREFIX}/bin:${BREW_PREFIX}/sbin:${PATH}"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is unavailable. Run ./setup_master.sh first." >&2
  exit 1
fi

STUDIO_API_PORT="${STUDIO_API_PORT:-5000}"
STUDIO_UI_PORT="${STUDIO_UI_PORT:-5173}"
GRADIO_SERVER_PORT="${GRADIO_SERVER_PORT:-7860}"
GRADIO_SERVER_NAME="${GRADIO_SERVER_NAME:-127.0.0.1}"
BASE_PATH="${BASE_PATH:-/}"
STUDIO_OUTPUT_DIR="${STUDIO_OUTPUT_DIR:-${ROOT_DIR}/studio/artifacts/api-server/data/studio}"
export DATABASE_URL STUDIO_OUTPUT_DIR GRADIO_SERVER_PORT GRADIO_SERVER_NAME
export PYTORCH_ENABLE_MPS_FALLBACK=1

for port in "${STUDIO_API_PORT}" "${STUDIO_UI_PORT}" "${GRADIO_SERVER_PORT}"; do
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${port} is already in use; refusing to start a partial stack." >&2
    exit 1
  fi
done

if [[ ! -x venv/bin/python ]]; then
  echo "Python environment is missing. Run ./setup_master.sh first." >&2
  exit 1
fi
if [[ ! -d studio/node_modules || ! -f studio/artifacts/api-server/dist/index.mjs || ! -f studio/artifacts/local-ai-studio/dist/public/index.html ]]; then
  echo "Studio dependencies or build outputs are missing. Run ./setup_master.sh first." >&2
  exit 1
fi
if ! command -v pg_isready >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew/PostgreSQL is unavailable. Run ./setup_master.sh first." >&2
    exit 1
  fi
  POSTGRES_PREFIX="$(brew --prefix postgresql@16)"
  export PATH="${POSTGRES_PREFIX}/bin:${PATH}"
fi
if ! pg_isready -q; then
  echo "PostgreSQL is not ready. Run: brew services start postgresql@16" >&2
  exit 1
fi

pids=()
names=()
cleanup() {
  local pid
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done
  for pid in "${pids[@]:-}"; do
    wait "${pid}" 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

echo "==> Starting BhashaMedia toolbox"
(cd app && exec ../venv/bin/python app.py) &
pids+=("$!")
names+=("BhashaMedia")

echo "==> Starting Professional Studio API"
(cd studio && exec env \
  PORT="${STUDIO_API_PORT}" \
  DATABASE_URL="${DATABASE_URL}" \
  STUDIO_OUTPUT_DIR="${STUDIO_OUTPUT_DIR}" \
  OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}" \
  OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:14b}" \
  node --enable-source-maps artifacts/api-server/dist/index.mjs) &
pids+=("$!")
names+=("Studio API")

echo "==> Starting Professional Studio UI"
(cd studio && exec env \
  PORT="${STUDIO_UI_PORT}" \
  BASE_PATH="${BASE_PATH}" \
  API_BASE_URL="http://127.0.0.1:${STUDIO_API_PORT}" \
  artifacts/local-ai-studio/node_modules/.bin/vite preview \
    --config artifacts/local-ai-studio/vite.config.ts \
    --host 127.0.0.1) &
pids+=("$!")
names+=("Studio UI")

wait_for_url() {
  local name="$1"
  local url="$2"
  local pid="$3"
  for _ in {1..60}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      wait "${pid}" || true
      echo "${name} exited before becoming ready." >&2
      exit 1
    fi
    if curl --fail --silent --show-error --max-time 2 "${url}" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "${name} did not become ready at ${url}." >&2
  exit 1
}

wait_for_url "Studio API" "http://127.0.0.1:${STUDIO_API_PORT}/api/healthz" "${pids[1]}"
wait_for_url "Studio UI" "http://127.0.0.1:${STUDIO_UI_PORT}/" "${pids[2]}"
wait_for_url "BhashaMedia" "http://${GRADIO_SERVER_NAME}:${GRADIO_SERVER_PORT}/" "${pids[0]}"

cat <<EOF

Local AI Studio is ready:
  Professional control plane: http://127.0.0.1:${STUDIO_UI_PORT}/
  BhashaMedia 10 facilities:   http://${GRADIO_SERVER_NAME}:${GRADIO_SERVER_PORT}/
  Studio API health:           http://127.0.0.1:${STUDIO_API_PORT}/api/healthz

Press Ctrl-C to stop this stack.
EOF

while true; do
  for index in "${!pids[@]}"; do
    if ! kill -0 "${pids[index]}" 2>/dev/null; then
      if wait "${pids[index]}"; then
        status=0
      else
        status=$?
      fi
      if [[ "${status}" -eq 0 ]]; then
        status=1
      fi
      echo "${names[index]} exited unexpectedly with status ${status}." >&2
      exit "${status}"
    fi
  done
  sleep 1
done
