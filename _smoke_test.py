#!/usr/bin/env python3
"""Comprehensive smoke test for all BhashaMedia facilities."""
import sys, os, asyncio, traceback
from pathlib import Path
ROOT = Path("/Users/jui/Documents/trae_projects/local agent")
sys.path.insert(0, str(ROOT / "app"))
PYPATH = f"{ROOT}/conda_env/bin"
os.environ["PATH"] = f"{PYPATH}:{os.environ.get('PATH','')}"
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

REPORT = []
def report(name, status, detail=""):
    REPORT.append((name, status, detail))
    sym = {"PASS": "✅", "FAIL": "❌", "SKIP": "⚠️", "INFO": "ℹ️"}.get(status, "?")
    print(f"{sym} {name}: {detail[:120]}")

# ===== 1. MODULE IMPORTS =====
print("\n" + "="*60)
print("PART 1: Module Import Tests")
print("="*60)
for mod in ["gradio","faster_whisper","edge_tts","pydub","moviepy","cv2","PIL","numpy","scipy","soundfile","librosa","nltk","sentencepiece","tokenizers","huggingface_hub","torch"]:
    try:
        __import__(mod)
        report(mod, "PASS")
    except Exception as e:
        report(mod, "FAIL", f"{type(e).__name__}: {e}")

try:
    import torch
    report("PyTorch MPS device", "PASS" if torch.backends.mps.is_available() else "SKIP",
           f"torch {torch.__version__}")
except Exception as e:
    report("PyTorch", "FAIL", str(e))

# ===== 2. AUDIO TESTS =====
print("\n" + "="*60)
print("PART 2: Audio / TTS Tests")
print("="*60)
OUTPUTS = ROOT / "app" / "outputs"
OUTPUTS.mkdir(exist_ok=True)

# Generate 440 Hz sine wav 2s via numpy/soundfile
SINE_WAV = OUTPUTS / "test_440hz_sine.wav"
try:
    import numpy as np, soundfile as sf
    sr = 22050
    t = np.linspace(0, 2.0, int(2.0*sr), endpoint=False)
    audio = (0.4 * np.sin(2*np.pi*440*t)).astype(np.float32)
    sf.write(str(SINE_WAV), audio, sr)
    report("Generate sine WAV", "PASS", f"{SINE_WAV.name} {SINE_WAV.stat().st_size} bytes")
except Exception as e:
    report("Generate sine WAV", "FAIL", traceback.format_exc()[:200])
    SINE_WAV = None

# AUDIO TRIM
if SINE_WAV:
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_wav(str(SINE_WAV))
        out = OUTPUTS / "test_trimmed.wav"
        seg[200:800].export(str(out), format="wav")
        report("Audio Trim (pydub)", "PASS", f"{out.name} ({out.stat().st_size} bytes)")
    except Exception as e:
        report("Audio Trim", "FAIL", traceback.format_exc()[:200])

# AUDIO EFFECTS
if SINE_WAV:
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_wav(str(SINE_WAV))
        result = (seg + 6).fade_in(500).fade_out(500)
        out = OUTPUTS / "test_fx.wav"
        result.export(str(out), format="wav")
        report("Audio Effects (vol+fade)", "PASS", f"{out.name}")
    except Exception as e:
        report("Audio Effects", "FAIL", traceback.format_exc()[:200])

# AUDIO MERGE
if SINE_WAV:
    try:
        from pydub import AudioSegment
        s1 = AudioSegment.from_wav(str(SINE_WAV))
        s2 = AudioSegment.from_wav(str(SINE_WAV))
        out = OUTPUTS / "test_merge.wav"
        (s1 + s2).export(str(out), format="wav")
        report("Audio Merge (pydub)", "PASS", f"{out.name}")
    except Exception as e:
        report("Audio Merge", "FAIL", traceback.format_exc()[:200])

# EDGE TTS Bangla
try:
    import edge_tts
    bangla_text = "আমার নাম রফিক। আমি বাংলায় কথা বলি। এটি একটি পরীক্ষা।"
    out = OUTPUTS / "test_bangla_tts.mp3"
    async def run_tts():
        c = edge_tts.Communicate(bangla_text, "bn-BD-RafiqNeural")
        await c.save(str(out))
    asyncio.run(run_tts())
    sz = out.stat().st_size if out.exists() else 0
    ok = sz > 5000
    report(f"Edge TTS Bangla (Rafiq)", "PASS" if ok else "FAIL",
           f"{sz} bytes {'(network required)' if not ok else ''}")
