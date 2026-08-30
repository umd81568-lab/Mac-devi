#!/usr/bin/env python3
"""ULTIMATE TTS v0.22 INSTALL: direct git clone or PyPI tarball → patch → manual link monotonic_align.

Why this works when pip fails:
- pip invokes setuptools which uses sysconfig LDFLAGS (which include space-containing -isystem / rpath args baked into the conda python binary)
- we bypass this entirely by:
    1. Downloading src
    2. Patching setup.cfg [build_ext] to only use no-space paths
    3. Running clang compile and link manually for the ONE C extension file
    4. Then `pip install --no-deps --no-build-isolation` (all deps already installed, pure Python rest)
"""
import subprocess, sys, os, shutil, tempfile, re
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
SYM = Path("/tmp/bhashamedia_conda")
SYM_PY = str(SYM/"bin/python")
CC = str(SYM/"bin/clang")
CXX = CC+"++"

TMP = Path(tempfile.mkdtemp(prefix="ttsultimate_"))
SRC = TMP / "TTS-0.22.0"
ENV = os.environ.copy()

# OVERRIDE sysconfig-inherited paths for all child processes (clang compile/link)
for k in list(ENV.keys()):
    if str(ROOT) in ENV.get(k,""): ENV[k] = ENV[k].replace(str(ROOT), str(SYM))

ENV.update({
    "PATH": f"{SYM}/bin:{SYM}/condabin:" + ENV.get("PATH",""),
    "CONDA_PREFIX": str(SYM),
    "CC":  CC, "CXX": CXX,
    "CPPFLAGS":   f"-I{SYM}/include -I{SYM}/include/python3.11",
    "CFLAGS":     f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2 -arch arm64",
    "CXXFLAGS":   f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2 -arch arm64 -std=c++17",
    "LDFLAGS":    f"-L{SYM}/lib -arch arm64",
    "CPATH":      f"{SYM}/include",
    "C_INCLUDE_PATH":       f"{SYM}/include:{SYM}/include/python3.11",
    "CPLUS_INCLUDE_PATH":   f"{SYM}/include:{SYM}/include/python3.11",
    "LIBRARY_PATH": f"{SYM}/lib",
    "DYLD_LIBRARY_PATH": f"{SYM}/lib",
})

NP_INC = subprocess.check_output([SYM_PY,"-c",
    "import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')"],
    text=True, env=ENV).strip()
PY_INC = f"{SYM}/include/python3.11"
SYM_INC = f"{SYM}/include"
SYM_LIB = f"{SYM}/lib"

def run(cmd, **kw):
    print("\n$", " ".join(str(x) for x in cmd)[:300])
    r = subprocess.run(cmd, capture_output=True, text=True, env=ENV, timeout=kw.pop("timeout",1800), **kw)
    out = ((r.stdout or "") + "\n" + (r.stderr or "")).replace("\n", " ")
    print("  exit =", r.returncode)
    print("  tail =", out[-1500:])
    return r

# Step 1: download TTS 0.22.0 sdist (use wget/curl) — PyPI URL is stable
TARBALL_URL = "https://files.pythonhosted.org/packages/08/8d/11bbef56b65c42b0ef547845cf4bb6b52b3cc14ca7cc5d08ca4747b3dd2d/TTS-0.22.0.tar.gz"
TAR = TMP / "TTS-0.22.0.tar.gz"
print(f"Step1 curl PyPI TTS tarball -> {TAR}")
r = run(["curl","-fsSL","--retry","5","--connect-timeout","60","-o",str(TAR),TARBALL_URL])
if r.returncode != 0 or not TAR.exists() or TAR.stat().st_size < 1_000_000:
    # fallback: try via hf-mirror or direct pip with env trick or git
    print("FALLBACK to git clone TTS v0.22.0 tag")
    gr = run(["git","-c","advice.detachedHead=false","clone","--depth","1","--branch","v0.22.0",
              "https://github.com/coqui-ai/TTS.git", str(SRC)])
    if gr.returncode != 0:
        gr2 = run(["git","-c","advice.detachedHead=false","clone","--depth","50",
                   "https://github.com/coqui-ai/TTS.git", str(SRC)])
        if gr2.returncode == 0:
            run(["git","-c","advice.detachedHead=false","checkout","v0.22.0"], cwd=str(SRC))
else:
    print("Untar...")
    run(["tar","-xzf",str(TAR),"-C",str(TMP)])

if not SRC.exists():
    print("FAIL: could not obtain TTS source. Try from pip cache")
    sys.exit(1)

print(f"\nSource at {SRC}. ls setup.py = {(SRC/'setup.py').exists()}")

# Step 2: patch setup.cfg to override build_ext bad paths
scfg = SRC / "setup.cfg"
if scfg.exists():
    content = scfg.read_text(encoding="utf-8")
else:
    content = ""
content += (
    "\n[build_ext]\n"
    f"include_dirs = {NP_INC}:{PY_INC}:{SYM_INC}\n"
    f"library_dirs = {SYM_LIB}\n"
    f"rpath = {SYM_LIB}\n\n"
)
scfg.write_text(content, encoding="utf-8")
# Also patch pyproject.toml: remove build-backend numpy/cython requirements → assume installed
pp = SRC / "pyproject.toml"
if pp.exists():
    ppt = pp.read_text()
    # replace requires with empty
    ppt = re.sub(r'requires\s*=\s*\[.*?\]', 'requires = ["setuptools>=69","wheel"]', ppt, count=1, flags=re.S)
    pp.write_text(ppt)

