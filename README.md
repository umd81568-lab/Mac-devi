# 🎬🎙️ BhashaMedia AI — বাংলা মাল্টি-মোডাল লোকাল এজেন্ট

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

### Deployment tips
- Keep the app local: it binds to `127.0.0.1` by default and does not expose the
  Gradio interface to your network.
- Re-run `./setup_mac.sh` after pulling project updates; it verifies Python,
  `ffmpeg`, the core Gradio dependency, and the application syntax before
  reporting success.
- To transfer the complete tracked project to another Mac as a clean ZIP archive,
  run this from the repository root. The archive excludes virtual environments,
  downloaded models, and generated media, which should be created locally by
  `./setup_mac.sh`.
  ```bash
  git archive --format=zip --output=BhashaMedia-AI.zip HEAD
  ```
- To use a different local port, run:
  ```bash
  GRADIO_SERVER_PORT=7861 ./run_mac.sh
  ```

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
