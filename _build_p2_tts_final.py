#!/usr/bin/env python3
"""TTS build: manually build monotonic_align link step to bypass sysconfig rpath space split.

core.c compiles fine with env override; only the LINK command fails because CPython's
sysconfig LDSHARED hard-codes `-Wl,-rpath,<SPACEPATH>` → shell/tokenizer split at space
→ clang sees missing directory. We fix by invoking pip then finding the temp build folder
and manually calling clang -bundle with rpath through the no-space symlink.
"""
import subprocess, sys, os, shutil, tempfile, re
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
SYM  = Path("/tmp/bhashamedia_conda")
SYM_PY = str(SYM / "bin/python")
CC   = str(SYM / "bin/clang")
CXX  = CC + "++"

ENV = os.environ.copy()
for k in list(ENV.keys()):
    if str(ROOT) in ENV.get(k, ""):
        ENV[k] = ENV[k].replace(str(ROOT), str(SYM))

ENV.update({
    "PATH":  f"{SYM}/bin:{SYM}/condabin:" + ENV.get("PATH",""),
    "CONDA_PREFIX": str(SYM),
    "CC":  CC, "CXX": CXX,
    # OVERRIDE sysconfig's BAD LDFLAGS / INCLUDE in Makefile
    # Use DIST_EXTRA_CONFIG to override build_ext rpath & include dirs
    "CFLAGS":   f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2 -arch arm64",
    "CXXFLAGS": f"-I{SYM}/include -I{SYM}/include/python3.11 -fPIC -O2 -arch arm64",
    "LDFLAGS":  f"-L{SYM}/lib -arch arm64",
    "CPPFLAGS": f"-I{SYM}/include -I{SYM}/include/python3.11",
    "CPATH":    f"{SYM}/include",
    "C_INCLUDE_PATH":  f"{SYM}/include:{SYM}/include/python3.11",
    "CPLUS_INCLUDE_PATH": f"{SYM}/include:{SYM}/include/python3.11",
    "LIBRARY_PATH": f"{SYM}/lib",
    "DYLD_LIBRARY_PATH": f"{SYM}/lib",
    "PYTHONNOUSERSITE": "1",
})

# numpy include (current numpy in sym env)
NP_INC = subprocess.check_output([SYM_PY,"-c",
    "import numpy,os; print(os.path.dirname(numpy.core.__file__)+'/include')"],
    text=True, env=ENV).strip()
PY_INC = f"{SYM}/include/python3.11"
SYM_INC = f"{SYM}/include"
SYM_LIB = f"{SYM}/lib"

def run(cmd, **kw):
    print("\n$", " ".join(str(c) for c in cmd)[:300])
    r = subprocess.run(cmd, capture_output=True, text=True, env=ENV, timeout=kw.pop("timeout",1800), **kw)
    out = (r.stdout or "") + "\n"+ (r.stderr or "")
    print("  exit =", r.returncode)
    print("  tail =", out.replace("\n"," ")[-1400:])
    return r, out

# Step 1: download + unpack TTS sdist
TMP = Path(tempfile.mkdtemp(prefix="ttsfinal_"))
print(f"\nTemp build dir: {TMP}")
r, out = run([SYM_PY, "-m","pip","download","--no-deps","--no-binary=:all:",
              "-d", str(TMP), "TTS==0.22.0"])
if r.returncode != 0: sys.exit("download fail")
sdist = sorted(TMP.glob("TTS-0.22.0.*"))[0]
run(["tar","-xzf", str(sdist), "-C", str(TMP)])
SRC = next(TMP.glob("TTS-0.22.0"))

