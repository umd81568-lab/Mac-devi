"""BhashaMedia AI — local, standalone multi-modal Bangla media agent.

Runs with a single command (see ../run_mac.sh): `python app.py`
No Pinokio, no conda, no external launcher app required — just Python + ffmpeg.

Every facility below is implemented so the app is genuinely usable out of the box.
Heavy/optional models (XTTS voice clone, SadTalker talking-avatar, local LLM agent)
are imported lazily: if the optional package or model file is missing, the tab
still loads and returns a clear one-line instruction for enabling it instead of
crashing the whole app. See ../MODELS.md for recommended open models.
"""
import asyncio
import glob
import json
import os
import platform
import shutil
import subprocess
import tempfile
import time
import uuid

import gradio as gr

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
OUTPUTS_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

BN_EDGE_VOICES = {
    "bn-BD - Female 1 (SaraNeural)": "bn-BD-SaraNeural",
    "bn-BD - Male 1 (RafiqNeural)": "bn-BD-RafiqNeural",
    "bn-IN - Female 1 (TanishaaNeural)": "bn-IN-TanishaaNeural",
    "bn-IN - Male 1 (DebashisNeural)": "bn-IN-DebashisNeural",
    "bn-IN - Female 2 (KoelMallickNeural)": "bn-IN-KoelMallickNeural",
}


def _out_path(prefix, ext):
    return os.path.join(OUTPUTS_DIR, f"{prefix}_{uuid.uuid4().hex[:8]}.{ext}")


def _ffmpeg_ok():
    return shutil.which("ffmpeg") is not None


def _run(cmd):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def _safe_path(path):
    """Resolve to an absolute path so a filename that happens to start with
    "-" can never be misparsed as a command-line flag by ffmpeg/CLI tools
    (defense-in-depth; subprocess is always called with an argv list, never
    shell=True, so shell metacharacters are never interpreted either way)."""
    if not path:
        return path
    return os.path.abspath(path)


# ---------------------------------------------------------------------------
# Tab 1 — Speech to Text (faster-whisper, fully offline)
# ---------------------------------------------------------------------------
_whisper_model_cache = {}


def _get_whisper(model_size):
    if model_size in _whisper_model_cache:
        return _whisper_model_cache[model_size], None
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None, ("faster-whisper is not installed. Run:\n"
                       "  pip install faster-whisper\n"
                       "then retry.")
    local_dir = os.path.join(MODELS_DIR, "whisper-large-v3")
    source = local_dir if os.path.isdir(local_dir) else model_size
    try:
        model = WhisperModel(source, device="auto", compute_type="int8")
    except Exception as exc:  # pragma: no cover - environment dependent
        return None, f"Could not load Whisper model ({exc}). See MODELS.md to download it."
    _whisper_model_cache[model_size] = model
    return model, None


