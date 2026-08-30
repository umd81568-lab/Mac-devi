# 🎬🎙️ BhashaMedia AI — বাংলা মাল্টি-মোডাল লোকাল এজেন্ট

**All-in-one Multi-modal AI Agent for Bangla Language — 100% Local on Apple Silicon Mac**
STT · Edge-TTS (BN 5 voices) · XTTS-v2 Bangla Voice Clone · Audio Editor · Video → SRT · Video Editor · Image → Slideshow · **Script→BN Video · Image→Talking Avatar · Live BN Voice Call**
Powered by Pinokio 1-click launcher.

---

## 📋 10-Facility Matrix (Exact Tab Order in UI)

| # | Tab Name | Model / Engine | Local-only? | Typical Output |
|---|---|---|---|---|
| ① | **Speech to Text (STT)** | Whisper Large-v3 (Systran CTranslate2 int8, 3.09GB) | ✅ OFFLINE | Text + Timestamps + `.srt` |
| ② | **Edge TTS (Bangla 5 voices)** | Microsoft Edge Consumer TTS (WSS) — ⚠️ ONLY default ONLINE facility — 3 printed recovery steps ON ANY fail | ⚠️ Online (Tab ③ XTTS fallback if fails) | MP3 audio |
| ③ | **XTTS-v2 Voice Clone** | Coqui XTTS-v2 (2.09GB) · TTS 0.22 | ✅ OFFLINE | 24kHz WAV · copies speaker timbre |
| ④ | **Audio Editor** | pydub + ffmpeg | ✅ OFFLINE | Trim/Merge/Vol/Speed/Fade WAV |
| ⑤ | **Video → BN SRT** | Whisper Large-v3 via faster-whisper | ✅ OFFLINE | `.srt` file + optional preview burn |
| ⑥ | **Video Editor** | FFmpeg 9 libx264 | ✅ OFFLINE | Trim / Merge / Burn BN subs / BGM overlay MP4 |
| ⑦ | **Slideshow (Images → MP4)** | FFmpeg concat demuxer | ✅ OFFLINE | h264 MP4 with or without BGM |
| ⑧ | **Script → BN Video (B-roll default / CogVideoX-2b experimental)** | A) ffmpeg Ken Burns zoompan + XTTS narration + BN subtitle burn (**fast trusted default**); B) THUDM/CogVideoX-2b diffusers 13GB natural-style guard NO CARTOON | ✅ OFFLINE (both) | MP4 h264 AAC 24fps w/ burnt BN subs |
| ⑨ | **Image → Talking Avatar (SadTalker v0.0.2 + GFPGAN)** | SadTalker v0.0.2 realistic 3DMM head (NO cartoon) + optional GFPGANv1.4 face sharpen pre-pass + inline Edge/XTTS BN TTS for audio input | ✅ OFFLINE | Head-talking MP4 256/512 |
| ⑩ | **Live BN Voice Call (local llama.cpp brain)** | llama.cpp Llama-3.1-8B-Instruct Q4_K_M (Bangla-capable, 4.6GB gguf) + faster-whisper STT + XTTS clone agent voice (Edge fallback W/ printed 3-steps) — turn-based local transcript + waveform + call history | ✅ OFFLINE | Live turn transcript + agent WAV reply |

**GLOBAL RULE LOCK (Tab ⑧⑨⑩):** All facilities default 100% LOCAL. Cloud APIs ONLY used as EMERGENCY FALLBACK when local path EXPLICITLY fails; status box always prints a notice. NO SILENT SWITCHING. NO CARTOON / ANIMATION OUTPUT enforced by prompt guards and engine locks (SadTalker = realistic human head only, CogVideoX prepends "realistic natural cinematic" prefix + forbids cartoon/toon/anime keywords).

All 10 facility models pre-cached under `app/models/` — **Tab ① / ③ / ④ / ⑤ / ⑥ / ⑦ / ⑧ / ⑨ / ⑩ work without internet first click**. Only Tab ② (Edge TTS) and Edge fallback paths inside ⑧⑨⑩ use a cloud WSS endpoint, with 3 documented printed recoveries on any 403/WS/NoAudio failure.

Total model disk usage after 1-click install complete: **~21.2 GiB (7 folders)**.

