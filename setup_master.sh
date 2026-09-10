#!/usr/bin/env bash
# Install the BhashaMedia toolbox and Professional Studio control plane.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup_master.sh supports macOS only." >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Professional Studio requires an Apple Silicon Mac (arm64)." >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  for brew_candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "${brew_candidate}" ]]; then
      BREW_PREFIX="$("${brew_candidate}" --prefix)"
      export PATH="${BREW_PREFIX}/bin:${BREW_PREFIX}/sbin:${PATH}"
      break
    fi
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh and rerun this script." >&2
  exit 1
fi

install_formula_if_missing() {
  local command_name="$1"
  local formula="$2"
  if command -v "${command_name}" >/dev/null 2>&1; then
    echo "==> ${command_name} already available"
    return
  fi
  if brew list --versions "${formula}" >/dev/null 2>&1; then
    echo "==> ${formula} already installed"
    return
  fi
  echo "==> Installing missing prerequisite: ${formula}"
  brew install "${formula}"
}

install_formula_if_missing node node
install_formula_if_missing ffmpeg ffmpeg
install_formula_if_missing python3.11 python@3.11
install_formula_if_missing pg_isready postgresql@16

POSTGRES_PREFIX="$(brew --prefix postgresql@16)"
export PATH="${POSTGRES_PREFIX}/bin:${PATH}"

if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  echo "==> Enabling pnpm through Corepack"
  if ! corepack enable; then
    echo "Corepack could not install its shim; falling back to Homebrew pnpm."
  fi
fi
install_formula_if_missing pnpm pnpm

if ! pg_isready -q; then
  echo "==> Starting dedicated PostgreSQL runtime"
  brew services start postgresql@16
  for _ in {1..30}; do
    pg_isready -q && break
    sleep 1
  done
fi
if ! pg_isready -q; then
  echo "PostgreSQL did not become ready. Run: brew services info postgresql@16" >&2
  exit 1
fi

STUDIO_DB_NAME="${STUDIO_DB_NAME:-local_ai_studio}"
if [[ ! "${STUDIO_DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "STUDIO_DB_NAME must contain only letters, numbers, and underscores." >&2
  exit 2
fi
if [[ "$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${STUDIO_DB_NAME}'")" != "1" ]]; then
  echo "==> Creating PostgreSQL database: ${STUDIO_DB_NAME}"
  createdb "${STUDIO_DB_NAME}"
else
  echo "==> PostgreSQL database already exists: ${STUDIO_DB_NAME}"
fi

DATABASE_URL="${DATABASE_URL:-postgresql:///${STUDIO_DB_NAME}}"
{
  printf 'DATABASE_URL=%q\n' "${DATABASE_URL}"
  printf 'STUDIO_API_PORT=%q\n' "${STUDIO_API_PORT:-5000}"
  printf 'STUDIO_UI_PORT=%q\n' "${STUDIO_UI_PORT:-5173}"
  printf 'GRADIO_SERVER_PORT=%q\n' "${GRADIO_SERVER_PORT:-7860}"
  printf 'GRADIO_SERVER_NAME=%q\n' "${GRADIO_SERVER_NAME:-127.0.0.1}"
  printf 'OLLAMA_BASE_URL=%q\n' "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
  printf 'OLLAMA_MODEL=%q\n' "${OLLAMA_MODEL:-qwen2.5:14b}"
} > .env.local
chmod 600 .env.local

PYTHON="$(brew --prefix python@3.11)/bin/python3.11"
if [[ ! -x "${PYTHON}" ]]; then
  echo "Homebrew Python 3.11 was not found at ${PYTHON}." >&2
  exit 1
fi
if [[ ! -x venv/bin/python ]]; then
  echo "==> Creating Python 3.11 virtual environment"
  "${PYTHON}" -m venv venv
fi
echo "==> Installing BhashaMedia Python dependencies"
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r app/requirements.txt
mkdir -p app/models app/outputs

echo "==> Installing Professional Studio dependencies"
(cd studio && pnpm install --frozen-lockfile)

echo "==> Applying the Drizzle schema"
(cd studio && DATABASE_URL="${DATABASE_URL}" pnpm --filter @workspace/db run push)

echo "==> Building the Studio API and UI"
(cd studio && PORT=5000 BASE_PATH=/ pnpm run build)

cat <<'EOF'

Setup complete. Start both applications with:
  ./run_master.sh

Heavy model weights remain opt-in:
  bash studio/tools/mac-worker/install_image.sh
  bash studio/tools/mac-worker/install_presenter.sh
  bash studio/tools/mac-worker/install_presenter.sh --bf16

Use --no-model on either worker installer to validate/install only its runtime.
EOF