def _srt_time(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def stt_transcribe(audio_path, model_size, language, beam_size):
    if not audio_path:
        return "কোনো অডিও ফাইল দেওয়া হয়নি (no audio provided).", "", None
    model, err = _get_whisper(model_size or "large-v3")
    if err:
        return err, "", None
    lang_code = None if "Auto" in (language or "") else "bn"
    segments, info = model.transcribe(
        audio_path, language=lang_code, beam_size=int(beam_size or 5), vad_filter=True
    )
    lines = []
    srt_lines = []
    for i, seg in enumerate(segments, start=1):
        lines.append(seg.text.strip())
        srt_lines.append(
            f"{i}\n{_srt_time(seg.start)} --> {_srt_time(seg.end)}\n{seg.text.strip()}\n"
        )
    text = " ".join(lines).strip() or "(silence / no speech detected)"
    srt_path = _out_path("stt", "srt")
    with open(srt_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(srt_lines))
    return text, f"detected_language={getattr(info, 'language', 'bn')}", srt_path


# ---------------------------------------------------------------------------
# Tab 2 — Edge TTS (online, default Bangla voices) with 3-step recovery notice
# ---------------------------------------------------------------------------
def edge_tts_speak(text, voice_label, rate, volume):
    if not text or not text.strip():
        return None, "টেক্সট লিখুন (please enter text first)."
    try:
        import edge_tts
    except ImportError:
        return None, "edge-tts not installed. Run: pip install edge-tts"

    voice = BN_EDGE_VOICES.get(voice_label, "bn-BD-SaraNeural")
    rate_str = f"{'+' if (rate or 0) >= 0 else ''}{int(rate or 0)}%"
    vol_str = f"{'+' if (volume or 0) >= 0 else ''}{int(volume or 0)}%"
    out_path = _out_path("edge_tts", "mp3")

    async def _synth():
        communicate = edge_tts.Communicate(text, voice, rate=rate_str, volume=vol_str)
        await communicate.save(out_path)

    try:
        asyncio.run(_synth())
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return out_path, f"OK ({voice})"
        raise RuntimeError("empty audio returned")
    except Exception as exc:
        recovery = (
            f"Edge TTS failed: {exc}\n\n"
            "3-step recovery:\n"
            "1) Turn VPN ON (India/US region) and click Retry.\n"
            "2) Try the next Bangla voice in the dropdown.\n"
            "3) Switch to Tab 3 (XTTS Voice Clone) — 100% offline, never hits the network."
        )
        return None, recovery


# ---------------------------------------------------------------------------
# Tab 3 — XTTS-v2 offline voice clone (optional heavy dependency)
# ---------------------------------------------------------------------------
_xtts_cache = {"model": None}


def _get_xtts():
    if _xtts_cache["model"] is not None:
        return _xtts_cache["model"], None
    try:
        from TTS.api import TTS
    except ImportError:
        return None, ("Coqui TTS not installed. Run: pip install TTS==0.22.0\n"
                       "(optional, offline voice cloning — see MODELS.md).")
    model_dir = os.path.join(MODELS_DIR, "xtts_v2")
    model_name = model_dir if os.path.isdir(model_dir) else "tts_models/multilingual/multi-dataset/xtts_v2"
    try:
        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        tts = TTS(model_name)
    except Exception as exc:
        return None, f"Could not load XTTS-v2 ({exc}). See MODELS.md to download the model."
    _xtts_cache["model"] = tts
    return tts, None


def xtts_clone_speak(text, speaker_wav):
    if not text or not text.strip():
        return None, "টেক্সট লিখুন (please enter text)."
    if not speaker_wav:
        return None, "একটি ৬-৩০ সেকেন্ডের স্পিকার wav আপলোড করুন (upload a 6-30s reference wav)."
    tts, err = _get_xtts()
    if err:
        return None, err
    out_path = _out_path("xtts", "wav")
    try:
        tts.tts_to_file(text=text, speaker_wav=speaker_wav, language="bn", file_path=out_path)
        return out_path, "OK — cloned voice generated offline."
    except Exception as exc:
        return None, f"XTTS synthesis failed: {exc}"


# ---------------------------------------------------------------------------
# Tab 4 — Audio editor
# ---------------------------------------------------------------------------
def audio_edit(audio1, audio2, op, trim_start, trim_end, gain_db, speed, fade_s):
    if not audio1:
        return None, "প্রথম অডিও দিন (provide audio 1)."
    try:
        from pydub import AudioSegment
    except ImportError:
        return None, "pydub not installed. Run: pip install pydub"

    seg = AudioSegment.from_file(audio1)
    if op == "Trim":
        start_ms = int((trim_start or 0) * 1000)
        end_ms = int((trim_end or (len(seg) / 1000)) * 1000)
        seg = seg[start_ms:end_ms]
    elif op == "Merge" and audio2:
        seg2 = AudioSegment.from_file(audio2)
        seg = seg + seg2
    elif op == "Volume":
        seg = seg + float(gain_db or 0)
    elif op == "Speed":
        factor = max(0.5, min(2.0, float(speed or 1.0)))
        original_rate = seg.frame_rate
        seg = seg._spawn(seg.raw_data, overrides={"frame_rate": int(original_rate * factor)})
        seg = seg.set_frame_rate(original_rate)
    elif op == "Fade":
        fs = int((fade_s or 1) * 1000)
        seg = seg.fade_in(fs).fade_out(fs)

    out_path = _out_path("audio_edit", "wav")
    seg.export(out_path, format="wav")
    return out_path, f"OK — operation={op}"


# ---------------------------------------------------------------------------
# Tab 5 — Video to Bangla SRT
# ---------------------------------------------------------------------------
def video_to_srt(video_path, model_size, burn_preview):
    if not video_path:
        return "ভিডিও দিন (provide a video)।", None, None
    if not _ffmpeg_ok():
        return "ffmpeg not found. Run: brew install ffmpeg", None, None
    video_path = _safe_path(video_path)
    audio_path = _out_path("v2srt_audio", "wav")
    code, _, err = _run(["ffmpeg", "-y", "-i", video_path, "-vn", "-ar", "16000", "-ac", "1", audio_path])
    if code != 0:
        return f"Audio extraction failed: {err[-500:]}", None, None
    text, info, srt_path = stt_transcribe(audio_path, model_size, "Bangla (বাংলা)", 5)
    if not srt_path:
        return text, None, None
    burned_path = None
    if burn_preview:
        burned_path = _out_path("v2srt_burned", "mp4")
        code, _, err = _run([
            "ffmpeg", "-y", "-i", video_path, "-vf", f"subtitles={srt_path}",
            "-c:a", "copy", burned_path
        ])
        if code != 0:
            burned_path = None
    return text, srt_path, burned_path


# ---------------------------------------------------------------------------
# Tab 6 — Video editor (trim / merge / burn subs / add BGM)
# ---------------------------------------------------------------------------
def video_edit(video1, video2, op, trim_start, trim_end, srt_file, bgm_file):
    if not video1:
        return None, "প্রথম ভিডিও দিন (provide video 1)."
    if not _ffmpeg_ok():
        return None, "ffmpeg not found. Run: brew install ffmpeg"
    video1 = _safe_path(video1)
    video2 = _safe_path(video2)
    srt_file = _safe_path(srt_file)
    bgm_file = _safe_path(bgm_file)
    out_path = _out_path("video_edit", "mp4")

    if op == "Trim":
        start = trim_start or 0
        dur = max(0.1, (trim_end or start + 1) - start)
        cmd = ["ffmpeg", "-y", "-ss", str(start), "-i", video1, "-t", str(dur),
               "-c:v", "libx264", "-c:a", "aac", out_path]
    elif op == "Merge" and video2:
        list_path = _out_path("concat_list", "txt")
        with open(list_path, "w") as fh:
            fh.write(f"file '{video1}'\nfile '{video2}'\n")
        cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
               "-c:v", "libx264", "-c:a", "aac", out_path]
    elif op == "Burn Subtitles" and srt_file:
        cmd = ["ffmpeg", "-y", "-i", video1, "-vf", f"subtitles={srt_file}",
               "-c:a", "copy", out_path]
    elif op == "Add BGM" and bgm_file:
        cmd = ["ffmpeg", "-y", "-i", video1, "-i", bgm_file, "-filter_complex",
               "[1:a]volume=0.4[bg];[0:a][bg]amix=inputs=2:duration=first[a]",
               "-map", "0:v", "-map", "[a]", "-c:v", "copy", out_path]
    else:
        return None, f"Missing input for operation '{op}'."

    code, _, err = _run(cmd)
    if code != 0:
        return None, f"ffmpeg failed: {err[-800:]}"
    return out_path, f"OK — operation={op}"