# Step 3: build_ext — produces .o but link will fail due to rpath space
MONO_DIR = SRC / "TTS/tts/utils/monotonic_align"
CORE_C = MONO_DIR / "core.c"
CORE_PYX = MONO_DIR / "core.pyx"
if not CORE_C.exists() and CORE_PYX.exists():
    # Run cythonize first
    run([SYM_PY, "-c",
         "from Cython.Build import cythonize; cythonize([r'%s'])" % str(CORE_PYX)],
        cwd=str(SRC), timeout=600)

BUILD_O = SRC / "build" / "core.o"
(SRC/"build").mkdir(exist_ok=True)
(SRC/"build"/"lib").mkdir(exist_ok=True)

# compile core.c -> core.o manually (use no-space paths)
print(f"\nStep3a: clang -c {CORE_C.name}")
r = run([CC,
    f"-I{NP_INC}", f"-I{PY_INC}", f"-I{SYM_INC}",
    "-fPIC", "-O2", "-arch","arm64",
    "-c", str(CORE_C), "-o", str(BUILD_O)], timeout=600)
if r.returncode != 0:
    sys.exit("compile core.c -> core.o failed")
print(f"  OK: .o size = {BUILD_O.stat().st_size}")

# Step 4: MANUALLY LINK to produce core.cpython-311-darwin.so
# Do NOT include any baked-in rpath args that reference space folders
TARGET_SO_BUILD = SRC / "build/lib.macosx-11.0-arm64-cpython-311" / "TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so"
TARGET_SO_SRC   = MONO_DIR / "core.cpython-311-darwin.so"
for dest in (TARGET_SO_BUILD, TARGET_SO_SRC):
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = run([CC,
        "-bundle", "-undefined", "dynamic_lookup",
        f"-L{SYM_LIB}",
        # NO rpath args referencing the original space path; only use symlink
        f"-Wl,-rpath,{SYM_LIB}",
        "-arch", "arm64",
        str(BUILD_O), "-o", str(dest)], timeout=600)
    if r.returncode != 0:
        # drop rpath completely; it's not needed since library is in conda standard lib dir
        run([CC, "-bundle","-undefined","dynamic_lookup",
            f"-L{SYM_LIB}","-arch","arm64",
            str(BUILD_O), "-o", str(dest)], timeout=600)
    print(f"  {dest} size = {dest.stat().st_size if dest.exists() else 'MISSING'}")

# put .so next to __init__.py so in-tree import works too
if not TARGET_SO_SRC.exists() and TARGET_SO_BUILD.exists():
    shutil.copy2(TARGET_SO_BUILD, TARGET_SO_SRC)

# Step 5: sanity import — just test loading monotonic_align core module first from SRC tree
print("\nStep 5: Import sanity test of core from SRC tree")
r = run([SYM_PY, "-c",
    "import sys, os; sys.path.insert(0, r'%s')"
    "; os.chdir(r'%s')"
    "; from TTS.tts.utils.monotonic_align.core import maximum_path"
    "; print('monotonic_align core import MAXIMUM_PATH WORKS', maximum_path)" % (str(SRC), str(SRC))],
    timeout=60, cwd=str(SRC))
if r.returncode != 0:
    # Cython file might need .pyx generated first; generate if needed
    print("Import failed, try generating __pycache__ or alternate")
    # Fallback: try pip install anyway, we'll handle missing .so by copying

# Step 6: pip install whole tree with NO BUILD ISOLATION and NO DEPS (deps installed already)
# Since we manually built the only C extension and placed it correctly,
# setuptools will just copy files and not try to rebuild.
print("\nStep 6: pip install --no-deps --no-build-isolation")
r = run([SYM_PY, "-m","pip","install","--no-deps","--no-build-isolation",
         "--no-cache-dir","--force-reinstall","--progress-bar","off", str(SRC)], timeout=1500)
if r.returncode != 0:
    # setup.py develop fallback
    r = run([SYM_PY, "setup.py","develop","--no-deps"], cwd=str(SRC), timeout=1500)

# Step 7: If pip installed but .so MISSING in site-packages, copy manually
spp = subprocess.check_output([SYM_PY,"-c","import site; print(site.getsitepackages()[0])"],
    text=True, env=ENV).strip()
sp_tts_mono = Path(spp) / "TTS" / "tts" / "utils" / "monotonic_align"
target = sp_tts_mono / "core.cpython-311-darwin.so"
if not target.exists() and TARGET_SO_SRC.exists():
    sp_tts_mono.mkdir(parents=True, exist_ok=True)
    shutil.copy2(TARGET_SO_SRC, target)
    print(f"\nCopied .so manually into site: {target} size={target.stat().st_size}")

# Step 8: final sanity
print("\nStep 8: FINAL Sanity (imports + XTTS catalog)")
r = run([SYM_PY, "-c",
    "import sys, os\n"
    "os.environ['HF_HUB_OFFLINE']='1'\n"
    "from TTS.api import TTS\n"
    "v = __import__('TTS').__version__\n"
    "models = TTS.list_models() or []\n"
    "xt = [m for m in models if 'xtts_v2' in m.lower()]\n"
    "print('TTS v =', v)\n"
    "print('XTTS entries =', len(xt))\n"
    "print('Sample =', xt[:5])\n"
    "from TTS.tts.utils.monotonic_align.core import maximum_path\n"
    "print('monotonic_align import WORKS')\n"],
    timeout=300)
print("\n=== PHASE 2 TTS ULTIMATE BUILD FINI ===")
print(f"temp build dir = {TMP}")
sys.exit(r.returncode)
