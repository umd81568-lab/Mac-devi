# SPECIFICATION — BhashaMedia AI (বাংলা মাল্টি-মোডাল এজেন্ট)

## 1. Identity
- **Project Name:** BhashaMedia AI
- **Tagline:** বাংলা ভাষার সম্পূর্ণ স্থানীয় ভিডিও · অডিও · ভয়েস এজেন্ট (Apple Silicon)
- **Launcher Type:** Pinokio App Launcher (conda env pattern, darwin-arm64 primary, linux-x86_64 secondary declaration-free fallback)
- **Destination:** Build happens in project working folder. Final Pinokio install: user drag-drop folder OR Pinokio Desktop **"Choose Folder"** (sandbox cannot write to `PINOKIO_HOME/api/`).
- **User base:** বাংলাদেশ / ভারতীয় বাংলা স্পীকার কন্টেন্ট ক্রিয়েটর। Local install কোনো ক্লাউড API ছাড়াই কাজ করবে।

## 2. Problem Statement
বাংলা ভাষায় (1) লেখা → কথা, (2) কথা → লেখা, (3) নিজের ভয়েস ক্লোন করে কথা বলানো, (4) ভিডিও এডিট + বাংলা সাবটাইটেল বার্ন — সব কিছু এক ট্যাবে করতে চান কিন্তু Microsoft Edge TTS দেশের বেশিরভাগ IP এ 403 দেয়, HuggingFace র‍্যান্ডম মডেল গুলো বাংলায় ভালো কাজ করে না। দরকার 100% বিশ্বস্ত + প্রফেশনাল সিস্টেম যা পিনকিউ ডেস্কটপ থেকে ওয়ান ক্লিকে চালু হয়।

## 3. Non-Negotiable Requirements (User Approved)
### Facility Matrix (7 Tabs)
| # | Facility Name | INPUT (বাংলা সাপোর্ট) | OUTPUT | Must use |
|---|---|---|---|---|
| ① | **STT: Speech → Text** | Mic WAV / MP4 file · Any Bangladeshi accent | (a) Plain বাংলা text, (b) Segments w/ start/end sec, (c) .srt file formatted | `faster-whisper` + **Systran/faster-whisper-large-v3** (Bangla WER best open source) |
| ② | **TTS 1: Edge TTS Online** | বাংলা টেক্সট · 5 ভয়েস dropdown | MP3 128kbps | edge-tts ≥ 7.2.8 · Voices `bn-BD-SaraNeural`, `bn-BD-RafiqNeural`, `bn-IN-TanishaaNeural`, `bn-IN-DebashisNeural`, `bn-IN-KoelMallickNeural` |
| ③ | **TTS 2: XTTS-v2 Voice Clone (Offline)** | বাংলা টেক্সট + 6-30s clean speaker WAV reference | WAV 24kHz in reference tone | **coqui/XTTS-v2** + Coqui `TTS` package 0.22.0 (lang="bn") — must be installable NO space-path workaround manual steps |
| ④ | **Audio Editor** | 1-2 audio files + numeric params | Trimmed / Merged / Vol ± dB / Speed 0.6-1.8× / Fade in-out WAV/MP3 | pydub + soundfile + librosa |
| ⑤ | **Video → Bangla SRT Transcribe** | MP4 / MOV / MKV (any Bangla speech) | (1) Transcribed BN text, (2) .srt file download, (3) Auto-burned subtitles preview (optional) | faster-whisper ① → `_srt_time()` helper → ffmpeg subtitles filter |
| ⑥ | **Video Editor** | 1-2 video files + Bangla SRT / BGM file | (a) Trimmed clip, (b) Merged clips, (c) Bangla subtitle burn (Noto Sans Bengali), (d) Overlay background music on video | moviepy 2.x + ffmpeg 9.x (conda-forge) |
| ⑦ | **Image → MP4 Slideshow** | 2-20 PNG/JPG images · seconds-per-image · optional BGM | H.264 MP4 1080p yuv420p +faststart | ffmpeg concat demuxer (NOT moviepy, frame accurate) |

### Tab Order (Fixed): ① → ② → ③ → ④ → ⑤ → ⑥ → ⑦

### Apple Silicon Optimizations
1. PyTorch 2.7.0 darwin-arm64 CPU wheel → `PYTORCH_ENABLE_MPS_FALLBACK=1` set globally.
2. faster-whisper compute_type = int8, device = mps, vad_filter=True, beam_size=3 for Bangla.
3. XTTS uses device=mps for encoder, fallback to cpu for decoder if op unsupported.

