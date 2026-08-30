#!/usr/bin/env python3
"""Clean outputs + stale cache + verify xtts_voice_clone uses local model only."""
import os, sys, shutil, importlib.util, inspect, re
d='/Users/jui/Documents/trae_projects/local agent/app/outputs'
for p in os.listdir(d):
    f=os.path.join(d,p)
    if os.path.isfile(f) and p!='.gitkeep': os.remove(f)
print('[OK] OUTPUTS CLEANED — files remaining:', len(os.listdir(d)))
hm='/Users/jui/Documents/trae_projects/local agent/app/models/.tts_home/tts'
if os.path.isdir(hm): shutil.rmtree(hm); print('[OK] Removed stale .tts_home/tts partial download')
sys.path.insert(0,'/Users/jui/Documents/trae_projects/local agent/app')
spec=importlib.util.spec_from_file_location('appm','/Users/jui/Documents/trae_projects/local agent/app/app.py')
appm=importlib.util.module_from_spec(spec); spec.loader.exec_module(appm)
src=inspect.getsource(appm.xtts_voice_clone)
local_ok=('TTS(model_path=' in src or 'local_model' in src or 'model_path=str' in src) and 'XTTS_DIR' in src
url_forbidden='tts_models/multilingual/multi-dataset/xtts_v2' in src
print('[CHECK] XTTS code references LOCAL model dir XTTS_DIR + TTS(model_path=...) ........:',
      'YES' if local_ok else 'NO')
print('[CHECK] XTTS does NOT reference forbidden TTS() URL model_name=tts_models/... .......:',
      'YES (no URL)' if not url_forbidden else 'NO — still has URL!!!')
print('[ENV] NLTK_DATA =', os.environ.get('NLTK_DATA','NOT SET'))
print('[ENV] COQUI_TOS_AGREED =', os.environ.get('COQUI_TOS_AGREED','NOT SET (app.py sets default)'))
print('[ENV] TTS_HOME =', os.environ.get('TTS_HOME','NOT SET (app.py sets default)'))
print('[ENV] HF_HUB_OFFLINE =', os.environ.get('HF_HUB_OFFLINE','NOT SET'))
print('[ENV] PYTORCH_ENABLE_MPS_FALLBACK =', os.environ.get('PYTORCH_ENABLE_MPS_FALLBACK','NOT SET'))
sys.exit(0 if (local_ok and not url_forbidden) else 2)
