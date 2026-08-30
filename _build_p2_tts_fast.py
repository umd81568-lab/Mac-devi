#!/usr/bin/env python3
"""FINAL FAST TTS build: all deps pre-installed, --no-build-isolation,
   env var override of ALL baked-in sysconfig paths."""
import subprocess, sys, os, shutil
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
SYM = Path("/tmp/bhashamedia_conda")
SYM_PY = str(SYM / "bin/python")
CC = str(SYM / "bin/clang")
CXX = str(SYM / "bin/clang++")

# SYSCONFIG OVERRIDE: Force CPython's Makefile vars (CFLAGS, LDFLAGS, INCLDUE)
# to be recalculated from /tmp/bhashamedia_conda INSTEAD of original space path.
# CPython sysconfig.get_config_var() reads these from Makefile inside the env;
# override them at process-level BEFORE setuptools builds extensions.
ENV = os.environ.copy()
for k in list(ENV.keys()):
    if str(ROOT) in ENV.get(k, ""):
        ENV[k] = ENV[k].replace(str(ROOT), str(SYM))

SYSPATH = str(SYM / "bin") + ":" + str(SYM / "condabin") + ":" + ENV.get("PATH","")
ENV.update({
    "PATH": SYSPATH,
    "CONDA_PREFIX": str(SYM),
    "VIRTUAL_ENV": "",
    "CC": CC,
    "CXX": CXX,
    "CPPFLAGS": f"-I{SYM}/include -I{SYM}/include/python3.11",
    "CFLAGS":   f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2",
    "CXXFLAGS": f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2 -std=c++17",
    "LDFLAGS":  f"-L{SYM}/lib",
    "CPATH":    f"{SYM}/include",
    "C_INCLUDE_PATH":  f"{SYM}/include:{SYM}/include/python3.11",
    "CPLUS_INCLUDE_PATH": f"{SYM}/include:{SYM}/include/python3.11",
    "LIBRARY_PATH": f"{SYM}/lib",
    "DYLD_LIBRARY_PATH": f"{SYM}/lib",
    "PYTHONNOUSERSITE": "1",
    "PYTHONDONTWRITEBYTECODE": "1",
    "CMAKE_INSTALL_PREFIX": str(SYM),
    "CMAKE_PREFIX_PATH":  str(SYM),
})

def run(cmd, timeout=900):
    print("\n$", " ".join(cmd)[:300])
    r = subprocess.run(cmd, cwd=str(SYM), env=ENV, capture_output=True, text=True, timeout=timeout)
    print("  exit =", r.returncode)
    tail = (r.stdout + "\n---\n" + r.stderr).replace("\n", " ")[-1200:]
    print("  tail:", tail)
    return r

# Confirm sysconfig include path via sym-python
r = run([SYM_PY, "-c",
    "import sysconfig; print('CONFIG include=',sysconfig.get_config_var('INCLUDEPY')); print('  CC =', sysconfig.get_config_var('CC')); print('  CFLAGS =', (sysconfig.get_config_var('CFLAGS') or '')[:200])"])

# INSTALL with NO build isolation → reuses already-installed cmake/clang/cython/numpy
print("\n=== FINAL TTS 0.22.0 install --no-build-isolation ===")
r = run([SYM_PY, "-m", "pip", "install", "--no-build-isolation",
         "--no-cache-dir", "--progress-bar", "off",
         "TTS==0.22.0"], timeout=1800)
if r.returncode != 0:
    # Try with build iso but with same env
    r = run([SYM_PY, "-m", "pip", "install", "--no-cache-dir",
             "--progress-bar", "off", "TTS==0.22.0"], timeout=3600)

# Sanity
r = run([SYM_PY, "-c",
    "from TTS.api import TTS; lst = TTS.list_models() or []; "
    "xtts = [m for m in lst if 'xtts_v2' in m.lower()]; print('TTS.__version__:', __import__('TTS').__version__); print('XTTS count:', len(xtts)); print('Sample:', xtts[:5])"])
sys.exit(r.returncode)
