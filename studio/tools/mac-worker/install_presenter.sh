#!/usr/bin/env bash
set -euo pipefail

# Installs the local human-performance runtime used by StudioWorker.swift.
# The default is a production install, including the quantized model weights.

SUPPORT_DIR="${HOME}/Library/Application Support/LocalAIStudio/presenter"
RUNTIME_DIR="${SUPPORT_DIR}/longcat-avatar-mlx"
VENV_DIR="${SUPPORT_DIR}/.venv"
WEIGHTS_DIR="${SUPPORT_DIR}/weights"
PIPELINE_PATH="${SUPPORT_DIR}/presenter_pipeline.py"
MODEL_MANIFEST="${SUPPORT_DIR}/presenter_model.json"
RUNTIME_REPOSITORY="https://github.com/xocialize/longcat-avatar-mlx.git"
RUNTIME_COMMIT="e2e1e8701424cef0e601281b62e228e5289ed032"
WHISPER_FEATURE_DIR="${SUPPORT_DIR}/whisper-large-v3"
MODEL_VARIANT="q4"
DOWNLOAD_MODEL=1

usage() {
  cat <<'EOF'
Usage: install_presenter.sh [--variant q4|bf16] [--no-model]

Installs the pinned LongCat-Video-Avatar 1.5 MLX runtime for Apple Silicon.
The default install downloads the q4 DMD-merged model (about 25 GB).

  --variant q4|bf16
              Select the model weights. q4 is the safe default. bf16 requires
              at least 64 GB unified memory and about 55 GB free disk space.
  --bf16      Shortcut for --variant bf16.
  --no-model  Install the runtime and dependencies without downloading weights.
              StudioWorker will stay blocked until the selected model is
              downloaded.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --variant)
      [[ "$#" -ge 2 ]] || { echo "--variant requires q4 or bf16." >&2; exit 2; }
      MODEL_VARIANT="$2"
      shift 2
      ;;
    --bf16)
      MODEL_VARIANT="bf16"
      shift
      ;;
    --no-model)
      DOWNLOAD_MODEL=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "${MODEL_VARIANT}" in
  q4)
    MODEL_REPOSITORY="mlx-community/LongCat-Video-Avatar-1.5-q4-dmd-merged"
    MODEL_REVISION="5d5b5d61ce6c206930a94c760f6941aff03f9389"
    MODEL_DIR="${WEIGHTS_DIR}/LongCat-Video-Avatar-1.5-q4-dmd-merged"
    RUNTIME_VARIANT="q4-merged"
    MODEL_LABEL="LongCat-Video-Avatar 1.5 q4 DMD-merged"
    MIN_MEMORY_GB=32
    MIN_DISK_GB=30
    ;;
  bf16)
    MODEL_REPOSITORY="mlx-community/LongCat-Video-Avatar-1.5-bf16-dmd-merged"
    MODEL_REVISION="e80d3712658fc91e2f2a0a8a3b5d7a6230ca9ab3"
    MODEL_DIR="${WEIGHTS_DIR}/LongCat-Video-Avatar-1.5-bf16-dmd-merged"
    RUNTIME_VARIANT="merged"
    MODEL_LABEL="LongCat-Video-Avatar 1.5 bf16 DMD-merged"
    MIN_MEMORY_GB=64
    MIN_DISK_GB=55
    ;;
  *)
    echo "Unsupported model variant '${MODEL_VARIANT}'. Choose q4 or bf16." >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer must run on macOS." >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This presenter pipeline requires an Apple Silicon Mac (arm64)." >&2
  exit 1
fi
if [[ "${MODEL_VARIANT}" == "bf16" ]]; then
  MEMORY_BYTES="$(sysctl -n hw.memsize)"
  if [[ "${MEMORY_BYTES}" -lt $((MIN_MEMORY_GB * 1024 * 1024 * 1024)) ]]; then
    echo "The bf16 presenter requires at least ${MIN_MEMORY_GB} GB unified memory." >&2
    exit 1
  fi
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh, then rerun this script." >&2
  exit 1
fi

brew install python@3.12 ffmpeg git
PYTHON="$(brew --prefix python@3.12)/bin/python3.12"
[[ -x "${PYTHON}" ]] || { echo "Homebrew Python 3.12 was not found." >&2; exit 1; }

mkdir -p "${SUPPORT_DIR}" "${WEIGHTS_DIR}"
if [[ -d "${RUNTIME_DIR}/.git" ]]; then
  git -C "${RUNTIME_DIR}" fetch --depth 1 origin "${RUNTIME_COMMIT}"
else
  rm -rf "${RUNTIME_DIR}"
  git clone --filter=blob:none "${RUNTIME_REPOSITORY}" "${RUNTIME_DIR}"
fi
git -C "${RUNTIME_DIR}" checkout --detach "${RUNTIME_COMMIT}"

"${PYTHON}" -m venv --clear "${VENV_DIR}"
"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install -e "${RUNTIME_DIR}"
"${VENV_DIR}/bin/python" -m pip install \
  "transformers>=4.48,<5" \
  "librosa>=0.10,<1" \
  "Pillow>=10,<12" \
  "imageio>=2.34,<3" \
  "imageio-ffmpeg>=0.5,<1"

cp "$(dirname "$0")/presenter_pipeline.py" "${PIPELINE_PATH}"
chmod 755 "${PIPELINE_PATH}"

# The pipeline only needs Whisper's feature-extractor configuration locally;
# the actual Whisper encoder is part of the downloaded LongCat MLX weights.
"${VENV_DIR}/bin/hf" download openai/whisper-large-v3 \
  --include preprocessor_config.json \
  --local-dir "${WHISPER_FEATURE_DIR}"

# This manifest is the source of truth for the worker's selected model. The
# adapter verifies every field against its own allowlisted model table before
# loading weights, so a copied or mixed model directory cannot become ready.
cat > "${MODEL_MANIFEST}.tmp" <<EOF
{
  "variant": "${MODEL_VARIANT}",
  "runtimeVariant": "${RUNTIME_VARIANT}",
  "repository": "${MODEL_REPOSITORY}",
  "revision": "${MODEL_REVISION}",
  "directory": "${MODEL_DIR}",
  "label": "${MODEL_LABEL}",
  "runtimeCommit": "${RUNTIME_COMMIT}"
}
EOF
mv "${MODEL_MANIFEST}.tmp" "${MODEL_MANIFEST}"

if [[ "${DOWNLOAD_MODEL}" == "1" ]]; then
  mkdir -p "${MODEL_DIR}"
  "${VENV_DIR}/bin/hf" download "${MODEL_REPOSITORY}" \
    --revision "${MODEL_REVISION}" \
    --local-dir "${MODEL_DIR}"
else
  echo "Model download skipped. Download ${MODEL_REPOSITORY} into:"
  echo "  ${MODEL_DIR}"
  "${VENV_DIR}/bin/python" -c "import mlx; print('MLX runtime import: ok')"
fi

if [[ "${DOWNLOAD_MODEL}" == "1" ]]; then
  "${VENV_DIR}/bin/python" "${PIPELINE_PATH}" --check
fi
echo
echo "LongCat MLX presenter runtime installed."
echo "Selected presenter model: ${MODEL_LABEL} (${MODEL_VARIANT}, revision ${MODEL_REVISION})."
echo "Plan for at least ${MIN_DISK_GB} GB free disk space for this model."
echo "Reconnect the signed Studio worker so its readiness report is refreshed."