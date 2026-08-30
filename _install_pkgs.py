#!/usr/bin/env python3
import subprocess, sys, os
ENV = "/Users/jui/Documents/trae_projects/local agent/conda_env"
PY = f"{ENV}/bin/python"
PKGS_CORE = [
    "gradio==4.44.0", "faster-whisper==1.0.3", "edge-tts==6.1.12",
    "pydub==0.25.1", "moviepy==2.1.1", "opencv-python==4.10.0.84",
    "Pillow==10.4.0", "numpy==1.26.4", "scipy==1.14.1", "soundfile==0.12.1",
    "librosa==0.10.2.post1", "sounddevice==0.5.0", "pydantic==2.9.2",
    "fastapi==0.112.2", "python-dotenv==1.0.1", "nltk==3.9.1",
    "sentencepiece==0.2.0", "tokenizers==0.19.1", "huggingface-hub==0.24.6",
]
PKGS_TORCH = [
    "torch==2.7.0", "torchvision==0.22.0", "torchaudio==2.7.0",
]
PKGS_OPTIONAL_TTS = ["TTS"]

def run(*args, **kwargs):
    print(f"\n$ {' '.join(args[:3])}...")
    return subprocess.run([PY, "-m", "pip", "install",
                           "--progress-bar", "off", "--no-cache-dir"] + list(args), **kwargs)

print("====== STEP 1: Install CORE packages ======")
r = run(*PKGS_CORE)
if r.returncode != 0:
    print("CORE INSTALL FAIL")
    sys.exit(1)
print("OK")

print("\n====== STEP 2: Install TORCH Apple Silicon CPU wheel (runs via MPS) ======")
r = run(*PKGS_TORCH, "--index-url", "https://download.pytorch.org/whl/cpu",
      "--force-reinstall", "--no-deps")
print(f"Torch install exit: {r.returncode}")

print("\n====== STEP 3: Optional — install TTS latest for XTTS clone ======")
r = run(*PKGS_OPTIONAL_TTS, timeout=900)
if r.returncode != 0:
    print("\n*** TTS build skipped — voice cloning tab will show install hint, rest OK")
else:
    print("TTS installed!")

print("\n====== DONE ======")
