# VERIFICATION CHECKLIST — BhashaMedia AI Build

Rules:

* **Never proceed to next phase if any gate FAILS.** Fix, re-check, tick.

* Use checkboxes manually: ☐ → ✅ only after running real command / real proof.

* **Log folder:** Always check `logs/api/*.log` first on any launcher error (Gepeto rule).

***

## 0. PRE-FLIGHT (Before Any Build Step)

Reference lock:

* ☐ Example files open and verified:

  * `~/.pinokio/prototype/system/examples/Kokoro-TTS/install.js` (menu, torch, reset, dynamic sidebar)

  * `~/.pinokio/prototype/system/examples/AllTalk-TTS/install.js` (conda env pattern, XTTS model download step)

  * `~/.pinokio/prototype/system/examples/autogpt/pinokio.js` (local.url capture → Open Web UI href)

  * `~/.pinokio/prototype/system/examples/mochi/start.js` (Critical URL regex capture block)

* ☐ PINOKIO\_HOME resolved: `/Users/jui/pinokio` (from `~/.pinokio/config.json`)

* ☐ Working project dir is writable: `/Users/jui/Documents/trae_projects/local agent/`

* ☐ No running Gradio server on port 7860. (`lsof -ti:7860 | xargs kill` if any)

* ☐ Sandbox permission: confirm **cannot** write to `~/.pinokio/api/*` → expected. Build stays in working dir.

Python / Binary deps pre-flight:

* ☐ `/opt/homebrew/bin/brew` — confirmed NOT present (no homebrew. Use conda-forge exclusively for ffmpeg/git-lfs/clang)

* ☐ Pinokio Miniforge Conda: `~/.pinokio/bin/miniforge/bin/conda --version` → 26.5.3+

* ☐ `python3 --version` (system, only for helpers) → 3.9+ (ok, 3.11 via conda at runtime)

***

## 1. PHASE 1 GATE — Clean Conda Env + Space-Symlink

* ☐ Old `conda_env`, `env`, `app/models/whisper*`, `app/models/xtts*`, `app/outputs/*` all removed OR fresh snapshot taken

* ☐ If absolute path of project contains SPACE char:

  * ☐ `/tmp/bhashamedia_conda` symlink → `./conda_env` created (`ln -sfn` command)

  * ☐ Install steps that compile C-extensions go through `/tmp/bhashamedia_conda/bin/python`

* ☐ Conda env created via install.js pattern:

  * ☐ python=3.11.9 installed

  * ☐ conda-forge channel added

  * ☐ ffmpeg 9.0+ installed (`conda_env/bin/ffmpeg -version` returns libx264)

  * ☐ git-lfs, cmake, clang\_osx-arm64, cxx-compiler, pkg-config installed (TTS build deps)

* ☐ Python runtime sanity: `/tmp/bhashamedia_conda/bin/python --version` = `Python 3.11.9`

***

## 2. PHASE 2 GATE — Core + Torch + TTS (All Pinned Versions Install)

Use `/tmp/bhashamedia_conda/bin/python -m uv pip install` when targetting conda env (or `python -m pip install` fallback):

Core:

* ☐ gradio==5.50.0 ✅ importable

* ☐ faster-whisper==1.0.3 ✅

* ☐ edge-tts>=7.2.8 ✅

* ☐ transformers==5.16.1 ✅

* ☐ accelerate==1.14.0 ✅

* ☐ sympy==1.14.0 ✅

* ☐ pydub / moviepy / opencv-python / Pillow / numpy==1.26.4 / scipy / soundfile / librosa / sounddevice / pydantic / nltk / sentencepiece / tokenizers==0.23.1 / huggingface-hub==1.29.0

  * ☐ Run `_check_env.py` → 100% 20/20 = ALL OK (no MISSING, no version-mismatch warn)

PyTorch Apple Silicon (torch.js reference block):

* ☐ torch 2.7.0 installed

* ☐ torchvision 0.22.0 installed

* ☐ torchaudio 2.7.0 installed

* ☐ `torch.backends.mps.is_available() == True` ✅

* ☐ Env var `PYTORCH_ENABLE_MPS_FALLBACK=1` will be set in start.js (verify present in start.js env section)

