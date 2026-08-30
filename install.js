module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      method: "shell.run",
      params: {
        message: [
          "mkdir -p app/models app/outputs app/nltk_data"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        conda: {
          path: "conda_env",
          python: "python=3.11.9"
        },
        message: [
          "conda install -y -c conda-forge 'ffmpeg>=9' git-lfs cmake pkg-config clang_osx-arm64 cxx-compiler"
        ]
      },
      next: "symlink"
    },
    // Auto-create /tmp/bhashamedia_conda no-space symlink if project folder has space character
    // TTS 0.22 monotonic_align C extension clang -isystem fails without this on macOS paths with spaces.
    {
      id: "symlink",
      method: "shell.run",
      params: {
        message: [
          "SYM=/tmp/bhashamedia_conda; SRC=\"{{cwd}}/conda_env\"; rm -rf \"$SYM\"; ln -sfn \"$SRC\" \"$SYM\"; echo \"Symlink: $SYM -> $(readlink $SYM)\"; ls -la \"$SYM/bin/python\""
        ]
      },
      next: "core"
    },
    {
      id: "core",
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        message: [
          "uv pip install -r requirements.txt"
        ]
      },
      next: "torch"
    },
    {
      id: "torch",
      method: "script.start",
      params: {
        uri: "torch.js",
        args: {
          conda: "conda_env",
          path: "app"
        }
      },
      next: "tts"
    },
    // TTS==0.22.0 SEPARATE build via ULTIMATE recipe:
    // BUG FIX: conda python 3.11 sysconfig HARDCODES -isystem/-Wl,-rpath args with literal SPACES
    // from env path ("local agent") → ANY setuptools/pip C extension build splits tokens & FAILS link.
    // FIX: git clone src → cythonize monotonic_align/core.pyx → clang compile/link ONLY with /tmp no-space paths
    // → then pip install --no-deps --no-build-isolation (skips rebuild since .so already in tree).
    // If this block fails, user clicks Update in Pinokio which re-runs, or runs _build_p2_tts_ultimate.py manually.
    {
      id: "tts",
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        env: {
          "SYM":            "/tmp/bhashamedia_conda",
          "SYM_PY":         "/tmp/bhashamedia_conda/bin/python",
          "CC":             "/tmp/bhashamedia_conda/bin/clang",
          "CXX":            "/tmp/bhashamedia_conda/bin/clang++",
          "CONDA_PREFIX":   "/tmp/bhashamedia_conda",
          "PATH":           "/tmp/bhashamedia_conda/bin:/tmp/bhashamedia_conda/condabin:{{cwd}}/conda_env/bin:{{cwd}}/conda_env/condabin:$PATH",
          "CPATH":          "/tmp/bhashamedia_conda/include",
          "C_INCLUDE_PATH": "/tmp/bhashamedia_conda/include:/tmp/bhashamedia_conda/include/python3.11",
          "CPLUS_INCLUDE_PATH": "/tmp/bhashamedia_conda/include:/tmp/bhashamedia_conda/include/python3.11",
          "LIBRARY_PATH":   "/tmp/bhashamedia_conda/lib",
          "DYLD_LIBRARY_PATH": "/tmp/bhashamedia_conda/lib",
          "CPPFLAGS":       "-I/tmp/bhashamedia_conda/include -I/tmp/bhashamedia_conda/include/python3.11",
          "CFLAGS":         "-I/tmp/bhashamedia_conda/include -I/tmp/bhashamedia_conda/include/python3.11 -fPIC -O2 -arch arm64",
          "CXXFLAGS":       "-I/tmp/bhashamedia_conda/include -I/tmp/bhashamedia_conda/include/python3.11 -fPIC -O2 -arch arm64 -std=c++17",
          "LDFLAGS":        "-L/tmp/bhashamedia_conda/lib -arch arm64"
        },
        message: [
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; CC=$SYM/bin/clang; NP_INC=$($SYM_PY -c \"import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')\"); PY_INC=$SYM/include/python3.11; SYM_INC=$SYM/include; SYM_LIB=$SYM/lib; echo \"NP_INC=$NP_INC\"; echo \"python=$($SYM_PY --version 2>&1)\"; $SYM_PY -m pip install --quiet cython numpy==1.26.4 'setuptools>=69' wheel scikit-learn numba pandas trainer gruut==2.2.3 bangla bnnumerizer bnunicodenormalizer 2>&1 | tail -5",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; CC=$SYM/bin/clang; NP_INC=$($SYM_PY -c \"import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')\"); PY_INC=$SYM/include/python3.11; SYM_INC=$SYM/include; SYM_LIB=$SYM/lib; TMP=$(mktemp -d /tmp/ttsult_XXXXXX); SRC=$TMP/TTS-0.22.0; echo \"TMP=$TMP\"; (cd $TMP && curl -fsSL --retry 5 --connect-timeout 60 -o TTS-0.22.0.tar.gz https://files.pythonhosted.org/packages/08/8d/11bbef56b65c42b0ef547845cf4bb6b52b3cc14ca7cc5d08ca4747b3dd2d/TTS-0.22.0.tar.gz && tar -xzf TTS-0.22.0.tar.gz) || (cd $TMP && git -c advice.detachedHead=false clone --depth 1 --branch v0.22.0 https://github.com/coqui-ai/TTS.git TTS-0.22.0); ls $SRC/setup.py",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; CC=$SYM/bin/clang; NP_INC=$($SYM_PY -c \"import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')\"); PY_INC=$SYM/include/python3.11; SYM_INC=$SYM/include; SYM_LIB=$SYM/lib; TMP=$(ls -td /tmp/ttsult_* 2>/dev/null | head -1); SRC=$TMP/TTS-0.22.0; MONO=$SRC/TTS/tts/utils/monotonic_align; mkdir -p $SRC/build $SRC/build/lib; [ -f $MONO/core.c ] || $SYM_PY -c \"from Cython.Build import cythonize; cythonize([r'$MONO/core.pyx'])\"; $CC -I$NP_INC -I$PY_INC -I$SYM_INC -fPIC -O2 -arch arm64 -c $MONO/core.c -o $SRC/build/core.o && echo \"COMPILE OK size=$(stat -f%z $SRC/build/core.o)\"",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; CC=$SYM/bin/clang; SYM_LIB=$SYM/lib; TMP=$(ls -td /tmp/ttsult_* 2>/dev/null | head -1); SRC=$TMP/TTS-0.22.0; MONO=$SRC/TTS/tts/utils/monotonic_align; mkdir -p $SRC/build/lib.macosx-11.0-arm64-cpython-311/TTS/tts/utils/monotonic_align; for DEST in $SRC/build/lib.macosx-11.0-arm64-cpython-311/TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so $MONO/core.cpython-311-darwin.so; do $CC -bundle -undefined dynamic_lookup -L$SYM_LIB -Wl,-rpath,$SYM_LIB -arch arm64 $SRC/build/core.o -o $DEST || $CC -bundle -undefined dynamic_lookup -L$SYM_LIB -arch arm64 $SRC/build/core.o -o $DEST; done; ls -la $MONO/core.cpython-311-darwin.so",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; TMP=$(ls -td /tmp/ttsult_* 2>/dev/null | head -1); SRC=$TMP/TTS-0.22.0; cd $SRC && $SYM_PY -m pip install --no-deps --no-build-isolation --no-cache-dir --force-reinstall --progress-bar off . 2>&1 | tail -15",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; TMP=$(ls -td /tmp/ttsult_* 2>/dev/null | head -1); SRC=$TMP/TTS-0.22.0; MONO=$SRC/TTS/tts/utils/monotonic_align; SPP=$($SYM_PY -c \"import site; print(site.getsitepackages()[0])\"); TGT=$SPP/TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so; mkdir -p $(dirname $TGT); [ -f $TGT ] || cp $MONO/core.cpython-311-darwin.so $TGT; ls -la $TGT; echo \"site-so size=$(stat -f%z $TGT 2>/dev/null || echo missing)\"",
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; HF_HUB_OFFLINE=1 $SYM_PY -c \"import sys,os; from TTS.api import TTS; v=__import__('TTS').__version__; models=TTS.list_models() or []; xt=[m for m in models if 'xtts_v2' in m.lower()]; print('TTS v=',v); print('XTTS entries=',len(xt),'sample=',xt[:3]); from TTS.tts.utils.monotonic_align.core import maximum_path; print('monotonic_align OK')\" 2>&1 | tail -20"
        ]
      },
      next: "nltk"
    },
    {
      id: "nltk",
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        env: {
          "NLTK_DATA": "{{cwd}}/app/nltk_data"
        },
        message: [
          "python -c \"import nltk; nltk.download('punkt'); nltk.download('punkt_tab')\""
        ]
      },
      next: "models"
    },
    // ====== Phase 4.5 Tab ⑧⑨⑩ extra installs ======
    // SadTalker v0.0.2 source + GFPGAN src + pip install WITHOUT pulling their
    // pinned old torch/cv2 (incompatible with torch 2.7 / opencv 4.10).  We install
    // with --no-deps after cloning — their pure-Python code works with our existing stack.
    {
      id: "sadtalker_src",
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        message: [
          "SYM=/tmp/bhashamedia_conda; SYM_PY=$SYM/bin/python; echo 'Cloning SadTalker + GFPGAN source trees…'; mkdir -p models; [ -d models/sadtalker_src ] || (git -c advice.detachedHead=false clone --depth 1 --branch v0.0.2 https://github.com/OpenTalker/SadTalker.git models/sadtalker_src 2>&1 | tail -5); [ -d models/gfpgan_src ] || (git -c advice.detachedHead=false clone --depth 1 --branch v1.4 https://github.com/TencentARC/GFPGAN.git models/gfpgan_src 2>&1 | tail -5); echo 'SadTalker src:'; ls models/sadtalker_src/inference.py; echo 'GFPGAN src:'; ls models/gfpgan_src/inference_gfpgan.py; $SYM_PY -m pip install --no-deps --no-build-isolation --force-reinstall ./models/sadtalker_src 2>&1 | tail -5; $SYM_PY -m pip install --no-deps --no-build-isolation --force-reinstall ./models/gfpgan_src 2>&1 | tail -5"
        ]
      },
      next: "models"
    },
    // HF snapshot_download models pre-cached so Tab1/Tab3/Tab8/Tab9/Tab10 work OFFLINE first click (100% trusted local)
    {
      id: "models",
      method: "shell.run",
      params: {
        conda: "conda_env",
        path: "app",
        message: [
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-large-v3', local_dir='models/whisper-large-v3', local_dir_use_symlinks=False, resume_download=True)\"",
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('coqui/XTTS-v2', local_dir='models/xtts_v2', local_dir_use_symlinks=False, resume_download=True)\"",
          // Tab ⑨ SadTalker v0.0.2 CLASSIC split checkpoints (~3.5GB) — vinthony/SadTalker mirror (the one actually used during P5m).
          //   The org repo OpenTalker/SadTalker does NOT exist on HF. vinthony/SadTalker = author mirror hosts the classic split files:
          //   shape_predictor_68 / epoch_20 / BFM_Fitting/ / wav2lip / auido2* / facevid2vid / mapping_* pth.tar files.
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('vinthony/SadTalker', local_dir='models/sadtalker', local_dir_use_symlinks=False, resume_download=True)\"",
          // Tab ⑨ GFPGANv1.4 weights (336MB). The HF repo 'TencentARC/GFPGANv1.4' does NOT exist (only v1.0 at TencentARC/GFPGAN).
          //   The real valid source we used in P5m = GitHub release direct download of GFPGANv1.4.pth (348,632,874 bytes).
          "python -c \"import os, urllib.request; t='models/gfpgan'; os.makedirs(t, exist_ok=True); p=os.path.join(t, 'GFPGANv1.4.pth'); url='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth';\\nif (not os.path.exists(p)) or (os.path.getsize(p) < 340000000): urllib.request.urlretrieve(url, p); print('gfpgan =', p, os.path.getsize(p), 'bytes')\"",
          // Tab ⑩ llama-3.1-8B-instruct Q4_K_M Bangla-capable gguf (~4.9 GB, actual repo = 1/4.6GB). Correct repo id and filename BOTH start with 'Meta-' (bartowski/Meta-Llama-3.1-8B-Instruct-GGUF / Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf). Install previously used wrong non-Meta- prefix → 404 on fresh install.
          "python -c \"from huggingface_hub import hf_hub_download; import os; t='models/llama3_1'; os.makedirs(t, exist_ok=True); p=hf_hub_download('bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', filename='Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', local_dir=t, local_dir_use_symlinks=False); print('llama =', p, os.path.getsize(p)//(1024*1024),'MB')\"",
          // Tab ⑧ CogVideoX-2b THUDM HF weights (~4.5GB)
          "python -c \"from huggingface_hub import snapshot_download; snapshot_download('THUDM/CogVideoX-2b', local_dir='models/cogvideox_2b', local_dir_use_symlinks=False, resume_download=True)\"",
          "echo '--- Model folder sizes ---'; du -sh models/whisper-large-v3 models/xtts_v2 models/sadtalker models/gfpgan models/llama3_1 models/cogvideox_2b 2>/dev/null; echo '--- listing sadtalker weights ---'; ls -la models/sadtalker/ 2>&1 | head -20"
        ]
      }
    }
  ]
}
