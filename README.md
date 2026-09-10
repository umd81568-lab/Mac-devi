# BhashaMedia AI + Professional Local AI Studio

This repository now provides two complementary, local-first applications for
Apple Silicon Macs:

- **BhashaMedia toolbox** at `http://127.0.0.1:7860`: the existing standalone
  Gradio application with all 10 media facilities.
- **Professional Studio** at `http://127.0.0.1:5173`: the TypeScript production
  control plane for projects, scripts, assets, generation jobs, render queues,
  signed Mac-worker readiness, and local voice rooms.

The original Gradio application remains independently runnable through
`setup_mac.sh` and `run_mac.sh`. The new master scripts operate both applications
as one stack without replacing any facility.

The `studio/` workspace was integrated from
`umd81568-lab/replitallpro@eee4c34`, excluding Replit deployment metadata,
transient build state, dependencies, and archives.

## Single operator entrypoint

```bash
./setup_master.sh  # one-time runtimes, dependencies, PostgreSQL, schema, build
./run_master.sh    # starts Gradio, Studio API, and Studio UI
```

`setup_master.sh` requires Apple Silicon and Homebrew. It installs only missing
Node.js, pnpm/Corepack, PostgreSQL 16, ffmpeg, and Python 3.11 prerequisites. It
creates the idempotent `local_ai_studio` database, writes local settings to
`.env.local`, installs both dependency sets, applies the Drizzle schema, and
builds the Studio. It deliberately does **not** download model weights.

Press Ctrl-C once to stop all three child processes. The runner tracks and
terminates only the PIDs it started; it never kills processes by name.

## Complete operator surface

The BhashaMedia UI retains:

1. Speech-to-text and Bangla SRT
2. Edge TTS with five Bangla voices
3. XTTS-v2 offline voice cloning
4. Audio editing
5. Video-to-Bangla-SRT
6. Video editing
7. Image slideshow creation
8. Script-to-Bangla-video
9. SadTalker talking avatars
10. Local Ollama/llama.cpp agent and turn-based voice calls

The Professional Studio adds local FLUX.1-schnell image generation with output
provenance checks, LongCat-Video-Avatar 1.5 realistic presenters, consented asset
management, project/script/scene planning, recoverable generation and render
queues, and a private live Ollama voice room. Image and presenter jobs require
the paired, nonce-signed Mac worker; missing runtimes block readiness instead of
producing placeholder output.

Studio's built-in voice jobs currently use the local macOS `say` voice as a
baseline and do not apply the profile controls shown in the voice workspace.
Use BhashaMedia Tab 3 for real XTTS-v2 voice cloning; selecting a Studio voice
profile must not be interpreted as cloning or changing the macOS system voice.

## M1 Pro 64 GB model profile and disk planning

| Capability | Recommended choice | Approximate free disk |
|---|---|---:|
| Studio images | FLUX.1-schnell 8-bit through mflux 0.19.1 | 15 GB |
| Studio presenter | LongCat 1.5 bf16 DMD-merged (64 GB only) | 55 GB |
| Studio presenter, smaller Macs | LongCat 1.5 q4 DMD-merged | 30 GB |
| Live Studio room | Ollama `qwen2.5:14b` | 10 GB |
| Existing Gradio optional models | Whisper, XTTS, SadTalker, Llama 3.1 GGUF | 14 GB |

Allow at least **95 GB free** for the recommended 64 GB profile plus application
dependencies and generated media. Install heavy components only when needed:

```bash
# FLUX/MLX images (~15 GB)
bash studio/tools/mac-worker/install_image.sh

# LongCat presenter: recommended on M1 Pro with 64 GB (~55 GB)
bash studio/tools/mac-worker/install_presenter.sh --bf16

# Safer presenter choice for 32 GB systems (~30 GB)
bash studio/tools/mac-worker/install_presenter.sh --variant q4

# Installer/runtime checks without model weights
bash studio/tools/mac-worker/install_image.sh --no-model
bash studio/tools/mac-worker/install_presenter.sh --variant bf16 --no-model

# Local live voice room
brew install ollama
ollama pull qwen2.5:14b
ollama serve
```

Build and sign the native worker after installing the selected runtime:

```bash
cd studio/tools/mac-worker
swiftc -O -o StudioWorker StudioWorker.swift \
  -framework Metal -framework Security -framework CryptoKit
codesign --force --options runtime \
  --sign "Developer ID Application: YOUR TEAM" StudioWorker
./StudioWorker --studio-url http://127.0.0.1:5000/api \
  --pairing-code ONE_TIME_CODE_FROM_STUDIO
```

## Environment