TTS 0.22.0 C-extension build (the big one — if this fails, STOP and fix before Phase 3):

* ☐ Installation is done via `/tmp/bhashamedia_conda/bin/python` symlink (no space in -isystem clang arg!)

* ☐ Exit code 0 from install

* ☐ `from TTS.api import TTS` succeeds

* ☐ `TTS().list_models()` returns list containing "tts\_models/multilingual/multi-dataset/xtts\_v2" string

***

## 3. PHASE 3 GATE — Model Pre-Downloads (NOT on First User Click)

* ☐ `app/nltk_data/tokenizers/punkt/PY3/` exists (punkt downloaded with NLTK\_DATA=app/nltk\_data)

* ☐ `app/nltk_data/tokenizers/punkt_tab/` exists

* ☐ Whisper large-v3: `huggingface_hub.snapshot_download("Systran/faster-whisper-large-v3", local_dir="app/models/whisper-large-v3")`

  * ☐ Total size of model dir > 2.5 GB (`du -sh` verify)

  * ☐ faster-whisper loads it locally without network call (set HF\_HUB\_OFFLINE=1 then load model → success)

* ☐ XTTS-v2:

  * ☐ coqui/XTTS-v2 main model in app/models/xtts\_v2/ via snapshot\_download

  * ☐ vocoder file present

  * ☐ Total size >1.5 GB

  * ☐ HF\_HUB\_OFFLINE=1 test: `TTS(model_path=..., config_path=...)` resolves from local (no network)

***

## 4. PHASE 4 GATE — Launcher Files (Line-by-line match example patterns)

### `pinokio.json`

* ☐ `version: "7.0"` set

* ☐ `platform: ["darwin"]` and `arch: ["arm64"]` declared (Apple Silicon primary, linux runs naturally anyway)

* ☐ `icon: "icon.png"` declared, icon file exists, opens as valid PNG (file ≥ 500 bytes, correct PNG signature)

### `pinokio.js`

* ☐ Dynamic menu using `info.exists("conda_env") || info.exists("env")` for install detection

* ☐ Running states: installing, starting, updating, resetting, deduplicating

* ☐ default=Install when not installed

* ☐ default=Start when installed + not running

* ☐ `local.url` present → returns `<a href={{local.url}} target=_blank>Open Web UI</a>` as default (exactly autogpt pattern)

### `install.js`

* ☐ Top line: `module.exports = { requires: { bundle: "ai" }, run: [...] }` (triggers CUDA/HF CLI bundle)

* ☐ `conda: { path: "conda_env", python: "3.11.9" }` step creates env

* ☐ Conda install ffmpeg, git-lfs, cmake, clang\_osx-arm64, cxx-compiler, pkg-config

* ☐ Conda activate + uv pip install `app/requirements.txt`

* ☐ **Critical auto-symlink step BEFORE TTS install:** If `{{cwd}}` contains " " space → `ln -sfn "{{cwd}}/conda_env" /tmp/bhashamedia_conda`

* ☐ Install TTS==0.22.0 using `/tmp/bhashamedia_conda/bin/python -m pip install` (bypass space-path clang split)

* ☐ script.start `torch.js` with `conda:"conda_env" path:"app"` args → all 8 torch hw/OS branches handle conda arg

* ☐ NLTK download step exports `NLTK_DATA="$PWD/app/nltk_data"` first before `nltk.download(...)`

* ☐ Model step: `python _download_models.py` (separate helper, progress printed, retry 3x)

* ☐ Final step: notify "✅ BhashaMedia AI installed (models downloaded). Press Start to Launch."

### `start.js`

* ☐ `daemon: true` (top of file, mandatory for server scripts)

* ☐ shell.run params include:

  ```
  conda: "conda_env"
  path: "app"
  env:
    SERVER_NAME: "127.0.0.1"
    PYTORCH_ENABLE_MPS_FALLBACK: "1"
    TOKENIZERS_PARALLELISM: "false"
    NLTK_DATA: "{{cwd}}/app/nltk_data"
  message: [ "python app.py --server-name 127.0.0.1 --server-port {{port}}" ]
  on: [{ event: "/(http:\\/\\/[0-9.:]+)/", done: true }]  ← mochi pattern verbatim
  ```

