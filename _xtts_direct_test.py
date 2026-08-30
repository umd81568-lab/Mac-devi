#!/usr/bin/env python3
"""Direct XTTS test with full error print."""
import os, sys, traceback
from pathlib import Path
sys.path.insert(0, '/Users/jui/Documents/trae_projects/local agent/app')
import importlib.util
spec=importlib.util.spec_from_file_location('appm', '/Users/jui/Documents/trae_projects/local agent/app/app.py')
appm=importlib.util.module_from_spec(spec); spec.loader.exec_module(appm)
print('xtts_dir exists:', appm.XTTS_DIR.exists())
print('model.pth size:', (appm.XTTS_DIR/'model.pth').stat().st_size if (appm.XTTS_DIR/'model.pth').exists() else 0)
print('config.json exists:', (appm.XTTS_DIR/'config.json').exists())
print('dvae.pth:', (appm.XTTS_DIR/'dvae.pth').exists())
from TTS.api import TTS
local_model=str(appm.XTTS_DIR)
local_config=str(appm.XTTS_DIR/'config.json')
print('LOAD TTS with model_path...')
try:
    tts = TTS(model_path=local_model, config_path=local_config, progress_bar=False, gpu=False)
    print('TTS LOADED OK. Running synth...')
    import soundfile as sf
    import numpy as np
    # Make a 2s 440Hz ref WAV first
    sr=22050
    t1=np.linspace(0,2,int(2*sr),endpoint=False)
    y1=(0.25*np.sin(2*np.pi*440*t1)).astype(np.float32)
    refwav='/tmp/_ref440.wav'
    sf.write(refwav,y1,sr)
    out=str(appm.OUT/'__xtts_sanity.wav')
    tts.tts_to_file(text='হ্যালো বাংলা', speaker_wav=refwav, language='hi', file_path=out)
    print('WROTE:', out, 'size=', Path(out).stat().st_size if Path(out).exists() else 0)
except Exception as e:
    traceback.print_exc()
    print('EXCEPTION:', type(e).__name__, str(e)[:1000])
    sys.exit(1)