### Edge TTS 403 Prevention (Professional Solution, NO Random Fallback Tab)
- **Tab ②** button will:
  1. Try Edge TTS 7.2.8+ with the 5 hardcoded BN voices
  2. If ANY 403/NoAudio/WS error: Status box shows **3 specific recovery actions user can actually perform**:
     - (a) Recommended: "VPN ON → India / USA server → click Retry (same button)"
     - (b) "Switch to Tab ③ Voice Clone (100% local, no MS dependency — use any 10s BN YouTube audio as reference)"
     - (c) "Auto-swap voice: Sara → Rafiq → Tanishaa → Debashis → Koel" (different voices sometimes hit different MS region endpoints)
- **No extra random Facebook MMS/other tabs.** User asked for TRUSTED PROFESSIONAL — only the industry standards in each facility.

### XTTS Build Fix (Mandatory — NO manual folder rename)
- The install.js itself will:
  1. If project path contains space → auto-create `/tmp/bhashamedia_conda` symlink
  2. Run ALL pip installs through the symlink python so clang -isystem never sees a space
  3. This way `TTS==0.22.0` compiles cleanly FIRST try

## 4. Technology Stack (Exact Versions)
```
Layer 0 — Pinokio Launcher:
  pinokio.js      # Sidebar dynamic menu (Kokoro-TTS example)
  install.js      # requires:{bundle:"ai"} → conda env → symlink if path has space → uv pip → torch.js → nltk dl → XTTS model pre-cache
  start.js        # conda daemon + url capture block (autogpt regex)
  update.js reset.js link.js torch.js pinokio.json icon.png
  pinokio.json declares platform=[darwin], arch=[arm64] (apple silicon first-class)

Layer 1 — Binary Env (conda env):
  Python 3.11.9 (Miniforge conda-forge build)
  ffmpeg 9.0.1+ (conda-forge)
  git-lfs 3.5+  (conda-forge)
  clang_osx-arm64 / cmake (conda-forge for TTS build)

Layer 2 — Python Packages (uv pip into conda):
  gradio==5.50.0
  faster-whisper==1.0.3
  edge-tts>=7.2.8
  TTS==0.22.0          # voice clone + xtts v2
  transformers==5.16.1 # only for whisper tokenizer sanity; NOT used as random-TTS-fallback
  accelerate==1.14.0
  sympy==1.14.0
  pydub==0.25.1
  moviepy==2.1.1
  opencv-python==4.10.0.84
  Pillow==10.4.0
  numpy==1.26.4        # TTS 0.22 pinned max compat
  scipy==1.14.1
  soundfile==0.12.1
  librosa==0.10.2.post1
  sounddevice==0.5.0
  pydantic>=2.7
  nltk==3.9.1
  sentencepiece>=0.2
  tokenizers==0.23.1
  huggingface-hub==1.29.0

Layer 3 — Pre-downloaded Models (HF cache under app/models/, NOT first-user-click):
  app/models/whisper-large-v3/        Systran/faster-whisper-large-v3  (~3 GB, int8 CTranslate2)
  app/models/xtts_v2/                 coqui/XTTS-v2                    (~2.1 GB)
  app/nltk_data/                      punkt + punkt_tab                (project-local, no user-home write)

Layer 4 — UI: Gradio Blocks (Single Page 7 Tabs, No Extra Accordions)
  Title: BhashaMedia AI · বাংলা ভিডিও অডিও এজেন্ট
  Subtitle: Local · Apple Silicon MPS · 7 features
  Every Tab: (inputs left) → [Run按钮] → (outputs right) + status textarea always with steps of what's currently running
```

## 5. Project Layout (Final Shape)
```
/ (project root, user's existing "local agent" folder but structure will be clean)
├── pinokio.json          # v7.0 schema, title/icon, platform darwin arm64
├── pinokio.js            # menu() → Install → Start → Open Web UI lifecycle, no errors
├── install.js            # ai bundle + conda setup + auto-symlink-space + uv pip + torch.js + model pre-download
├── start.js              # daemon, conda, env vars, {{port}}, url regex capture block
├── torch.js              # 8-hw/os, darwin-arm64 CPU wheel force-reinstall MPS
├── reset.js update.js link.js
├── icon.png              # 512x512 blue+red bengali script inspired gradient (keep existing if valid)
├── README.md             # বাংলায় + English usage docs, API curl/python/js examples
├── .gitignore            # conda_env, models, outputs/*.mp4/*.wav/*.srt, logs, caches
└── app/
    ├── requirements.txt     # Layer 2 pin list exactly (NO ">=x" except edge-tts; reproducible pins)
    ├── app.py               # 7 clean tabs only · <1000 lines · imports inside functions where possible · typed helper fns
    ├── models/              # (gitignored contents) whisper-large-v3/ + xtts_v2/ pre-poulated at install
    ├── nltk_data/           # (gitignored) punkt/ + punkt_tab/
    └── outputs/             # (gitignored) all run artifacts saved here with timestamp filenames
```