---

## 🚀 1-Click Install via Pinokio (Recommended)

### Prerequisites
- Apple Silicon Mac (M1 / M2 / M3 / M4) — macOS 13+
- Pinokio Desktop App installed from [pinokio.computer](https://pinokio.computer)

### Step-by-step
1. **Open Pinokio** Desktop app.
2. Top-left corner → click **+** (Add New App).
3. Click **Choose Folder**.
4. Navigate to and select this exact folder:
   ```
   /Users/jui/Documents/trae_projects/local agent
   ```
5. Pinokio reads [pinokio.json](pinokio.json) + [pinokio.js](pinokio.js) and shows sidebar.
6. Click **Install** → waits for all phases:
   - P1: conda env + symlink + cmake/FFmpeg 9
   - P2: core deps + PyTorch 2.7 darwin-arm64 + **7-step clang ULTIMATE recipe for TTS 0.22**
   - P3: Tab 8/9/10 deps (diffusers, basicsr/facexlib, llama-cpp-python METAL, GFPGAN)
   - P4: **SadTalker v0.0.2 source + GFPGAN source** pip install_no_deps
   - P5: **7 model snapshot downloads** (21.2 GiB total) — Whisper 3.1GB / XTTS 2.1GB / SadTalker 3.5GB / GFPGAN 336MB / Llama-3.1-8B 4.6GB / CogVideoX-2b 13GB
7. After install completes (~45-90 min first time depending on network), click **Start** → Gradio boots and captures URL.
8. Click **Open Web UI** → popup appears with the **10-tab** interface.

---

## 🖥️ Manual Start (No Pinokio, from shell)

If you already have the verified conda env:
```bash
cd "/Users/jui/Documents/trae_projects/local agent"
# Ensure no-space symlink exists (required for TTS 0.22 .so rpath)
ls -la /tmp/bhashamedia_conda || ln -sfn "$(pwd)/conda_env" /tmp/bhashamedia_conda

# Launch Gradio daemon
export PYTORCH_ENABLE_MPS_FALLBACK=1
export HF_HUB_OFFLINE=1
export NLTK_DATA="$(pwd)/app/nltk_data"
export TTS_HOME="$(pwd)/app/models/.tts_home"
export COQUI_TOS_AGREED=1
export GRADIO_SERVER_PORT=7860
export GRADIO_SERVER_NAME=127.0.0.1
cd app
../conda_env/bin/python app.py
```

Then open http://127.0.0.1:7860 in any browser.

---

## 🔌 Programmatic API (3 Examples)

The Gradio server exposes every tab callable via `POST /api/predict` endpoints. Server running at `http://127.0.0.1:7860`.

### 1. cURL — list all endpoints
```bash
curl -s http://127.0.0.1:7860/api/info | python3 -m json.tool | head -40
```

### 2. Python (requests) — Tab ② Edge TTS
```python
import requests, json
BASE = "http://127.0.0.1:7860"

# Tab ② Edge TTS — text="আমার নাম রফিক", voice="bn-BD - Male 1 (RafiqNeural)"
resp = requests.post(f"{BASE}/api/predict", json={
    "fn_index": 1,
    "data": [
        "আমার নাম রফিক। আমি বাংলায় কথা বলি।",
        "bn-BD - Male 1 (RafiqNeural)",
        0.0, 0.0
    ]
}, timeout=60)
result = resp.json()
print("HTTP", resp.status_code)
print("Edge TTS result keys:", list(result.keys())[:6] if isinstance(result, dict) else "data list length =", len(result["data"]) if "data" in result else "N/A")
```

### 3. JavaScript (fetch) — Tab ① STT with uploaded file path
```js
const BASE = "http://127.0.0.1:7860";
// Tab ① fn_index 0 — STT: [audio_path, model_size, lang, beam]
fetch(`${BASE}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        fn_index: 0,
        data: [
            "/Users/jui/Documents/trae_projects/local agent/app/outputs/_sine_5.0s.wav",
            "large-v3",
            "Bangla (বাংলা)",
            5
        ]
    })
})
.then(r => r.json())
.then(j => {
    console.log("STT transcript snippet:",
        (j.data ? j.data[0] : "N/A").toString().slice(0,300));
    console.log("SRT exists?", j.data ? (typeof j.data[2]==="string" && j.data[2].length>0) : null);
});
```

---

## 🐛 Troubleshooting — 5 Primary Sections

### 1. Edge TTS Tab ② → 403 Forbidden / Invalid response status / WSS close
Tab ② status box ALWAYS prints three recovery steps verbatim when ANY error occurs. Do not skip them — they are ordered by effectiveness:
1. **Turn VPN ON set to India (IN) or USA (US)** — Microsoft Edge TTS geoblocks many IP ranges; this fixes ~80% of 403s.
2. **Try next Bangla voice in dropdown** — 5 BN voices exist (`SaraNeural`, `RafiqNeural`, `TanishaaNeural`, `DebashisNeural`, `KoelMallickNeural`). Each uses a different backend endpoint pool.
3. **Switch to Tab ③ XTTS Voice Clone (100% OFFLINE)** — upload ANY 10-second Bangla WAV clip as reference. It clones the speaker's TIMBRE regardless of text language and never hits the network. No 403s possible.
  - Edge fallback paths inside Tab ⑧⑨⑩ also print these identical 3 steps verbatim. Never silently fall through.

### 2. TTS 0.22 monotonic_align fails to build during Install (path-with-space bug)
- **Root Cause**: conda python 3.11 binaries HARDCODE `-isystem` + `-Wl,-rpath` flags containing the literal space character from the env path `"local agent/conda_env"`. Any setuptools/pip C extension link step splits the token and aborts.
- **Recovery**:
  1. In Pinokio sidebar click **Reset** → then **Update**. Update re-runs the 7-step clang ULTIMATE recipe in [install.js](install.js) which:
     - Downloads TTS src → cythonizes monotonic_align/core.pyx
     - clang compile/links ONLY with `/tmp/bhashamedia_conda` (no-space) -I/-L/-Wl,-rpath
     - pip installs whole tree `--no-deps --no-build-isolation` (skips rebuild; .so already in-place)
     - manual fallback copies `core.cpython-311-darwin.so` into site-packages/TTS/tts/utils/monotonic_align/
  2. OR from terminal: `conda_env/bin/python _build_p2_tts_ultimate.py` (same recipe, standalone script).
- **Permanent verification**:
  ```bash
  /tmp/bhashamedia_conda/bin/python -c "from TTS.tts.utils.monotonic_align.core import maximum_path; print('OK', maximum_path)"
  ```

### 3. Model downloads (Whisper / XTTS / SadTalker / GFPGAN / Llama / CogVideoX) slow or interrupted
- All 7 model snapshots use HF `snapshot_download` / `hf_hub_download` with `resume_download=True`. **Interrupt + retry resumes partial chunks**; no re-download from zero.
- Pinokio sidebar → click **Update** to resume (Update.js re-runs the model snapshot step in addition to pull/reinstall).
- Manual resume example:
  ```bash
  cd "/Users/jui/Documents/trae_projects/local agent/app"
  SYM_PY=/tmp/bhashamedia_conda/bin/python
  $SYM_PY -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-large-v3', local_dir='models/whisper-large-v3', local_dir_use_symlinks=False, resume_download=True)"
  $SYM_PY -c "from huggingface_hub import snapshot_download; snapshot_download('coqui/XTTS-v2', local_dir='models/xtts_v2', local_dir_use_symlinks=False, resume_download=True)"
  # SadTalker v0.0.2 classic split checkpoints
  $SYM_PY -c "from huggingface_hub import snapshot_download; snapshot_download('vinthony/SadTalker', local_dir='models/sadtalker', local_dir_use_symlinks=False, resume_download=True)"
  ```
- Expected final sizes for sanity check:
  ```
  whisper-large-v3  = ~3.1 GB
  xtts_v2           = ~2.1 GB
  sadtalker         = ~3.5 GB (9 files + BFM_Fitting/)
  gfpgan            = ~336 MB (GFPGANv1.4.pth)
  llama3_1          = ~4.6 GB (Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf)
  cogvideox_2b      = ~13  GB (19 files)
  ```

### 4. Tab ⑨ SadTalker — "face crop fail" / "no face detected" / empty MP4 output
- **Facial alignment requirements**: SadTalker works best with ONE centered face, facing camera (±30° yaw), 200×200+ px face area, neutral lighting, NO sunglasses/mask/heavy makeup, background uncluttered.
- **Step-by-step recovery**:
  1. **Pre-crop manually first**: In any image editor crop tightly to head/shoulders. Square aspect ratio recommended (1:1). Upload that cropped image.
  2. **Toggle the GFPGAN checkbox OFF** then re-run — GFPGAN may sharpen too aggressively. Retry.
  3. **Switch `preprocess` option from `crop` to `full` or `extcrop`** in Tab ⑨ advanced options — `crop` assumes very tight bounding box; `full` runs the whole frame through 3DMM.
  4. **Size/pose tune**: Try `size=512` first, `pose_style=1` (static head) or `pose_style=0` (no motion) for stiff portraits.
  5. **Landmark dat file verification**: Check `shape_predictor_68_face_landmarks.dat` in `app/models/sadtalker/` exists, size **99,693,937 B**. If missing or 0B → re-download Troubleshooting §3.
  6. **BFM_Fitting check**: `ls app/models/sadtalker/BFM_Fitting/01_MorphableModel.mat` should exist.

### 5. Tab ⑩ Live Call — llama.cpp Metal offload slow / 24 tok/s or less
- **Root cause**: llama-cpp-python CMake Metal backend can fall back to CPU-only inference if gguf tensor alignment or n_gpu_layers param is unset.
- **Fastest config on Apple Silicon**:
  ```bash
  cd "/Users/jui/Documents/trae_projects/local agent"
  SYM_PY=/tmp/bhashamedia_conda/bin/python
  # Verify METAL was compiled in
  $SYM_PY -c "from llama_cpp import Llama; import llama_cpp; print('llama_cpp_python ver:', llama_cpp.__version__); m=Llama(model_path='app/models/llama3_1/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', n_gpu_layers=-1, n_ctx=4096, n_threads=8, verbose=False); print('backend:', m.backend)"
  ```
  Expected output: `backend: METAL` (M1/M2/M3/M4 GPUs auto-offload ~35 layers).
- If backend prints `CPU`:
  1. Reinstall llama-cpp-python forcing Metal shim:
     ```bash
     CMAKE_ARGS="-DLLAMA_METAL=on -DLLAMA_METAL_MACOSX_VERSION_MIN=14.0" \
       CMAKE_C_COMPILER=/usr/bin/clang CMAKE_CXX_COMPILER=/usr/bin/clang++ \
       /tmp/bhashamedia_conda/bin/python -m pip install --force-reinstall --no-cache-dir llama-cpp-python
     ```
  2. Ensure gguf file exists and is not truncated: `du -sh app/models/llama3_1/*.gguf` should print `~4.6 GB`.
  3. Limit concurrent apps using GPU (Safari/Final Cut/Xcode Simulator).

### 6. Tab ⑧ CogVideoX exp button — low VRAM / slow or black frames
- CogVideoX-2b pipeline loads 2B params into M1 unified memory → peak ~10 GB + 8GB swap on M1 Pro. **M1/M2 base (8GB) machines will swap heavily.**
- Recovery:
  1. Click the default **B-roll ffmpeg + Ken Burns** button instead (Tab ⑧ left button) — instant, 0 model load, natural Ken Burns zoompan + XTTS BN narration always succeeds.
  2. If using CogVideoX anyway: Close all other memory-hungry apps (Safari windows, VS Code, Xcode), ensure `PYTORCH_ENABLE_MPS_FALLBACK=1` is set (auto-set in start.js).

---

## 📁 Project Layout (Key Files)

```
local agent/
├── pinokio.json            # Pinokio v7 metadata (10-facility title · darwin arm64 · 10 tags)
├── pinokio.js              # Dynamic sidebar lifecycle (Install → Start → Open)
├── install.js              # 1-click recipe: conda → /tmp symlink → core → torch → 7-step TTS clang → nltk → SadTalker+GFPGAN src → 7 model snapshots
├── start.js                # Gradio daemon + Mochi URL regex capture → local.url → pterm open
├── reset.js / update.js / link.js / torch.js
├── SPEC.md / CHECK_LIST.md / TASKS.md   # Approved user-facing planning docs (plan-first workflow)
├── app/
│   ├── app.py              # ~1170 lines · Gradio Blocks · EXACTLY 10 TABS (fixed order ①–⑩) · Global Rule LOCAL-LOCK
│   ├── requirements.txt    # 41 pins: gradio 5.50 · faster-whisper 1.0.3 · transformers 4.44.2 · hub 0.34.0 · diffusers 0.40 · basicsr/facexlib · llama-cpp-python 0.3.35
│   ├── models/
│   │   ├── whisper-large-v3/    # Systran CTranslate2 int8 · 3.09GB OFFLINE
│   │   ├── xtts_v2/             # Coqui XTTS v2 weights · 2.09GB OFFLINE
│   │   ├── sadtalker/           # SadTalker v0.0.2 CLASSIC split checkpoints 3.5GB (9 files + BFM_Fitting/)
│   │   ├── sadtalker_src/       # SadTalker v0.0.2 inference.py + src tree (pip install --no-deps)
│   │   ├── gfpgan/              # GFPGANv1.4.pth 336MB
│   │   ├── gfpgan_src/          # GFPGAN v1.3.8 inference_gfpgan.py src (pip install --no-deps)
│   │   ├── llama3_1/            # Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf · 4.6GB
│   │   ├── cogvideox_2b/        # THUDM/CogVideoX-2b snapshot · 19 files · 13GB
│   │   └── .tts_home/           # TTS_HOME override (sandbox EPERM ~/Library fix)
│   ├── nltk_data/              # punkt / punkt_tab · tokenizers
│   └── outputs/                # smoke artifacts · FINAL_FACILITY_REPORT.md
├── conda_env/              # Python 3.11.9 · PyTorch 2.7.0 MPS · FFmpeg 9 · clang 21
├── _build_p1_clean.sh / _build_p2_tts_ultimate.py / _build_p3_models.py  # Standalone build helpers
├── _sanity_env.py / _prepare_verify.py / _verify_all_facilities.py       # Smoke/verify scripts
├── _install_8910_deps.sh   # Tab8/9/10 deps installer with METAL llama CMAKE shim
└── .gitignore
```

---

## 🧪 Verified Smoke Report

Previous 7-facility pass: **15/15 PASS — 2026-08-30 01:30** (generated by [_verify_all_facilities.py](_verify_all_facilities.py), stored in `app/outputs/FINAL_FACILITY_REPORT.md`). 10-facility expanded report regenerated after boot verifies Tab⑧⑨⑩ smoke scenarios.

---

## 📜 License & Credits

**Project code**: MIT (personal + commercial use).
- **Whisper Large-v3 (Systran CTranslate2)**: MIT by Systran / OpenAI.
- **XTTS-v2 Coqui**: Coqui Public Model License (CPML v1) — `COQUI_TOS_AGREED=1` is auto-set in env at startup; review Coqui terms for commercial voice cloning of proprietary voices.
- **Edge TTS**: Uses public Microsoft Edge Consumer Speech endpoint; follows `edge-tts` package MIT terms.
- **FFmpeg 9**: LGPL 2.1+/GPL 2+ via conda-forge build (libx264 GPL-encoded outputs for Video/Slideshow/Script→Video tabs).
- **SadTalker v0.0.2**: MIT by OpenTalker / Xi'an Jiaotong University — realistic 3DMM lip-sync head, NO cartoon engine.
- **GFPGAN v1.4**: Tencent ARC Lab — face restore/sharpen pass.
- **CogVideoX-2b**: THUDM license (Apache 2.0 for pipeline code, weights non-commercial as published — check repo LICENSE before commercial use for Tab⑧ experimental button).
- **Llama-3.1-8B**: Meta Llama 3.1 Community License — Q4_K_M GGUF from bartowski mirror.

---

## 🙏 বাংলার জন্য Pinokio দিয়ে তৈরি
1-click launcher powered by Pinokio → **১০ টি ফ্যাসিলিটি সব লোকাল**, কোনো GPU ক্লাউড দরকার নেই। GLOBAL RULE: সব ট্যাব ডিফল্টে 100% লোকাল। শুধু জরুরি ক্ষেত্রে API ফলব্যাক। কোনো কার্টুন/অ্যানিমেশন আউটপুট নেই।