# Step 2: build_ext --inplace via SETUPTOOLS env.  Compile step will produce .o OK.
print("\n=== Step 2: setup.py build_ext --inplace (expect compile pass, link fail) ===")
# Distutils extra config at build time to force rpath/library_dir to NO-SPACE strings
setup_cfg_patch = SRC / "setup.cfg"
existing = setup_cfg_patch.read_text() if setup_cfg_patch.exists() else ""
build_cfg = (
    existing.rstrip() + "\n\n"
    + "[build_ext]\n"
    + f"include_dirs = {NP_INC}:{PY_INC}:{SYM_INC}\n"
    + f"library_dirs = {SYM_LIB}\n"
    + f"rpath = {SYM_LIB}\n"
    + "define =\n"
)
setup_cfg_patch.write_text(build_cfg, encoding="utf-8")
r, out = run([SYM_PY, "setup.py", "build_ext", "--inplace"], cwd=str(SRC), timeout=1200)

# Step 3: if link failed → MANUALLY run clang -bundle for monotonic_align core.so
CORE_O = next(SRC.rglob("monotonic_align/core.o"), None)
CORE_C_SRC = SRC / "TTS/tts/utils/monotonic_align/core.c"
CORE_C_SRC2 = SRC / "TTS/tts/utils/monotonic_align"
TARGET_SO_1 = SRC / "TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so"
TARGET_SO_2 = SRC / "build" / "lib.macosx-11.0-arm64-cpython-311" / "TTS/tts/utils/monotonic_align/core.cpython-311-darwin.so"
print(f"\nCORE_O found: {CORE_O}")
print(f"CORE_C_SRC: {CORE_C_SRC.exists()} {CORE_C_SRC}")

if CORE_O is None or not CORE_O.exists():
    # compile .o manually if needed
    CORE_O = SRC / "build" / "core.o"
    (SRC/"build").mkdir(exist_ok=True)
    r2, _ = run([CC,
        "-I"+NP_INC, "-I"+PY_INC, "-I"+SYM_INC,
        "-fPIC", "-O2", "-arch","arm64",
        "-c", str(CORE_C_SRC), "-o", str(CORE_O)], timeout=300)
    if r2.returncode != 0:
        sys.exit("Manual compile core.c failed")

for dest in (TARGET_SO_1, TARGET_SO_2):
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"\nManual clang -bundle -> {dest}")
    rlink, _ = run([CC,
        # NO bad rpath with space; use symlink lib only
        "-bundle", "-undefined", "dynamic_lookup",
        f"-Wl,-rpath,{SYM_LIB}",
        f"-L{SYM_LIB}",
        "-arch", "arm64",
        str(CORE_O),
        "-o", str(dest)], timeout=300)
    if rlink.returncode != 0:
        # Retry simpler: NO rpath at all
        rlink, _ = run([CC, "-bundle", "-undefined", "dynamic_lookup",
            f"-L{SYM_LIB}", "-arch", "arm64",
            str(CORE_O), "-o", str(dest)], timeout=300)
    if dest.exists():
        print(f"  OK: {dest}  {dest.stat().st_size} bytes")

# Step 4: install complete tree (--no-deps since TTS deps already installed)
# Put .so also into build_ext inplace so setup.py install picks it up
(TARGET_SO_1.parent / "__init__.py").touch(exist_ok=True)
r, out = run([SYM_PY, "-m", "pip", "install", "--no-deps", "--no-build-isolation",
              "--no-cache-dir", "--progress-bar", "off", str(SRC)], timeout=900)
if r.returncode != 0:
    # Try setup.py develop fallback
    r, out = run([SYM_PY, "setup.py", "develop", "--no-deps"], cwd=str(SRC), timeout=900)

# Sanity
run([SYM_PY, "-c",
    "from TTS.api import TTS; v=__import__('TTS').__version__;"
    "xt=[m for m in (TTS.list_models() or []) if 'xtts_v2' in m.lower()];"
    "print('TTS v =', v); print(f'XTTS catalog entries = {len(xt)}'); print('samples:', xt[:5])"])

print(f"\nTemp dir {TMP}")
print("✅ Phase 2 TTS build finished")