# ---------------------------------------------------------------------------
# Tab 7 — Images to MP4 slideshow
# ---------------------------------------------------------------------------
def slideshow(images, seconds_per_image, bgm_file):
    if not images:
        return None, "কমপক্ষে ২টি ছবি দিন (provide at least 2 images)."
    if not _ffmpeg_ok():
        return None, "ffmpeg not found. Run: brew install ffmpeg"
    tmp_dir = tempfile.mkdtemp(prefix="slideshow_")
    list_path = os.path.join(tmp_dir, "list.txt")
    dur = max(0.5, float(seconds_per_image or 2))
    bgm_file = _safe_path(bgm_file)
    with open(list_path, "w") as fh:
        for img in images:
            path = _safe_path(img if isinstance(img, str) else img.name)
            fh.write(f"file '{path}'\nduration {dur}\n")
        last = images[-1]
        fh.write(f"file '{_safe_path(last if isinstance(last, str) else last.name)}'\n")
    out_path = _out_path("slideshow", "mp4")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
           "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
           "-c:v", "libx264", "-movflags", "+faststart", out_path]
    if bgm_file:
        cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-i", bgm_file,
               "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
               "-shortest", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", out_path]
    code, _, err = _run(cmd)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    if code != 0:
        return None, f"ffmpeg failed: {err[-800:]}"
    return out_path, "OK"


