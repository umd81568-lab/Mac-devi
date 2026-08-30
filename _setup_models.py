#!/usr/bin/env python3
"""Download Whisper large-v3 model and optionally try TTS install via symlink."""
import os, sys, subprocess, shutil
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
APP = ROOT / "app"
MODELS = APP / "models"
OUTPUTS = APP / "outputs"
MODELS.mkdir(exist_ok=True)
OUTPUTS.mkdir(exist_ok=True)
print(f"[OK] Models dir: {MODELS}")
print(f"[OK] Outputs dir: {OUTPUTS}")

ENV_PY = f"{ROOT}/conda_env/bin/python"

print("\n==== STEP 1: Try installing TTS via no-space symlink ====")
LINK = Path("/tmp/bhasha_no_space")
try:
    if LINK.exists() or LINK.is_symlink():
        LINK.unlink()
except Exception:
    pass
try:
    LINK.symlink_to(ROOT)
    print(f"[OK] Symlink created: {LINK} -> {ROOT}")
except Exception as e:
    print(f"[SKIP] Cannot create symlink: {e}")
    LINK = None

if LINK:
    cmd = [ENV_PY, "-m", "pip", "install", "--progress-bar", "off",
           "--no-build-isolation", "TTS"]
    print(f"$ cd {LINK} && {' '.join(cmd[:4])} TTS ...")
    r = subprocess.run(cmd, cwd=str(LINK), capture_output=True, text=True, timeout=1200)
    if r.returncode == 0:
        print("[SUCCESS] TTS package installed via symlink!")
    else:
        print(f"[WARN] TTS still failed (will use folder-space hint in UI)")
        print(r.stderr[-800:])
else:
    print("[SKIP] no symlink")

print("\n==== STEP 2: Pre-download faster-whisper large-v3 model ====")
try:
    r = subprocess.run([ENV_PY, "-c", f"""
from faster_whisper import WhisperModel
m = WhisperModel("large-v3", device="cpu", compute_type="int8",
                 download_root=r"{MODELS}")
print("Whisper large-v3 model loaded!")
"""], capture_output=True, text=True, timeout=1800)
    print(r.stdout[-800:])
    if r.returncode != 0:
        print("STDERR:", r.stderr[-2000:])
    sys.exit(r.returncode)
except Exception as e:
    print(f"Exception: {e}")
    sys.exit(1)