* ☐ Next step: `method: "local.set" params: { url: "{{input.event[1]}}" }` ← Gepeto pattern VERIFIED index \[1]

### `torch.js`

* ☐ 8 branches: NVIDIA Windows (cu128), NVIDIA Linux, AMD Windows (DirectML), AMD Linux (ROCm), Apple Silicon arm64, Intel Mac, Generic CPU.

* ☐ Apple arm64: `--force-reinstall --no-deps` torch=2.7.0 torchaudio=2.7.0 torchvision=0.22 CPU wheels

* ☐ Every branch accepts BOTH `venv=...` and `conda=...` from args → resolves python bin correctly

### `reset.js` / `update.js` / `link.js`

* ☐ reset: recursive rm conda\_env, env, app/models, app/outputs, app/nltk\_data

* ☐ update: git pull → script.start install.js

* ☐ link: fs.link venv dedup pattern

***

## 5. PHASE 5 GATE — App UI (app.py) Structure

* ☐ 7 clean tabs only. Order: STT → Edge TTS → XTTS Clone → Audio Edit → Video→SRT → Video Edit → Slideshow

* ☐ No Facebook MMS / Random TTS / extra tabs

* ☐ Every heavyweight import (TTS, faster\_whisper pipeline, transformers) INSIDE function (not top-level, import-time 20s avoided)

* ☐ `mps_device()` helper returns "mps" if available else "cpu"

* ☐ `OUTPUT_DIR = Path(__file__).parent / "outputs"` exists, mkdir(exist\_ok=True) at module init

* ☐ `MODEL_DIR = Path(__file__).parent / "models"` exists

* ☐ Timestamp + uuid filename pattern for outputs (no file overwrite)

* ☐ Edge TTS status shows 3 recovery actions on any 403-like error

* ☐ Tab ③ XTTS references local model cache dir (NOT huggingface.co at runtime)

* ☐ `python -m py_compile app/app.py` → exit 0

***

## 6. PHASE 6 GATE — Full Facility E2E Smoke Tests

Each facility → produce **actual file** in app/outputs/. Record size + timestamp.

* ☐ ① STT. whisper large-v3 int8 mps inference pass → transcript text / segments / srt saved.

* ☐ ② Edge TTS → MP3 >15KB OR status shows 3 recovery steps. Either = PASS (MS-403 handled).

* ☐ ③ XTTS Clone → WAV >200KB, 24kHz sr, playback-able duration >1s. PROFESSIONAL TEST.

* ☐ ④ Audio Editor: 3 separate files (trim / merge / fx) all loadable by pydub.

* ☐ ⑤ Video→SRT: SRT file has valid HH:MM:SS,mmm lines.

* ☐ ⑥ Video Editor: 4 MP4 libx264 + AAC files, ffprobe stream 0 is h264.

* ☐ ⑦ Slideshow: 2 MP4 files (no BGM + BGM) duration correct 3s ±0.2s.

### Server Boot Check

* ☐ Start server → `Running on http://127.0.0.1:<PORT>` appears in log

* ☐ `curl http://127.0.0.1:<PORT>/api/info` returns HTTP 200 with JSON body (or 405 means server is live and handling requests)

* ☐ Gradio UI Tabs render: visit main route → HTML response > 50KB with `<title>` containing "BhashaMedia"

***

## EXIT GATE — Final Before "Done" Report to User

* ☐ All Phase 1-6 gates ☐ converted to ✅ above

* ☐ start.js URL capture block matches mochi example line-by-line

* ☐ pinokio.js Open Web UI href uses `{{local.url}}` (autogpt pattern)

* ☐ No leftover helper files except approved (\_check\_env.py / \_download\_models.py at install root are OK if mentioned in README)

* ☐ README.md contains: Overview, 7 Facilities list, Install via Pinokio Choose Folder step, 3-line curl API example, 6-line python client example, Troubleshooting (Edge403, TTS space-path, slow model downloads)

* ☐ .gitignore includes conda\_env, env, app/models/*/ (but keep models placeholder dir .gitkeep optional), app/outputs/*, app/nltk\_data/\*, __pycache__, logs

* ☐ Human-readable status report table saved/printed: 7 rows × 5 cols (Facility | Status | Output File | Size | Notes). Each cell has PASS/FAIL green/red.