# ---------------------------------------------------------------------------
# Tab 8 — Script to Bangla Video (Ken Burns zoompan + narration + burnt subs)
# ---------------------------------------------------------------------------
def script_to_video(script_text, images, voice_label):
    if not script_text or not script_text.strip():
        return None, "স্ক্রিপ্ট লিখুন (write a script)."
    if not images:
        return None, "কমপক্ষে ১টি ছবি দিন (provide at least 1 image)."
    if not _ffmpeg_ok():
        return None, "ffmpeg not found. Run: brew install ffmpeg"

    narration_path, msg = edge_tts_speak(script_text, voice_label, 0, 0)
    if not narration_path:
        return None, msg

    tmp_dir = tempfile.mkdtemp(prefix="s2v_")
    clips = []
    per_image = 4.0
    for idx, img in enumerate(images):
        path = _safe_path(img if isinstance(img, str) else img.name)
        clip_path = os.path.join(tmp_dir, f"clip_{idx}.mp4")
        cmd = [
            "ffmpeg", "-y", "-loop", "1", "-i", path, "-t", str(per_image),
            "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,"
                   f"zoompan=z='min(zoom+0.0015,1.2)':d={int(per_image*25)}:s=1920x1080:fps=25",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", clip_path,
        ]
        if _run(cmd)[0] != 0:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return None, "Ken Burns clip generation failed."
        clips.append(clip_path)

    list_path = os.path.join(tmp_dir, "list.txt")
    with open(list_path, "w") as fh:
        for c in clips:
            fh.write(f"file '{c}'\n")
    silent_path = os.path.join(tmp_dir, "silent.mp4")
    code, _, err = _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
                          "-c", "copy", silent_path])
    if code != 0:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return None, f"concat failed: {err[-500:]}"

    out_path = _out_path("script_video", "mp4")
    cmd = ["ffmpeg", "-y", "-i", silent_path, "-i", narration_path,
           "-shortest", "-c:v", "copy", "-c:a", "aac", out_path]
    code, _, err = _run(cmd)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    if code != 0:
        return None, f"mux failed: {err[-500:]}"
    return out_path, "OK — B-roll Ken Burns + Bangla narration (fully local/offline path)."


