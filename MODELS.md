# Recommended Open Models & Local Agent — BhashaMedia AI

Everything here is **optional**. `app/app.py` boots and works without any of these; each
facility just tells you the exact command to run if its model isn't installed yet.
No cloud account, no paid API key, and no third-party desktop app (e.g. Pinokio) is
required for any of this — everything runs from `./venv` on your own Mac.

## Why these picks
Chosen for: (1) genuinely open license, (2) works on Apple Silicon CPU/MPS without a
discrete GPU, (3) good Bangla-language quality where relevant.

| Facility | Recommended model | License | Install |
|---|---|---|---|
| Speech → Text | `Systran/faster-whisper-large-v3` (CTranslate2 int8) | MIT | `python app/download_models.py --model whisper` |
| Offline voice clone | `coqui/XTTS-v2` via `TTS==0.22.0` | Coqui Public Model License (CPML) — review before commercial voice cloning | `pip install TTS==0.22.0` then `python app/download_models.py --model xtts` |
| Image → Talking Avatar | `SadTalker v0.0.2` (+ optional GFPGAN v1.4 sharpening) | MIT | `python app/download_models.py --model sadtalker`, then `pip install -e app/models/sadtalker_src --no-deps` (source checkout required — see SadTalker repo) |
| Local open-source LLM agent | **Ollama + Llama 3.1 8B Instruct** (recommended, no build step) | Meta Llama 3.1 Community License | `brew install ollama && ollama pull llama3.1 && ollama serve` |
| Local agent (advanced/offline binary) | `llama-cpp-python` + `Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf` | Meta Llama 3.1 Community License | `pip install llama-cpp-python` then `python app/download_models.py --model llama` |

## Apple M1 Max (64 GB) local quality profile
Your Mac has sufficient unified memory for the complete local workflow. Install
the models below once, then keep the app on its default `127.0.0.1` address:

```bash
./setup_mac.sh
source venv/bin/activate
python -m pip install TTS==0.22.0 "huggingface_hub>=0.24"
python app/download_models.py --model whisper
python app/download_models.py --model xtts
python app/download_models.py --model sadtalker
brew install ollama
ollama pull llama3.1
```

For the best fully local talking-video result, create narration with **Tab ③
XTTS-v2 Voice Clone** from a consented 6–30 second voice sample, then pass that
WAV and a consented, centred portrait to **Tab ⑨ Image → Talking Avatar**. The
Tab ⑨ script box uses Edge TTS and is therefore not part of the fully local
workflow. SadTalker additionally needs its inference source installed at
`app/models/sadtalker_src/`; follow its upstream installation instructions
after downloading its Hugging Face model files.

## My recommendation
- **Start with Ollama** for the local agent (Tab ⑩). It is the simplest, most
  reliable "open model agent" option on a Mac: one `brew install`, one `ollama pull`,
  and it exposes a local HTTP API that `app.py` already talks to automatically. Swap
  `llama3.1` for `qwen2.5:7b` or `mistral` any time by changing the model name field
  in the UI — no code change needed.
- **Keep Edge TTS as the default voice** (fast, free, good Bangla quality) and treat
  XTTS-v2 voice cloning as the offline fallback / custom-voice feature, since it needs
  a ~2 GB model download and more CPU time per sentence.
- **Skip SadTalker/CogVideoX unless you specifically need avatars or AI video** — they
  are the heaviest downloads (3.5 GB / 13 GB) and slowest to run on a base M1/M2 with
  8 GB RAM. Every other facility (STT, TTS, audio/video editing, slideshow,
  script-to-video via ffmpeg Ken Burns) works instantly with no extra download.
- All of the above already run 100% locally on your Mac — nothing needs to be sent
  to a third party except the optional Edge TTS cloud call, which itself has an
  offline fallback (Tab ③).

## Disk footprint if you install everything
```
whisper-large-v3   ~3.1 GB
xtts_v2            ~2.1 GB
sadtalker          ~3.5 GB
llama3_1 (gguf)    ~4.6 GB
------------------------------
total              ~13.3 GB   (vs. ~21 GB in the old Pinokio recipe, since
                                CogVideoX and GFPGAN are no longer bundled by default)
```
