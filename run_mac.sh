#!/usr/bin/env bash
# BhashaMedia AI — start the local Gradio app. Run ./setup_mac.sh once first.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d venv ]; then
  echo "venv not found. Run ./setup_mac.sh first." >&2
  exit 1
fi

source venv/bin/activate

export PYTORCH_ENABLE_MPS_FALLBACK=1
export GRADIO_SERVER_NAME="${GRADIO_SERVER_NAME:-127.0.0.1}"
export GRADIO_SERVER_PORT="${GRADIO_SERVER_PORT:-7860}"

cd app
python app.py