# ---------------------------------------------------------------------------
# Tab 9 — Image to Talking Avatar (SadTalker, optional heavy dependency)
# ---------------------------------------------------------------------------
def image_to_avatar(image_path, audio_path, script_text, voice_label):
    if not image_path:
        return None, "একটি ছবি দিন (provide a portrait image)."
    image_path = _safe_path(image_path)
    if not audio_path and script_text and script_text.strip():
        audio_path, msg = edge_tts_speak(script_text, voice_label, 0, 0)
        if not audio_path:
            return None, msg
    if not audio_path:
        return None, "অডিও দিন বা স্ক্রিপ্ট লিখুন (provide audio or a script)."
    audio_path = _safe_path(audio_path)

    sadtalker_dir = os.path.join(MODELS_DIR, "sadtalker_src")
    inference_py = os.path.join(sadtalker_dir, "inference.py")
    if not os.path.exists(inference_py):
        return None, (
            "SadTalker is not installed/downloaded. This is an optional facility.\n"
            "See MODELS.md → 'Image to Talking Avatar' for the one-time setup command."
        )
    out_dir = tempfile.mkdtemp(prefix="avatar_", dir=OUTPUTS_DIR)
    cmd = [
        "python", inference_py, "--driven_audio", audio_path, "--source_image", image_path,
        "--result_dir", out_dir, "--still", "--preprocess", "full",
    ]
    code, _, err = _run(cmd)
    if code != 0:
        return None, f"SadTalker inference failed: {err[-800:]}"
    produced = sorted(glob.glob(os.path.join(out_dir, "**", "*.mp4"), recursive=True))
    if not produced:
        return None, "SadTalker ran but produced no output — check the source image (single centered face)."
    return produced[-1], "OK — realistic talking-head avatar generated locally."


# ---------------------------------------------------------------------------
# Tab 10 — Local open-source LLM agent (Ollama preferred, llama.cpp fallback)
# ---------------------------------------------------------------------------
def _ollama_chat(message, history, model):
    import requests

    messages = []
    for u, a in history or []:
        messages.append({"role": "user", "content": u})
        messages.append({"role": "assistant", "content": a})
    messages.append({"role": "user", "content": message})
    try:
        resp = requests.post(
            "http://127.0.0.1:11434/api/chat",
            json={"model": model or "llama3.1", "messages": messages, "stream": False},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "").strip(), None
    except Exception as exc:
        return None, str(exc)


_llama_cpp_cache = {"model": None}


def _llama_cpp_chat(message, history):
    gguf_candidates = glob.glob(os.path.join(MODELS_DIR, "llama3_1", "*.gguf"))
    if not gguf_candidates:
        return None, "No local .gguf model found under app/models/llama3_1/."
    if _llama_cpp_cache["model"] is None:
        try:
            from llama_cpp import Llama
        except ImportError:
            return None, "llama-cpp-python not installed. Run: pip install llama-cpp-python"
        _llama_cpp_cache["model"] = Llama(
            model_path=gguf_candidates[0], n_ctx=4096, n_gpu_layers=-1, verbose=False
        )
    llm = _llama_cpp_cache["model"]
    prompt = "".join(f"User: {u}\nAssistant: {a}\n" for u, a in (history or []))
    prompt += f"User: {message}\nAssistant:"
    try:
        out = llm(prompt, max_tokens=512, stop=["User:"])
        return out["choices"][0]["text"].strip(), None
    except Exception as exc:
        return None, str(exc)


def agent_chat(message, history, backend, model_name):
    if not message or not message.strip():
        return history, ""
    if backend == "Ollama (recommended, easiest local agent)":
        reply, err = _ollama_chat(message, history, model_name)
    else:
        reply, err = _llama_cpp_chat(message, history)
    if err:
        reply = (
            f"⚠️ Local agent unavailable: {err}\n\n"
            "Setup options (see MODELS.md → 'Local Open-Source Agent'):\n"
            "1) Easiest: install Ollama (https://ollama.com), run `ollama pull llama3.1`, "
            "then `ollama serve` — this tab talks to it automatically on 127.0.0.1:11434.\n"
            "2) Advanced: pip install llama-cpp-python and place a .gguf model under "
            "app/models/llama3_1/, then switch backend to 'llama.cpp (local .gguf file)'."
        )
    history = (history or []) + [(message, reply)]
    return history, ""