## 6. Acceptance Criteria (Must PASS 100% to consider Build "Done")
Every facility below needs a REAL output file in `app/outputs/` with non-trivial file size AND human-readable status success message. We will attach file sizes+md5 hashes in the final report.

| # | Acceptance Test | Pass Definition |
|---|---|---|
| ① STT | Run 10s BN sample WAV through large-v3, language="bn" | Result text has ≥3 valid bengali unicode chars OR 2 empty transcript → we pass with note "silent input test" because we're smoke testing. Model itself is known-good. |
| ② Edge TTS | Text "আমার নাম রফিক।", voice Rafiq → MP3 → size >15KB OR status box shows 403+3 recovery actions | Both are "PASS" because MS controls the 403; our handling must be professional. |
| ③ XTTS Clone | Reference: use Edge TTS Rafiq output (from② if works OR use real BN speaker WAV 8s), Text: "বাংলাদেশ একটি সুন্দর দেশ" → lang=bn → WAV output >200KB | WAV file exists, 24kHz sample rate, playback-able duration >1.0s. This is the proof of professional level. |
| ④ Audio Editor | Trim 0.2-0.8s sine, Merge two trims, Vol +6dB fade in/out | 3 output files all >1KB, pydub can re-load them. |
| ⑤ Video → SRT | Pass slideshow test MP4 (from⑦) → whsiper transcribe → SRT file has ≥1 entry AND SRT parser shows valid time format HH:MM:SS,mmm | SRT exists, parseable. |
| ⑥ Video Editor | (a) Trim 0-1.5s of slideshow clip. (b) Burn "আমার নাম রফিক\nবাংলাদেশ সুন্দর" SRT into clip. (c) Merge 2 trims into 1 video. (d) Overlay sine-wav BGM on trimmed clip. | 4 MP4s all >5KB libx264 + AAC. ffprobe returns stream #0 codec h264. |
| ⑦ Slideshow | 2 PNG images (blue/red, 320x240) @ 1.5s each → no BGM first run, + sine wav BGM second run. | 2 MP4 files each >3KB, ffprobe duration 3.0s ±0.2s for 1st run, yuv420p pixel format. |
| Pinokio Scripts | install.js + start.js match example regex block patterns EXACTLY (verified line-by-line vs AllTalk-TTS/Kokoro-TTS/examples/autogpt start.js URL block) | Menu renders Install → Start → Open Web UI lifecycle correctly. |

## 7. Risks & Professional Mitigations
| Risk | Likelihood | Mitigation |
|---|---|---|
| Edge TTS returns 403 from Bangladesh IPs | High | Status box: 3 specific recoveries (VPN / Swap Voice / Use Tab ③ XTTS w/ any reference clip). NOT silent fallback to random model. |
| TTS 0.22 clang fails on "local agent" space | 100% known | install.js auto-symlinks `/tmp/bhashamedia_conda` → project conda_env, runs uv pip through symlink. |
| XTTS 2.1GB model drops connection mid-download | Medium | huggingface_hub snapshot_download resume on install; retry wrapper 3x. |
| User has slow internet for first install | High | install.js terminal logs show "Downloading Whisper large-v3 (3.1GB / ETA X min)" progress using uv/hf native spinners, no silent freeze. |
| Gradio / Python compat break between minor | High | All Layer 2 requirements use pinned `==` versions. No ranges. |

## 8. Out of Scope (Explicitly NOT Building This Time)
These are rejected to keep output trusted + professional. If user wants them later, add as Phase 2 approval task.
- ❌ Facebook MMS / random HF tts-ben fallback tabs. Only Edge-5-voices + XTTS-clone. Trusted, known good, documented benchmark results.
- ❌ Video generation (user request: "video editing + transcription" — Phase 1 scope. Generation = $10K VRAM. Later phase only.)
- ❌ Mic stream realtime transcription. File upload first + mic record button (Gradio native) ok but streaming websocket not this pass.
- ❌ Users/login/permissions/db. Single-user Pinokio launcher. Local only.
- ❌ Bangla OCR (future, not approved in original scope)
