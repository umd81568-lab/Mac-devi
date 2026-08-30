#!/usr/bin/env python3
"""Smoke-test: 1) Edge TTS v7.2.8, 2) Local MMS Bangla TTS."""
import sys, os, asyncio, traceback
from pathlib import Path
ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
sys.path.insert(0, str(ROOT / "app"))
PYPATH = f"{ROOT}/conda_env/bin"
os.environ["PATH"] = f"{PYPATH}:{os.environ.get('PATH','')}"
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

APP = ROOT / "app"
OUT = APP / "outputs"
OUT.mkdir(exist_ok=True)

import importlib.util
spec = importlib.util.spec_from_file_location("app_main", str(APP / "app.py"))
mod = importlib.util.module_from_spec(spec)
sys.modules["app_main"] = mod
spec.loader.exec_module(mod)
print("[OK] app.py imported without crash")

bangla = "আমার নাম রফিক। আমি বাংলায় কথা বলি। এটি একটি পরীক্ষা।"

print("\n=== Test A: Edge TTS v7 upgraded ===")
try:
    path, msg = asyncio.run(mod.edge_tts_generate(bangla, "bn-BD-RafiqNeural"))
    sym = "✅" if path else "❌"
    sz = Path(path).stat().st_size if path else 0
    print(f"{sym} Edge TTS result: {msg}")
    if path:
        print(f"{sym}   Output: {path}  ({sz} bytes)")
except Exception as e:
    print(f"❌ Edge TTS EXCEPTION: {type(e).__name__}: {e}")
    traceback.print_exc(limit=3)

print("\n=== Test B: Local MMS Bangla TTS (facebook/mms-tts-ben) ===")
try:
    path, msg = mod.local_bangla_tts(bangla, 0, 1.0)
    sym = "✅" if path else "❌"
    sz = Path(path).stat().st_size if path else 0
    print(f"{sym} Local MMS result: {msg}")
    if path:
        print(f"{sym}   Output: {path}  ({sz} bytes)")
except Exception as e:
    print(f"❌ Local MMS EXCEPTION: {type(e).__name__}: {e}")
    traceback.print_exc(limit=5)
