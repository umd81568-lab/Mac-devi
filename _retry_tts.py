#!/usr/bin/env python3
"""Retry TTS install with Cython preinstalled."""
import subprocess
from pathlib import Path
ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
PY = f"{ROOT}/conda_env/bin/python"
LINK = "/tmp/bhasha_no_space"

print("1. Install Cython build tools...")
r = subprocess.run([PY, "-m", "pip", "install", "--progress-bar", "off",
                    "cython", "numpy==1.26.4", "setuptools>=68"],
                   capture_output=True, text=True)
print(r.stdout[-300:])
print(f"exit={r.returncode}")

print("\n2. Retry TTS install via no-space symlink (no --no-build-isolation)...")
r = subprocess.run([PY, "-m", "pip", "install", "--progress-bar", "off", "TTS"],
                   cwd=LINK, capture_output=True, text=True, timeout=1500)
print(r.stdout[-500:])
if r.returncode != 0:
    print("STDERR tail:", r.stderr[-1500:])
print(f"\nTTS install exit={r.returncode}")

print("\n3. Quick import check...")
r2 = subprocess.run([PY, "-c", "import TTS; print('TTS version:', getattr(TTS,'__version__','OK'))"],
                    capture_output=True, text=True)
print(r2.stdout, r2.stderr)