`setup_master.sh` creates `.env.local` with safe local defaults. Override these
before running setup, or edit the local file afterward:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql:///local_ai_studio` | Dedicated Studio database |
| `STUDIO_DB_NAME` | `local_ai_studio` | Database created during setup |
| `STUDIO_API_PORT` | `5000` | Studio API |
| `STUDIO_UI_PORT` | `5173` | Studio operator UI |
| `GRADIO_SERVER_NAME` | `127.0.0.1` | BhashaMedia bind address |
| `GRADIO_SERVER_PORT` | `7860` | BhashaMedia UI |
| `STUDIO_OUTPUT_DIR` | `studio/artifacts/api-server/data/studio` | Generated Studio files |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5:14b` | Live room model |

## Consent and licensing

Only upload presenter references and voice samples for people who have given
explicit permission. Studio records consent metadata and verifies immutable
reference/audio hashes and generated output hashes, but the operator remains
responsible for lawful collection, disclosure, and use. Do not impersonate
people or create deceptive media.

Review the FLUX.1-schnell, LongCat-Video-Avatar, model-host, Coqui CPML, Meta
Llama, Microsoft Edge TTS, ffmpeg codec, and any deployment-specific licenses
before commercial use. Model access terms can differ from this repository's MIT
code license.

## Recovery

- **A port is occupied:** stop the owning application or change the matching
  port in `.env.local`; `run_master.sh` refuses a partial startup.
- **PostgreSQL is unavailable:** run `brew services start postgresql@16`, then
  `pg_isready`. Rerun `./setup_master.sh` to recreate only missing state and
  reapply the schema.
- **Studio build/schema is stale:** rerun `./setup_master.sh`; database creation,
  dependency installation, and schema application are idempotent.
- **Worker shows offline:** generate a fresh pairing code in Studio, start the
  signed worker with that one-time code, and verify its URL ends in `/api`.
- **Image/presenter readiness is blocked:** run the relevant pipeline `--check`
  command shown in [`studio/tools/mac-worker/README.md`](studio/tools/mac-worker/README.md).
  A missing or mismatched model revision intentionally stays unavailable.
- **Ollama voice room fails:** confirm `curl http://127.0.0.1:11434/api/tags`
  succeeds and that `OLLAMA_MODEL` has been pulled.
- **Gradio-only recovery:** the original `./setup_mac.sh` and `./run_mac.sh`
  remain supported and do not depend on Studio or PostgreSQL.

---

## BhashaMedia reference

**Standalone, fully local, all-in-one Bangla media agent for your Mac.**
STT · Edge-TTS (BN 5 voices) · XTTS-v2 Bangla Voice Clone · Audio Editor · Video → SRT ·
Video Editor · Image → Slideshow · Script → BN Video · Image → Talking Avatar ·
Local Open-Source LLM Agent + Live BN Voice Call.

**No Pinokio, no conda, no third-party launcher app.** Two shell scripts
(`setup_mac.sh` once, `run_mac.sh` to start) and a real Gradio app in
[`app/app.py`](app/app.py) are all you need.

---

## 📋 10-Facility Matrix (Exact Tab Order in UI)

| # | Tab Name | Model / Engine | Local-only? | Typical Output |
|---|---|---|---|---|
| ① | **Speech to Text (STT)** | Whisper Large-v3 (faster-whisper, int8) | ✅ OFFLINE | Text + `.srt` |
| ② | **Edge TTS (Bangla 5 voices)** | Microsoft Edge Consumer TTS — only default ONLINE facility, 3 printed recovery steps on failure | ⚠️ Online (Tab ③ is the offline fallback) | MP3 audio |
| ③ | **XTTS-v2 Voice Clone** | Coqui XTTS-v2 (optional install) | ✅ OFFLINE | WAV, cloned speaker timbre |
| ④ | **Audio Editor** | pydub + ffmpeg | ✅ OFFLINE | Trim/Merge/Vol/Speed/Fade WAV |
| ⑤ | **Video → BN SRT** | faster-whisper + ffmpeg | ✅ OFFLINE | `.srt` + optional burned-in preview |
| ⑥ | **Video Editor** | ffmpeg | ✅ OFFLINE | Trim / Merge / Burn subs / Add BGM MP4 |
| ⑦ | **Slideshow (Images → MP4)** | ffmpeg concat demuxer | ✅ OFFLINE | h264 MP4 |
| ⑧ | **Script → BN Video** | ffmpeg Ken Burns zoompan + Edge/XTTS narration | ✅ OFFLINE (narration falls back per Tab②/③ rules) | MP4 with narration |
| ⑨ | **Image → Talking Avatar** | SadTalker (optional install) | ✅ OFFLINE | Talking-head MP4 |
| ⑩ | **Local Agent + Live BN Voice Call** | **Ollama (recommended) or llama.cpp** local LLM + faster-whisper STT + Edge/XTTS reply voice | ✅ OFFLINE | Chat + turn-based voice call |

See [MODELS.md](MODELS.md) for the recommended open model for every facility, why it
was chosen, and the exact one-line install command.

**Global rule:** every facility defaults to 100% local. The only network call in the
whole app is the optional Edge TTS voice (Tab ②); everything else — including the
chat/voice agent — runs entirely on your machine once its (optional) model is present.

---

## 🚀 Quick Start (Mac, no third-party app)

