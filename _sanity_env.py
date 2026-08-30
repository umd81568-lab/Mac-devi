#!/usr/bin/env python3
"""Quick env sanity check (ALL deps installed ok)."""
import os, sys
ROOT = "/Users/jui/Documents/trae_projects/local agent"
os.environ["NLTK_DATA"] = f"{ROOT}/app/nltk_data"
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

try:
    from TTS.tts.utils.monotonic_align import core as mcore
    print(f"✅ monotonic_align .so loaded: {mcore.__file__}  members={[x for x in dir(mcore) if not x.startswith('__')]}")
except Exception as e:
    print(f"❌ monotonic_align: {type(e).__name__}: {e}"); sys.exit(1)

packages_ok = 0
for pname, imp in [
    ("BeamSearchScorer / transformers 4.44", "from transformers import BeamSearchScorer; import transformers as t; print(f'   transformers {t.__version__}')"),
    ("TTS api (XTTS compat)","from TTS.api import TTS; print(f'   TTS {__import__(\"TTS\").__version__}')"),
    ("XTTSConfig class","from TTS.tts.configs.xtts_config import XttsConfig"),
    ("faster-whisper","from faster_whisper import WhisperModel; import faster_whisper as f; print(f'   faster_whisper {f.__version__}')"),
    ("torch MPS","import torch; print(f'   torch {torch.__version__} MPS={torch.backends.mps.is_available()}')"),
    ("gradio 5.x","import gradio as gr; print(f'   gradio {gr.__version__}')"),
    ("numpy/scipy/librosa/soundfile","import numpy,scipy,librosa,soundfile"),
    ("pydub/moviepy/cv2/PIL","import pydub,moviepy,cv2,PIL"),
    ("nltk/edge-tts","import nltk,edge_tts"),
    ("tokenizers/hf-hub","import tokenizers,huggingface_hub"),
]:
    try:
        exec(imp, globals()); print(f"✅ {pname} OK"); packages_ok += 1
    except Exception as e:
        print(f"❌ {pname}: {type(e).__name__}: {e}")

print(f"\n✅ {packages_ok}/10 import groups OK. Phase 2-3 complete.")
