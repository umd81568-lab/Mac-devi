#!/usr/bin/env python3
"""Phase 3: NLTK + Whisper large-v3 + XTTS-v2 model downloads."""
import subprocess, sys, os
from pathlib import Path

ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
SYM_PY = "/tmp/bhashamedia_conda/bin/python"
APP = ROOT / "app"
(APP / "models").mkdir(exist_ok=True)
(APP / "outputs").mkdir(exist_ok=True)
(APP / "nltk_data").mkdir(exist_ok=True)

# 3.1 NLTK
env = os.environ.copy()
env["NLTK_DATA"] = str(APP / "nltk_data")
print("==== 3.1 NLTK punkt + punkt_tab ====")
r = subprocess.run([SYM_PY, "-c",
    "import nltk; nltk.download('punkt'); nltk.download('punkt_tab')"],
    capture_output=True, text=True, env=env, timeout=600)
print(r.stdout[-300:])
if r.returncode != 0: print(r.stderr[-300:])
print("nltk dir:", list((APP/"nltk_data").glob("tokenizers/*")))

# 3.2 Whisper large-v3 Systran (CTranslate2 format)
WHISPER_CACHE = str(APP / "models" / "whisper-large-v3")
print("\n==== 3.2 Systran/faster-whisper-large-v3 -> local cache ====")
r = subprocess.run([SYM_PY, "-c", f"""
from huggingface_hub import snapshot_download
snapshot_download("Systran/faster-whisper-large-v3", local_dir=r"{WHISPER_CACHE}",
                  local_dir_use_symlinks=False, resume_download=True)
print("OK size:", sum(f.stat().st_size for f in Path(r"{WHISPER_CACHE}").rglob("*") if f.is_file()))
"""], capture_output=True, text=True, timeout=2400)
print(r.stdout[-500:])
if r.returncode != 0: print(r.stderr[-1500:])

# 3.3 XTTS-v2  (coqui/XTTS-v2 main model + vocoder)
XTTS_CACHE = str(APP / "models" / "xtts_v2")
print("\n==== 3.3 coqui/XTTS-v2 -> app/models/xtts_v2 ====")
r = subprocess.run([SYM_PY, "-c", f"""
from huggingface_hub import snapshot_download
snapshot_download("coqui/XTTS-v2", local_dir=r"{XTTS_CACHE}",
                  local_dir_use_symlinks=False, resume_download=True)
print("OK size:", sum(f.stat().st_size for f in Path(r"{XTTS_CACHE}").rglob("*") if f.is_file()))
print("Files:", [p.name for p in Path(r"{XTTS_CACHE}").glob("*")])
"""], capture_output=True, text=True, timeout=3600)
print(r.stdout[-500:])
if r.returncode != 0: print(r.stderr[-1500:])

# 3.4 HF_HUB_OFFLINE=1 sanity — can we load whisper from local only?
print("\n==== 3.4 Offline load sanity ====")
r = subprocess.run([SYM_PY, "-c", f"""
import os; os.environ["HF_HUB_OFFLINE"]="1"
from faster_whisper import WhisperModel
m = WhisperModel("large-v3", device="cpu", compute_type="int8",
                 download_root=r"{str(APP/'models')}")
segs, info = m.transcribe("/dev/null" if os.path.exists("/dev/null") else r"{str(APP)}/requirements.txt", language="bn", vad_filter=False)
list(segs)
print(f"Whisper OFFLINE OK lang_detected={info.language}")
"""], capture_output=True, text=True, timeout=600)
print(r.stdout[-500:])
if r.returncode != 0: print(r.stderr[-1500:])
print("\n✅ Phase 3 models done")