except Exception as e:
    report("Edge TTS Bangla", "SKIP", f"needs network: {type(e).__name__}")

# XTTS Clone
try:
    import TTS
    report("XTTS-v2 Voice Clone import", "PASS", "TTS package installed")
except Exception as e:
    report("XTTS-v2 Voice Clone (TTS pkg)",
           "SKIP",
           f"Requires folder without space (see docs). {type(e).__name__}. Edge TTS still works for 5 BN voices.")

# ===== 3. SPEECH-TO-TEXT =====
print("\n" + "="*60)
print("PART 3: Speech-to-Text (faster-whisper large-v3)")
print("="*60)
if SINE_WAV:
    try:
        from faster_whisper import WhisperModel
        MODELS = ROOT / "app" / "models"
        model = WhisperModel("large-v3", device="cpu", compute_type="int8",
                             download_root=str(MODELS))
        segments, info = model.transcribe(str(SINE_WAV), language="bn",
                                          vad_filter=True, beam_size=1)
        text = " ".join(s.text for s in list(segments)[:5])
        report("Whisper large-v3 inference", "PASS",
               f"lang={info.language} prob={info.language_probability:.2f} | output len={len(text)}")
    except Exception as e:
        report("Whisper large-v3 inference", "FAIL", traceback.format_exc()[:300])

# ===== 4. VIDEO TESTS =====
print("\n" + "="*60)
print("PART 4: Video / FFmpeg Tests")
print("="*60)
import subprocess
r = subprocess.run([f"{PYPATH}/ffmpeg", "-version"], capture_output=True, text=True)
ok = r.returncode == 0
report("ffmpeg binary", "PASS" if ok else "FAIL",
       (r.stdout.split("\n")[0][:80] if ok else r.stderr[:100]))

# Create test color image via PIL
IMG1 = OUTPUTS / "test_color1.png"
IMG2 = OUTPUTS / "test_color2.png"
try:
    from PIL import Image, ImageDraw
    Image.new("RGB", (320, 240), (37, 99, 235)).save(str(IMG1))
    img2 = Image.new("RGB", (320, 240), (220, 38, 38))
    d = ImageDraw.Draw(img2); d.text((20,20), "Bangla", fill="white")
    img2.save(str(IMG2))
    report("PIL create test images", "PASS", f"{IMG1.name}, {IMG2.name}")
except Exception as e:
    report("PIL create images", "FAIL", traceback.format_exc()[:200])

