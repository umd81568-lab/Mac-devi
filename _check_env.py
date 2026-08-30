#!/usr/bin/env python3
"""Quick sanity: whisper offline load + TTS import."""
import os, sys
from pathlib import Path
ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["NLTK_DATA"] = str(ROOT / "app" / "nltk_data")
MODELS = ROOT / "app" / "models"
WHISPER_DIR = MODELS / "whisper-large-v3"
XTTS_DIR = MODELS / "xtts_v2"

print(f"WHISPER {WHISPER_DIR} exists {WHISPER_DIR.exists()} size {sum(f.stat().st_size for f in WHISPER_DIR.rglob('*') if f.is_file())/1e9:.2f} GB")
print(f"XTTS    {XTTS_DIR}    exists {XTTS_DIR.exists()} size {sum(f.stat().st_size for f in XTTS_DIR.rglob('*') if f.is_file())/1e9:.2f} GB")

print("\n[1] load faster-whisper OFFLINE cpu int8 ...")
from faster_whisper import WhisperModel
m = WhisperModel(str(WHISPER_DIR), device="cpu", compute_type="int8")
segs, info = m.transcribe(str(ROOT/"app/requirements.txt"), language="bn", vad_filter=False)
list(segs)
print(f"  OK: lang={info.language}")

print("\n[2] TTS import check...")
try:
    from TTS.api import TTS
    v = __import__("TTS").__version__
    models = TTS.list_models() or []
    xtts = [x for x in models if 'xtts_v2' in x.lower()]
    print(f"  OK TTS v={v} XTTS catalog entries={len(xtts)} sample={xtts[:3]}")
    sys.exit(0)
except Exception as e:
    print(f"  NOT YET: {type(e).__name__}: {str(e)[:150]}")
    sys.exit(1)
