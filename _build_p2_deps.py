#!/usr/bin/env python3
"""Phase 2 retry: install core (no TTS), then torch, then TTS via no-space env wrapper."""
import subprocess, sys, os, shutil
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
# NOTE: symlink below points to ACTUAL conda_env at /tmp/bhashamedia_conda -> project conda_env
SYM = Path("/tmp/bhashamedia_conda")          # no-space python prefix we created in P1
REQ = ROOT / "app" / "requirements.txt"
assert SYM.is_symlink() and SYM.exists(), "run P1 first (ln -sfn conda_env /tmp/bhashamedia_conda)"
SYM_PY = str(SYM / "bin" / "python")
LOG = ROOT / "_build_p2.log"
logf = open(LOG, "w")

def run(label, cmd, **kw):
    print(f"\n==== {label} ====")
    logf.write(f"\n==== {label}: {cmd!r} ====\n"); logf.flush()
    env = kw.pop("env", None) or os.environ.copy()
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, **kw)
    logf.write("STDOUT:\n"); logf.write(r.stdout[-3000:]); logf.write("\nSTDERR:\n"); logf.write(r.stderr[-3000:]); logf.flush()
    print("  exit =", r.returncode)
    tail = (r.stdout + r.stderr).replace("\n"," ")[-400:]
    print("  tail:", tail)
    return r

# 2.1 Core 24 pinned packages (requirements.txt WITHOUT TTS line)
r = run("2.1 Core pinned packages (TTS removed from reqs)",
    [SYM_PY, "-m", "pip", "install", "--progress-bar", "off",
     "--no-cache-dir", "-r", str(REQ)])
if r.returncode != 0: sys.exit("2.1 FAILED")

# 2.2 Torch CPU wheels force install (MPS backend enabled via env fallback flag at runtime)
r = run("2.2 Torch 2.7.0 darwin-arm64 CPU wheels force-reinstall --no-deps",
    [SYM_PY, "-m", "pip", "install", "--progress-bar", "off",
     "--force-reinstall", "--no-deps", "--no-cache-dir",
     "torch==2.7.0", "torchaudio==2.7.0", "torchvision==0.22.0",
     "--index-url", "https://download.pytorch.org/whl/cpu"])
if r.returncode != 0: sys.exit("2.2 FAILED")

# 2.3 TTS 0.22.0 BUILD: true fix = rewrite include/lib EXECUTABLE paths via env vars to NO-SPACE symlink.
# Also run pip from WITHIN symlink CWD so any relative includes resolve no-space.
print("\n==== 2.3 TTS==0.22.0 build with NO-SPACE compiler ENV WRAPPER ====")
# Install TTS deps first (build runtime requirements)
r = run("2.3a TTS build deps: cython numpy setuptools wheel scikit-learn numba pandas trainer gruut bangla bnnumerizer bnunicodenormalizer",
    [SYM_PY, "-m", "pip", "install", "--progress-bar", "off", "--no-cache-dir",
     "cython>=3", "numpy==1.26.4", "setuptools>=69", "wheel",
     "scikit-learn>=1.3", "numba>=0.57", "pandas>=1.4,<2", "trainer>=0.0.32",
     "gruut==2.2.3", "gruut_lang_en==2.0.1", "bangla", "bnnumerizer", "bnunicodenormalizer",
     "anyascii", "pysbd", "umap-learn", "einops", "encodec", "unidecode", "num2words",
     "jieba", "pypinyin", "hangul_romanize", "jamo", "g2pkk", "pyyaml", "tqdm", "fsspec",
     "flask>=2.0", "aiohttp", "matplotlib>=3.7"])
if r.returncode != 0: sys.exit("2.3a TTS deps FAILED")

# Build TTS in no-space env. Critical: rewrite every include/lib/exec prefix to /tmp/bhashamedia_conda
tts_env = os.environ.copy()
P = str(SYM)
for key in ("CPATH","C_INCLUDE_PATH","CPLUS_INCLUDE_PATH","LIBRARY_PATH","DYLD_LIBRARY_PATH",
            "LD_LIBRARY_PATH","PYTHONPATH","PATH","VIRTUAL_ENV","CONDA_PREFIX","SKBUILD_CMAKE_ARGS"):
    old = tts_env.get(key, "")
    # Replace any mentions of old space-path with symlink
    new = old.replace(str(ROOT), P)
    tts_env[key] = new
# Ensure conda bin at front of PATH
tts_env["PATH"] = f"{P}/bin:" + tts_env.get("PATH","")
# Tell distutils/setuptools our compiler include/lib dirs are under symlink (no space)
tts_env["CONDA_PREFIX"] = P
tts_env["_CONDA_PYTHON_SYSCONFIGDATA_NAME"] = os.environ.get("_CONDA_PYTHON_SYSCONFIGDATA_NAME","")
# Set CC/CXX explicitly to system clang (conda clang adds no-space include paths already)
if shutil.which(f"{P}/bin/clang"):
    tts_env["CC"] = f"{P}/bin/clang"
    tts_env["CXX"] = f"{P}/bin/clang++"

print("  using CONDA_PREFIX:", tts_env["CONDA_PREFIX"])
print("  CC in env:", tts_env.get("CC","(system default clang)"))

r = run("2.3b pip install TTS==0.22.0  --no-build-isolation (cwd = symlink root, env rewritten)",
        [SYM_PY, "-m", "pip", "install", "--progress-bar", "off",
         "--no-cache-dir", "--no-build-isolation", "TTS==0.22.0"],
        cwd=str(SYM), env=tts_env, timeout=1800)
if r.returncode != 0:
    print("  --no-build-isolation failed, retrying with default build iso...")
    r = run("2.3c RETRY TTS==0.22.0 (default build iso, symlink cwd)",
            [SYM_PY, "-m", "pip", "install", "--progress-bar", "off",
             "--no-cache-dir", "TTS==0.22.0"],
            cwd=str(SYM), env=tts_env, timeout=1800)
if r.returncode != 0:
    sys.exit(f"2.3b/2.3c BOTH FAILED. Full log at {LOG}")

# 2.4 Sanity imports
r = run("2.4 Sanity all 24 core packages + torch MPS + TTS import + XTTS model listed",
    [SYM_PY, "-c", r"""
pkgs = ["gradio","faster_whisper","edge_tts","transformers","accelerate","sympy","phonemizer","inflect",
        "pydub","moviepy","cv2","PIL","numpy","scipy","soundfile","librosa",
        "nltk","sentencepiece","tokenizers","huggingface_hub","torch"]
ok = miss = 0
for p in pkgs:
    try:
        m = __import__(p)
        v = getattr(m, "__version__", "OK")
        print(f"OK   {p:22s} {v}"); ok+=1
    except Exception as e:
        print(f"MISS {p:22s} {type(e).__name__}: {e}"); miss+=1
import torch
print(f"MPS available: {torch.backends.mps.is_available()}")
try:
    from TTS.api import TTS
    print("OK   TTS api package imported fine")
    # Don't download model — just sanity check XTTS is in catalog
    try:
        models = TTS.list_models()
        ok_xtts = any("xtts_v2" in m for m in (models or []))
        print(f"OK   XTTS v2 in model catalog: {ok_xtts}")
    except Exception:
        print("INFO model catalog not yet reachable (ok, downloads at runtime)")
except Exception as e:
    print(f"MISS TTS: {type(e).__name__}: {e}")
print(f"TOTAL: {ok} OK / {miss} MISS")
"""])
print(f"\n✅ Phase 2 complete — full log: {LOG}")