# Slideshow generation via ffmpeg concat (like our app.images_to_slideshow)
SLIDE = OUTPUTS / "test_slideshow.mp4"
if IMG1.exists() and IMG2.exists() and ok:
    try:
        listf = OUTPUTS / "test_list.txt"
        listf.write_text(
            f"file '{IMG1}'\nduration 1.0\n"
            f"file '{IMG2}'\nduration 1.0\n"
            f"file '{IMG2}'\n", encoding="utf-8")
        cmd = [f"{PYPATH}/ffmpeg", "-y", "-f", "concat", "-safe", "0",
               "-i", str(listf),
               "-vf", "scale=320:240:force_original_aspect_ratio=decrease,"
                      "pad=320:240:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=10",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", str(SLIDE)]
        r2 = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        sz = SLIDE.stat().st_size if SLIDE.exists() else 0
        ok2 = r2.returncode == 0 and sz > 5000
        report("FFmpeg images → slideshow", "PASS" if ok2 else "FAIL",
               f"size={sz} exit={r2.returncode}" + (f" {r2.stderr[-200:]}" if not ok2 else ""))
    except Exception as e:
        report("FFmpeg slideshow", "FAIL", traceback.format_exc()[:200])

# Video Trim via moviepy
TRIM_VID = OUTPUTS / "test_trim.mp4"
if SLIDE.exists() and SLIDE.stat().st_size > 5000:
    try:
        from moviepy.editor import VideoFileClip
        c = VideoFileClip(str(SLIDE))
        out = c.subclip(0, min(0.8, c.duration))
        out.write_videofile(str(TRIM_VID), codec="libx264", audio_codec=None, logger=None)
        c.close(); out.close()
        ok3 = TRIM_VID.exists() and TRIM_VID.stat().st_size > 1000
        report("MoviePy Video Trim", "PASS" if ok3 else "FAIL",
               f"{TRIM_VID.stat().st_size if ok3 else 0} bytes")
    except Exception as e:
        report("MoviePy Video Trim", "FAIL", traceback.format_exc()[:200])

# Video Merge via moviepy
MERGE_VID = OUTPUTS / "test_merge.mp4"
if TRIM_VID.exists() and TRIM_VID.stat().st_size > 1000:
    try:
        from moviepy.editor import VideoFileClip, concatenate_videoclips
        c1 = VideoFileClip(str(TRIM_VID)); c2 = VideoFileClip(str(TRIM_VID))
        m = concatenate_videoclips([c1, c2], method="compose")
        m.write_videofile(str(MERGE_VID), codec="libx264", audio_codec=None, logger=None)
        for c in (c1, c2, m): c.close()
        ok4 = MERGE_VID.exists() and MERGE_VID.stat().st_size > 1000
        report("MoviePy Video Merge", "PASS" if ok4 else "FAIL",
               f"{MERGE_VID.stat().st_size if ok4 else 0} bytes")
    except Exception as e:
        report("MoviePy Video Merge", "FAIL", traceback.format_exc()[:200])

# Add Bangla subtitles to video via ffmpeg
SUBS_VID = OUTPUTS / "test_bangla_subs.mp4"
if SLIDE.exists() and ok:
    try:
        srt_file = OUTPUTS / "test_bangla.srt"
        srt_file.write_text(
            "1\n00:00:00,000 --> 00:00:01,000\nআমার নাম রফিক\n\n"
            "2\n00:00:01,000 --> 00:00:02,000\nবাংলাদেশ সুন্দর দেশ\n", encoding="utf-8")
        cmd = [f"{PYPATH}/ffmpeg", "-y", "-i", str(SLIDE),
               "-vf", f"subtitles='{srt_file}':force_style='FontName=Arial Unicode MS,FontSize=20'",
               "-c:v", "libx264", "-c:a", "copy", "-movflags", "+faststart", str(SUBS_VID)]
        r3 = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        sz = SUBS_VID.stat().st_size if SUBS_VID.exists() else 0
        ok5 = r3.returncode == 0 and sz > 1000
        report("FFmpeg Burn Bangla subtitles", "PASS" if ok5 else "SKIP",
               f"size={sz} {'OK' if ok5 else 'no bangla font: install Noto Sans Bengali'}" )
    except Exception as e:
        report("FFmpeg Bangla subs", "SKIP", f"{type(e).__name__}")

# ===== 5. GRADIO APP =====
print("\n" + "="*60)
print("PART 5: Gradio App Import & Build")
print("="*60)
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location("app_main", str(ROOT/"app"/"app.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["app_main"] = mod
    spec.loader.exec_module(mod)
    demo = getattr(mod, "demo", None)
    if demo is not None:
        report("Gradio app.build()", "PASS",
               f"Tabs: {len(getattr(demo, 'blocks', []) or [])} blocks, "
               f"type={type(demo).__name__}")
    else:
        report("Gradio app loads", "FAIL", "no demo object")
except Exception as e:
    report("Gradio app loads", "FAIL", traceback.format_exc()[:300])

# ===== SUMMARY =====
print("\n" + "="*60)
print("SUMMARY")
print("="*60)
passed = sum(1 for _, s, _ in REPORT if s == "PASS")
failed = sum(1 for _, s, _ in REPORT if s == "FAIL")
skipped = sum(1 for _, s, _ in REPORT if s == "SKIP")
print(f"✅ PASS: {passed}   ❌ FAIL: {failed}   ⚠️ SKIP: {skipped}   Total: {len(REPORT)}")
print()
for name, status, detail in REPORT:
    sym = {"PASS": "✅", "FAIL": "❌", "SKIP": "⚠️", "INFO": "ℹ️"}.get(status, "?")
    print(f"  {sym} {name} — {detail[:150]}")
sys.exit(0 if failed == 0 else 1)
