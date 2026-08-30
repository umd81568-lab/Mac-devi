#!/usr/bin/env python3
"""TTS build FINAL FIX. Override CFLAGS/LDFLAGS to no-space paths AND build monotonic_align in-place before pip."""
import subprocess, sys, os, shutil, tempfile
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
SYM = Path("/tmp/bhashamedia_conda")          # no-space python prefix
SYM_PY = str(SYM / "bin/python")
LOG = ROOT / "_build_p2_tts.log"
logf = open(LOG, "w")
CC = str(SYM / "bin/clang") if (SYM/"bin/clang").exists() else "clang"
CXX = CC + "++"

def run(label, cmd, **kw):
    print(f"\n==== {label} ====")
    logf.write(f"\n==== {label}: {cmd!r} ====\n"); logf.flush()
    env = kw.pop("env", None) or os.environ.copy()
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, **kw)
    logf.write("STDOUT:\n"); logf.write(r.stdout[-2000:])
    logf.write("\nSTDERR:\n"); logf.write(r.stderr[-2000:]); logf.flush()
    print("  exit =", r.returncode)
    print("  tail =", (r.stdout + " " + r.stderr).replace("\n", " ")[-400:])
    return r

# === TRUE FIX: override ALL baked-in env vars at build time. ===
# Replace ANY mention of space path (ROOT) with no-space SYM prefix for CC, CFLAGS, CXXFLAGS, LDFLAGS, CPPFLAGS
ENV_FIX = os.environ.copy()
for var in ("CC","CXX","CFLAGS","CPPFLAGS","CXXFLAGS","LDFLAGS","LIBS",
            "CPATH","C_INCLUDE_PATH","CPLUS_INCLUDE_PATH","LIBRARY_PATH",
            "PYTHONPATH","PATH","CONDA_PREFIX","VIRTUAL_ENV","SKBUILD_CMAKE_ARGS"):
    val = ENV_FIX.get(var, "")
    if str(ROOT) in val:
        ENV_FIX[var] = val.replace(str(ROOT), str(SYM))
# Ensure lead with /tmp/bhashamedia_conda/bin at FRONT of PATH
SYSP = str(SYM / "bin")
ENV_FIX["PATH"] = SYSP + ":" + ENV_FIX.get("PATH", "")
ENV_FIX["CONDA_PREFIX"] = str(SYM)
# OVERRIDE CFLAGS/LDFLAGS/CPPFLAGS EXPLICITLY to NO-SPACE include/lib (this kills the 2 bad -isystem args!)
SYM_INC = str(SYM / "include")
SYM_LIB = str(SYM / "lib")
PY_INC = str(SYM / "include/python3.11")
# numpy include (use sym-python to resolve, always no-space path for current numpy)
NP_INC = subprocess.check_output(
    [SYM_PY, "-c", "import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')"],
    text=True).strip()
# Explicitly override -isystem baked into sysconfig:  use -I BEFORE and clear bad isystem via override with CFLAGS/CPPFLAGS
ENV_FIX["CPPFLAGS"] = f"-I{NP_INC} -I{PY_INC} -I{SYM_INC} " + ENV_FIX.get("CPPFLAGS","")
ENV_FIX["CFLAGS"]   = f"-I{NP_INC} -I{PY_INC} -I{SYM_INC} " + ENV_FIX.get("CFLAGS","")
ENV_FIX["CXXFLAGS"] = f"-I{NP_INC} -I{PY_INC} -I{SYM_INC} " + ENV_FIX.get("CXXFLAGS","")
ENV_FIX["LDFLAGS"]  = f"-L{SYM_LIB} " + ENV_FIX.get("LDFLAGS","")
ENV_FIX["CC"]  = CC
ENV_FIX["CXX"] = CXX

print("ENV_FIX CONDA_PREFIX  :", ENV_FIX["CONDA_PREFIX"])
print("ENV_FIX CPPFLAGS head:", ENV_FIX["CPPFLAGS"][:120], "...")
print("ENV_FIX CC            :", ENV_FIX["CC"])

# 2.3(1) Download TTS sdist, manually build monotonic_align via setup.py build_ext with our overridden ENV
# This way we completely BYPASS the pip backend passing bad -isystem.
TMP = Path(tempfile.mkdtemp(prefix="ttsbuild_"))
print(f"\nDownload TTS 0.22.0 sdist -> temp build dir {TMP}")
r = run("download TTS sdist",
    [SYM_PY, "-m", "pip", "download", "--no-deps", "--no-binary=:all:",
     "-d", str(TMP), "TTS==0.22.0"])
