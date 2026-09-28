#!/usr/bin/env bash
# BhashaMedia AI — one-time local setup for Mac (Apple Silicon or Intel).
# No Pinokio, no conda, no external launcher app required.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Checking prerequisites..."
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is intended for macOS. Detected: $(uname -s)" >&2
  echo "You can still continue, but support targets local Mac setup." >&2
fi

PYTHON_BIN="${BHASHAMEDIA_PYTHON:-}"
if [ -n "$PYTHON_BIN" ] && ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "BHASHAMEDIA_PYTHON is set to '$PYTHON_BIN' but that command was not found." >&2
  exit 1
fi
if [ -z "$PYTHON_BIN" ]; then
  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="python3.11"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  else
    echo "python3 not found. Install it first: brew install python@3.11" >&2
    exit 1
  fi
fi

PY_MM="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
PY_MAJOR="${PY_MM%%.*}"
PY_MINOR="${PY_MM##*.}"
if [ "$PY_MAJOR" -ne 3 ] || [ "$PY_MINOR" -lt 11 ]; then
  echo "Python $PY_MM detected via '$PYTHON_BIN'. Please use Python 3.11+." >&2
  echo "Recommended fix: brew install python@3.11" >&2
  exit 1
fi
if [ "$PY_MINOR" -ge 13 ]; then
  echo "Note: Python $PY_MM may have limited wheel support for some media/ML packages."
  echo "If install fails, retry with Python 3.11: BHASHAMEDIA_PYTHON=python3.11 ./setup_mac.sh"
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

if [ ! -d venv ]; then
  echo "==> Creating virtual environment (./venv) with $PYTHON_BIN..."
  "$PYTHON_BIN" -m venv venv
else
  echo "==> Reusing existing virtual environment (./venv)"
fi
source venv/bin/activate

echo "==> Installing core Python dependencies..."
pip install --upgrade pip
pip install -r app/requirements.txt

mkdir -p app/models app/outputs

cat <<'EOF'

==> Setup complete.

Start the app:      ./run_mac.sh
Recommended agent:  install Ollama (https://ollama.com) then `ollama pull llama3.1`
Optional models:    python app/download_models.py --list
Python override:    BHASHAMEDIA_PYTHON=python3.11 ./setup_mac.sh

See MODELS.md for the full recommended-model guide (voice clone, avatar, agent).
EOF
