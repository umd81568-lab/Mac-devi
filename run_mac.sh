#!/usr/bin/env bash
# BhashaMedia AI — start the local Gradio app. Run ./setup_mac.sh once first.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f venv/bin/python ]; then
  echo "venv not found. Run ./setup_mac.sh first." >&2
  exit 1
fi

source venv/bin/activate

export PYTORCH_ENABLE_MPS_FALLBACK=1
export GRADIO_SERVER_NAME="${GRADIO_SERVER_NAME:-127.0.0.1}"
export GRADIO_SERVER_PORT="${GRADIO_SERVER_PORT:-7860}"

echo "Starting BhashaMedia AI at http://${GRADIO_SERVER_NAME}:${GRADIO_SERVER_PORT}"
echo "Tip: Tabs ③/⑨/⑩ need optional model setup (see MODELS.md)."

python app/app.py