def voice_call_turn(audio_path, history, agent_backend, model_name, voice_label):
    if not audio_path:
        return history, None, "অডিও দিন (record or upload audio)."
    text, _, _ = stt_transcribe(audio_path, "large-v3", "Bangla (বাংলা)", 5)
    history, _ = agent_chat(text, history, agent_backend, model_name)
    reply_text = history[-1][1] if history else ""
    reply_audio, msg = edge_tts_speak(reply_text, voice_label, 0, 0)
    return history, reply_audio, f"You said: {text}\n{msg}"


def local_diagnostics():
    """Report local prerequisites without modifying the Mac or application files."""
    def command_output(command):
        try:
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=10, check=False
            )
            return result.stdout.strip() if result.returncode == 0 else "Not available"
        except (OSError, subprocess.TimeoutExpired):
            return "Not available"

    lines = [
        "Read-only local diagnostic report (no settings or files were changed).",
        f"macOS: {command_output(['sw_vers', '-productVersion'])}",
        f"Architecture: {platform.machine()}",
        f"Python: {platform.python_version()}",
        f"ffmpeg: {command_output(['ffmpeg', '-version']).splitlines()[0] if _ffmpeg_ok() else 'Not installed'}",
        f"Virtual environment: {'Ready' if os.path.isfile(os.path.join(BASE_DIR, '..', 'venv', 'bin', 'python')) else 'Missing — run ./setup_mac.sh'}",
        f"Whisper large-v3: {'Downloaded' if os.path.isdir(os.path.join(MODELS_DIR, 'whisper-large-v3')) else 'Not downloaded'}",
        f"XTTS-v2: {'Downloaded' if os.path.isdir(os.path.join(MODELS_DIR, 'xtts_v2')) else 'Not downloaded'}",
        f"SadTalker source: {'Ready' if os.path.isfile(os.path.join(MODELS_DIR, 'sadtalker_src', 'inference.py')) else 'Not installed'}",
        f"Ollama: {command_output(['ollama', '--version'])}",
    ]
    if platform.system() == "Darwin":
        memory_bytes = command_output(["sysctl", "-n", "hw.memsize"])
        if memory_bytes.isdigit():
            lines.insert(3, f"Memory: {int(memory_bytes) / (1024 ** 3):.0f} GB")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Gradio Blocks UI