### Prerequisites
- macOS (Apple Silicon or Intel), Python 3.11+
- [Homebrew](https://brew.sh) (used once to install `ffmpeg`)

### Install & run
```bash
git clone <this-repo>
cd Mac-devi
./setup_mac.sh   # creates ./venv, installs ffmpeg + core Python deps
./run_mac.sh     # starts the Gradio app at http://127.0.0.1:7860
```
Open the printed URL in your browser — that's it, no other app to install.

### Enable optional facilities
The app starts immediately with STT, Edge TTS, audio editing, video editing,
slideshow, and script-to-video all working out of the box (pure Python + ffmpeg).
Three facilities use larger optional models — install only the ones you want:

```bash
# Offline voice cloning (Tab 3)
pip install TTS==0.22.0
python app/download_models.py --model xtts

# Talking avatar (Tab 9)
python app/download_models.py --model sadtalker

# Local chat/voice agent (Tab 10) — recommended path, no extra pip package:
brew install ollama
ollama pull llama3.1
ollama serve
```
See [MODELS.md](MODELS.md) for the full list, licenses, and disk sizes.

---

## 🔌 Programmatic API

The Gradio server exposes every tab via the standard Gradio HTTP API while
`run_mac.sh` is running (default `http://127.0.0.1:7860`).

### 1. List all endpoints
```bash
curl -s http://127.0.0.1:7860/api/info | python3 -m json.tool | head -40
```

### 2. Python (gradio_client) — Tab ② Edge TTS
```python
from gradio_client import Client
client = Client("http://127.0.0.1:7860")
result = client.predict(
    "আমার নাম রফিক। আমি বাংলায় কথা বলি।",
    "bn-BD - Male 1 (RafiqNeural)", 0, 0,
    api_name="/edge_tts_speak",
)
print(result)
```

### 3. JavaScript (fetch) — Tab ① STT
```js
const BASE = "http://127.0.0.1:7860";
fetch(`${BASE}/api/predict`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fn_index: 0,
    data: ["/path/to/audio.wav", "large-v3", "Bangla (বাংলা)", 5],
  }),
})
  .then((r) => r.json())
  .then((j) => console.log(j.data[0]));
```

---

## 🐛 Troubleshooting

### Edge TTS (Tab ②) → 403 / no audio
Status box always prints 3 recovery steps on failure:
1. Turn VPN ON (India/US region), retry.
2. Try the next Bangla voice in the dropdown.
3. Switch to Tab ③ (XTTS Voice Clone) — 100% offline, never touches the network.

### `ffmpeg: command not found`
```bash
brew install ffmpeg
```
`setup_mac.sh` installs this automatically the first time; only needed manually if
you moved/renamed your Homebrew install.

### Tab ③ / ⑨ / ⑩ say a model is missing
These are optional facilities by design (they need multi-GB downloads). Run the
one-line command shown in the tab's status box, or see [MODELS.md](MODELS.md).

### Tab ⑩ agent says "Local agent unavailable"
- Recommended fix: `brew install ollama && ollama pull llama3.1 && ollama serve`,
  then retry — the app talks to Ollama automatically on `127.0.0.1:11434`.
- Advanced: `pip install llama-cpp-python`, download a `.gguf` model with
  `python app/download_models.py --model llama`, then switch the backend dropdown
  to "llama.cpp (local .gguf file)".

### SadTalker (Tab ⑨) "no face detected"
Use a single centered, front-facing portrait (square crop recommended), no
sunglasses/heavy makeup, uncluttered background.

---

## 📁 Project Layout

```
Mac-devi/
├── setup_mac.sh             # one-time: venv + ffmpeg + core deps
├── run_mac.sh                # start the app
├── MODELS.md                 # recommended open models per facility + rationale
├── app/
│   ├── app.py                 # Gradio Blocks app — all 10 facilities, lazy-loaded optional models
│   ├── requirements.txt      # core deps (heavy/optional ones documented, not force-installed)
│   ├── download_models.py    # on-demand model downloader (resume-safe)
│   ├── models/                # optional downloaded models live here (gitignored)
│   └── outputs/               # generated media (gitignored)
├── SPEC.md / CHECK_LIST.md / TASKS.md   # original planning docs (kept for history)
└── icon.png / mkicon.py
```

---

## 📜 License & Credits

**Project code**: MIT (personal + commercial use).
- **Whisper Large-v3 (faster-whisper/CTranslate2)**: MIT by Systran / OpenAI.
- **XTTS-v2 (Coqui)**: Coqui Public Model License (CPML v1) — review before
  commercial voice cloning.
- **Edge TTS**: public Microsoft Edge Consumer Speech endpoint, `edge-tts` MIT client.
- **ffmpeg**: LGPL 2.1+/GPL 2+ (Homebrew build; libx264 GPL-encoded outputs).
- **SadTalker**: MIT — realistic 3DMM lip-sync head, no cartoon engine.
- **Llama 3.1 8B**: Meta Llama 3.1 Community License.
- **Ollama**: MIT client/runtime.

## 🙏 বাংলার জন্য
১০ টি ফ্যাসিলিটি — কোনো তৃতীয় পক্ষের অ্যাপ ছাড়াই, শুধু আপনার Mac-এ, সরাসরি `./setup_mac.sh`
এবং `./run_mac.sh` দিয়ে চালু হয়।
