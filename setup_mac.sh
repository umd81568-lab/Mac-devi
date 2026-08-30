#!/usr/bin/env bash
# BhashaMedia AI — one-time local setup for Mac (Apple Silicon or Intel).
# No Pinokio, no conda, no external launcher app required.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Checking prerequisites..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install it first: brew install python@3.11" >&2
  exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "Python 3.11 or newer is required. Install it with: brew install python@3.11" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Installing via Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "Homebrew not found. Install it from https://brew.sh then re-run this script." >&2
    exit 1
  fi
fi

echo "==> Creating virtual environment (./venv)..."
if [ ! -x venv/bin/python ]; then
  python3 -m venv venv
fi
source venv/bin/activate

echo "==> Installing core Python dependencies..."
python -m pip install --upgrade pip
python -m pip install -r app/requirements.txt

echo "==> Verifying the installation..."
python -c 'import gradio; print(f"Gradio {gradio.__version__} is ready.")'
python -m py_compile app/app.py

mkdir -p app/models app/outputs

cat <<'EOF'

==> Setup complete.

Start the app:      ./run_mac.sh
Recommended agent:  install Ollama (https://ollama.com) then `ollama pull llama3.1`
Optional models:    python app/download_models.py --list

See MODELS.md for the full recommended-model guide (voice clone, avatar, agent).
EOF
