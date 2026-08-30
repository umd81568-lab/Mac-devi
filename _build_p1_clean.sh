#!/usr/bin/env bash
# Phase 1: Clean build foundation. Approved plan Phase 1 checklist.
set -e
cd "/Users/jui/Documents/trae_projects/local agent"

# 1.1 Archive old state
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p .archive
[ -f app/app.py ] && cp -f app/app.py ".archive/app.py.bak_${TS}"
[ -d conda_env ] && mv -f conda_env "conda_env_old_backup_${TS}"
echo "[P1.1] Archived: .archive/app.py.bak_${TS} + conda_env_old_backup_${TS}"

# 1.2 Prep symlink placeholder (we make real after conda_env created)
[ -L /tmp/bhashamedia_conda ] && rm -f /tmp/bhashamedia_conda || true

# 1.3 Create conda env python=3.11.9
CONDA="/Users/jui/pinokio/bin/miniforge/bin/conda"
"$CONDA" config --add channels conda-forge 2>/dev/null || true
"$CONDA" create -y -p "$PWD/conda_env" python=3.11.9
"$CONDA" install -y -p "$PWD/conda_env" -c conda-forge \
    "ffmpeg>=9" "git-lfs>=3.5" cmake clang_osx-arm64 cxx-compiler pkg-config

# 1.4 Create symlink AFTER env exists. Verify python resolves.
ln -sfn "$PWD/conda_env" /tmp/bhashamedia_conda
PY="/tmp/bhashamedia_conda/bin/python"
echo "[P1.4] Symlink python: $($PY --version)"
$PY -c "import sys; assert sys.version_info[:2] == (3,11), sys.version"
echo "[P1.4] Python 3.11 via no-space symlink: PASS"

# Verify ffmpeg
echo "[P1.4] ffmpeg: $(./conda_env/bin/ffmpeg -version | head -1)"