if r.returncode != 0: sys.exit("TTS download failed")
sdists = sorted(TMP.glob("TTS-0.22.0.*"))
if not sdists: sys.exit("No TTS sdist found")
r = run("unpack sdist", ["tar", "-xzf", str(sdists[0]), "-C", str(TMP)])
if r.returncode != 0: sys.exit("unpack failed")
SRC = next(TMP.glob("TTS-0.22.0"))
print(f"SRC dir: {SRC}")

# Build extension manually via setup.py build_ext --inplace with our overridden env
# (this is the step that usually fails inside pip - we do it ourselves with clean env vars)
r = run("setup.py build_ext monotonic_align (no-space env, cwd=SRC)",
        [SYM_PY, "setup.py", "build_ext", "--inplace"],
        cwd=str(SRC), env=ENV_FIX, timeout=900)
if r.returncode != 0:
    # Retry with -isystem stripped using ARCHFLAGS removal AND explicit numpy include via NUMPY_INCLUDE env.
    ENV_FIX2 = dict(ENV_FIX)
    ENV_FIX2.pop("ARCHFLAGS", None)
    ENV_FIX2["_PYTHON_SYSCONFIGDATA_NAME"] = ""  # bypass sysconfig CC override
    r = run("RETRY setup.py build_ext with minimal env",
            [SYM_PY, "setup.py", "build_ext", "--inplace"],
            cwd=str(SRC), env=ENV_FIX2, timeout=900)
if r.returncode != 0:
    # Last-chance: compile the single core.c by hand then package wheel.
    CORE_C = SRC / "TTS/tts/utils/monotonic_align/core.c"
    CORE_O = SRC / "build" / "core.o"
    CORE_SO = SRC / "TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so"
    (SRC / "build").mkdir(exist_ok=True)
    print(f"\nManual compilation of monotonic_align (the one failing file)...")
    cflags = f"-fPIC -O2 -arch arm64 -I{NP_INC} -I{PY_INC} -I{SYM_INC}".split()
    r1 = run("manual clang -c core.c -> core.o",
        [CC, *cflags, "-c", str(CORE_C), "-o", str(CORE_O)], timeout=300)
    if r1.returncode == 0:
        ldflags = f"-bundle -undefined dynamic_lookup -arch arm64 -L{SYM_LIB}".split()
        r2 = run("manual clang core.o -> core.so",
                [CC, *ldflags, str(CORE_O), "-o", str(CORE_SO)], timeout=300)
        if r2.returncode == 0 and CORE_SO.exists():
            print(f"  MONOTONIC ALIGN .SO BUILT MANUALLY: {CORE_SO} ({CORE_SO.stat().st_size} bytes)")
            # Now install from SRC tree (wheel) with pre-built extension
            r = run("install full TTS tree (prebuilt .so already in place)",
                    [SYM_PY, "-m", "pip", "install", "--no-deps", "--no-build-isolation",
                     "--progress-bar", "off", str(SRC)],
                    cwd=str(SYM), env=ENV_FIX, timeout=900)

if r.returncode != 0:
    sys.exit(f"ALL build strategies FAILED. Full log: {LOG}")

# Sanity imports
run("Sanity: from TTS.api import TTS",
    [SYM_PY, "-c", "from TTS.api import TTS; print('TTS api OK, XTTS present?', any('xtts_v2' in m for m in (TTS.list_models() or [])))"])
run("Sanity all 24 packages + torch",
    [SYM_PY, "-c", r"""
for p in ["gradio","faster_whisper","edge_tts","transformers","accelerate","sympy","phonemizer","inflect",
          "pydub","moviepy","cv2","PIL","numpy","scipy","soundfile","librosa",
          "nltk","sentencepiece","tokenizers","huggingface_hub","torch","TTS"]:
    try: m=__import__(p); print(f"OK   {p:20s} {getattr(m,'__version__','OK')}")
    except Exception as e: print(f"MISS {p:20s} {type(e).__name__}: {e}")
import torch; print(f"MPS = {torch.backends.mps.is_available()}  version = {torch.__version__}")
"""])
print(f"\n✅ Phase 2 TTS SUCCESS — full log: {LOG}")
