#!/usr/bin/env bash
set -euo pipefail

SUPPORT_DIR="${HOME}/Library/Application Support/LocalAIStudio/image"
VENV_DIR="${SUPPORT_DIR}/.venv"
MODEL_DIR="${SUPPORT_DIR}/FLUX.1-schnell-8bit"
PIPELINE_PATH="${SUPPORT_DIR}/image_pipeline.py"
MANIFEST_PATH="${SUPPORT_DIR}/image_model.json"
MFLUX_VERSION="0.19.1"
DOWNLOAD_MODEL=1

if [[ "${1:-}" == "--no-model" ]]; then
  DOWNLOAD_MODEL=0
elif [[ "$#" -ne 0 ]]; then
  echo "Usage: install_image.sh [--no-model]" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The image pipeline requires an Apple Silicon Mac." >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh, then rerun this script." >&2
  exit 1
fi

brew install python@3.12
PYTHON="$(brew --prefix python@3.12)/bin/python3.12"
mkdir -p "${SUPPORT_DIR}"
"${PYTHON}" -m venv --clear "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install "mflux==${MFLUX_VERSION}"
cp "$(dirname "$0")/image_pipeline.py" "${PIPELINE_PATH}"
chmod 755 "${PIPELINE_PATH}"

cat > "${MANIFEST_PATH}.tmp" <<EOF
{
  "model": "FLUX.1-schnell",
  "repository": "black-forest-labs/FLUX.1-schnell",
  "mfluxVersion": "${MFLUX_VERSION}",
  "quantize": 8,
  "directory": "${MODEL_DIR}"
}
EOF
mv "${MANIFEST_PATH}.tmp" "${MANIFEST_PATH}"

if [[ "${DOWNLOAD_MODEL}" == "1" ]]; then
  rm -rf "${MODEL_DIR}"
  "${VENV_DIR}/bin/mflux-save" --model schnell --path "${MODEL_DIR}" --quantize 8
  "${VENV_DIR}/bin/python" "${PIPELINE_PATH}" --check
else
  echo "Model download skipped; readiness remains false until mflux-save creates:"
  echo "  ${MODEL_DIR}"
fi

echo "MLX-native FLUX.1-schnell image pipeline installed (mflux ${MFLUX_VERSION})."
echo "Reconnect the signed Studio worker to refresh image readiness."