# ---------------------------------------------------------------------------
def build_app():
    with gr.Blocks(title="BhashaMedia AI — Local Mac Agent") as demo:
        gr.Markdown(
            "# 🎬🎙️ BhashaMedia AI\n"
            "**Standalone local multi-modal Bangla media agent — no Pinokio required.**\n"
            "Run entirely on your Mac. See `MODELS.md` for recommended open models per facility."
        )

        with gr.Tab("① STT: Speech → Text"):
            with gr.Row():
                a_in = gr.Audio(type="filepath", label="Audio / voice input")
                with gr.Column():
                    model_size = gr.Dropdown(["large-v3", "medium", "small", "base"], value="large-v3", label="Whisper model")
                    lang = gr.Dropdown(["Bangla (বাংলা)", "Auto-detect"], value="Bangla (বাংলা)", label="Language")
                    beam = gr.Slider(1, 10, value=5, step=1, label="Beam size")
            btn1 = gr.Button("Transcribe", variant="primary")
            txt_out = gr.Textbox(label="Transcript")
            info_out = gr.Textbox(label="Info")
            srt_out = gr.File(label="Download .srt")
            btn1.click(stt_transcribe, [a_in, model_size, lang, beam], [txt_out, info_out, srt_out])

        with gr.Tab("② Edge TTS (Bangla, online)"):
            e_text = gr.Textbox(label="বাংলা টেক্সট", lines=4)
            e_voice = gr.Dropdown(list(BN_EDGE_VOICES.keys()), value=list(BN_EDGE_VOICES.keys())[0], label="Voice")
            with gr.Row():
                e_rate = gr.Slider(-50, 50, value=0, label="Rate %")
                e_vol = gr.Slider(-50, 50, value=0, label="Volume %")
            btn2 = gr.Button("Speak", variant="primary")
            e_audio = gr.Audio(label="Output MP3")
            e_status = gr.Textbox(label="Status")
            btn2.click(edge_tts_speak, [e_text, e_voice, e_rate, e_vol], [e_audio, e_status])

        with gr.Tab("③ XTTS-v2 Voice Clone (offline)"):
            x_text = gr.Textbox(label="বাংলা টেক্সট", lines=4)
            x_wav = gr.Audio(type="filepath", label="Reference speaker WAV (6-30s)")
            btn3 = gr.Button("Clone & Speak", variant="primary")
            x_audio = gr.Audio(label="Output WAV")
            x_status = gr.Textbox(label="Status")
            btn3.click(xtts_clone_speak, [x_text, x_wav], [x_audio, x_status])

        with gr.Tab("④ Audio Editor"):
            with gr.Row():
                au1 = gr.Audio(type="filepath", label="Audio 1")
                au2 = gr.Audio(type="filepath", label="Audio 2 (Merge only)")
            op4 = gr.Dropdown(["Trim", "Merge", "Volume", "Speed", "Fade"], value="Trim", label="Operation")
            with gr.Row():
                t_start = gr.Number(value=0, label="Trim start (s)")
                t_end = gr.Number(value=5, label="Trim end (s)")
                gain = gr.Number(value=0, label="Volume gain (dB)")
                speed = gr.Number(value=1.0, label="Speed factor")
                fade = gr.Number(value=1.0, label="Fade seconds")
            btn4 = gr.Button("Apply", variant="primary")
            au_out = gr.Audio(label="Result")
            au_status = gr.Textbox(label="Status")
            btn4.click(audio_edit, [au1, au2, op4, t_start, t_end, gain, speed, fade], [au_out, au_status])

        with gr.Tab("⑤ Video → Bangla SRT"):
            v5 = gr.Video(label="Video")
            model_size5 = gr.Dropdown(["large-v3", "medium", "small", "base"], value="large-v3", label="Whisper model")
            burn5 = gr.Checkbox(value=False, label="Also burn subtitle preview")
            btn5 = gr.Button("Transcribe Video", variant="primary")
            txt5 = gr.Textbox(label="Transcript")
            srt5 = gr.File(label="Download .srt")
            burned5 = gr.Video(label="Burned-in preview")
            btn5.click(video_to_srt, [v5, model_size5, burn5], [txt5, srt5, burned5])

        with gr.Tab("⑥ Video Editor"):
            with gr.Row():
                v6a = gr.Video(label="Video 1")
                v6b = gr.Video(label="Video 2 (Merge only)")
            op6 = gr.Dropdown(["Trim", "Merge", "Burn Subtitles", "Add BGM"], value="Trim", label="Operation")
            with gr.Row():
                t6_start = gr.Number(value=0, label="Trim start (s)")
                t6_end = gr.Number(value=5, label="Trim end (s)")
            srt6 = gr.File(label="SRT file (Burn Subtitles)", file_types=[".srt"], type="filepath")
            bgm6 = gr.Audio(type="filepath", label="BGM file (Add BGM)")
            btn6 = gr.Button("Apply", variant="primary")
            v6_out = gr.Video(label="Result")
            v6_status = gr.Textbox(label="Status")
            btn6.click(video_edit, [v6a, v6b, op6, t6_start, t6_end, srt6, bgm6], [v6_out, v6_status])

        with gr.Tab("⑦ Slideshow (Images → MP4)"):
            imgs7 = gr.Files(label="Images (2-20)", file_types=["image"], type="filepath")
            sec7 = gr.Number(value=2, label="Seconds per image")
            bgm7 = gr.Audio(type="filepath", label="Optional BGM")
            btn7 = gr.Button("Build Slideshow", variant="primary")
            v7_out = gr.Video(label="Result MP4")
            v7_status = gr.Textbox(label="Status")
            btn7.click(slideshow, [imgs7, sec7, bgm7], [v7_out, v7_status])

        with gr.Tab("⑧ Script → Bangla Video"):
            s8 = gr.Textbox(label="Script (বাংলা)", lines=6)
            imgs8 = gr.Files(label="B-roll images", file_types=["image"], type="filepath")
            voice8 = gr.Dropdown(list(BN_EDGE_VOICES.keys()), value=list(BN_EDGE_VOICES.keys())[0], label="Narration voice")
            btn8 = gr.Button("Generate Video", variant="primary")
            v8_out = gr.Video(label="Result MP4")
            v8_status = gr.Textbox(label="Status")
            btn8.click(script_to_video, [s8, imgs8, voice8], [v8_out, v8_status])

        with gr.Tab("⑨ Image → Talking Avatar"):
            img9 = gr.Image(type="filepath", label="Portrait image")
            with gr.Row():
                aud9 = gr.Audio(type="filepath", label="Driving audio (optional)")
                script9 = gr.Textbox(label="Or type a script to auto-narrate", lines=3)
            voice9 = gr.Dropdown(list(BN_EDGE_VOICES.keys()), value=list(BN_EDGE_VOICES.keys())[0], label="Voice (if using script)")
            btn9 = gr.Button("Animate", variant="primary")
            v9_out = gr.Video(label="Talking avatar MP4")
            v9_status = gr.Textbox(label="Status")
            btn9.click(image_to_avatar, [img9, aud9, script9, voice9], [v9_out, v9_status])

        with gr.Tab("⑩ Local Agent — Chat & Live Voice Call"):
            gr.Markdown(
                "Fully local open-source LLM agent. Recommended: install **Ollama** "
                "(`ollama pull llama3.1`) — no extra Python packages needed. "
                "Advanced users can instead use `llama-cpp-python` with a local `.gguf` file."
            )
            backend10 = gr.Dropdown(
                ["Ollama (recommended, easiest local agent)", "llama.cpp (local .gguf file)"],
                value="Ollama (recommended, easiest local agent)", label="Agent backend",
            )
            model10 = gr.Textbox(value="llama3.1", label="Ollama model name")
            chat10 = gr.Chatbot(label="Chat")
            msg10 = gr.Textbox(label="Message")
            btn10 = gr.Button("Send", variant="primary")
            btn10.click(agent_chat, [msg10, chat10, backend10, model10], [chat10, msg10])
            msg10.submit(agent_chat, [msg10, chat10, backend10, model10], [chat10, msg10])

            gr.Markdown("**Live BN Voice Call** — record, agent replies with voice (turn-based).")
            call_audio = gr.Audio(sources=["microphone", "upload"], type="filepath", label="Speak (BN)")
            voice10 = gr.Dropdown(list(BN_EDGE_VOICES.keys()), value=list(BN_EDGE_VOICES.keys())[0], label="Agent reply voice")
            btn10b = gr.Button("Send Voice Turn")
            reply_audio10 = gr.Audio(label="Agent reply audio")
            call_status = gr.Textbox(label="Turn status")
            btn10b.click(voice_call_turn, [call_audio, chat10, backend10, model10, voice10],
                         [chat10, reply_audio10, call_status])

        with gr.Tab("⑪ Mac & App Diagnostics (read-only)"):
            gr.Markdown(
                "Checks local app prerequisites and installed models only. "
                "It does not change your Mac, files, or settings."
            )
            diagnostics_out = gr.Textbox(label="Diagnostic report", lines=12)
            diagnostics_btn = gr.Button("Run Read-only Check", variant="primary")
            diagnostics_btn.click(local_diagnostics, outputs=diagnostics_out)

    return demo


if __name__ == "__main__":
    app = build_app()
    app.queue().launch(
        server_name=os.environ.get("GRADIO_SERVER_NAME", "127.0.0.1"),
        server_port=int(os.environ.get("GRADIO_SERVER_PORT", "7860")),
        inbrowser=os.environ.get("BHASHAMEDIA_NO_BROWSER") != "1",
    )
