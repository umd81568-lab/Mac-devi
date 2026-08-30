# TASK BREAKDOWN — 6 Phases (Only after SPEC + CHECKLIST APPROVED)

**Start Rule:** NO file edits, NO pip installs, NO launcher script rewrites happen until user explicitly replies **"✅ APPROVED start build"** to the spec documents. This is the professional workflow.

## Legend
- **Output Evidence Column = real, inspectable proof the task is 100% done (not "I think it worked").**

---

## Phase 1: Clean Install Foundation — Reset + Conda Env + Space-Symlink
**Goal:** Factory-fresh environment so we don't inherit ad-hoc prior bugs.

| # | Task | Output Evidence |
|---|---|---|
| 1.1 | Archive current state: copy `app.py` → `.archive/app.py.bak_<timestamp>`, move current `conda_env` → `conda_env_old_backup` (kept 7 days in case rollback). | `ls -lah .archive/` shows backup files |
| 1.2 | If project path contains SPACE char, create `/tmp/bhashamedia_conda` → `./conda_env` symlink with `ln -sfn`. | `ls -la /tmp/bhashamedia_conda` is a symlink pointing to the project conda_env (will be valid after env creation) |
| 1.3 | Create conda env python=3.11.9. Add conda-forge channel. Install pinned: `ffmpeg>=9`, `git-lfs>=3.5`, `cmake`, `clang_osx-arm64`, `cxx-compiler`, `pkg-config`. | `conda_env/bin/python --version` = 3.11.9, `conda_env/bin/ffmpeg -version` contains 9.0.x, `which cmake from conda env` returns non-empty. |
| 1.4 | Now that conda_env exists, re-run 1.2 symlink so `/tmp/bhashamedia_conda/bin/python` resolves correctly. | `/tmp/bhashamedia_conda/bin/python --version` returns 3.11.9 ✅ — this is the proof clang won't fail on space path later. |

## Phase 2: Python Dependency Install — Core + Torch + TTS (Critical)
**Note:** Every pip step that can compile C extensions uses `/tmp/bhashamedia_conda/bin/python`.

| # | Task | Output Evidence |
|---|---|---|
| 2.1 | Install all Layer 2 requirements.txt pinned packages. Use `/tmp/bhashamedia_conda/bin/python -m pip install --no-cache-dir -r app/requirements.txt` (pinned == versions). | `pip list` exact versions match SPEC Layer 2 table — no version drift warnings. |
| 2.2 | Run [torch.js](file:///Users/jui/Documents/trae_projects/local%20agent/torch.js) darwin arm64 block equivalent manually via shell first (same commands). Install torch 2.7.0 / torchaudio 2.7.0 / torchvision 0.22 darwin-arm64 CPU wheels `--force-reinstall --no-deps`. | `torch --version == 2.7.0` + `torch.backends.mps.is_available() == True`. Run _check_env.py → all core packages 100% PASS. |
| 2.3 | Install TTS 0.22.0 **using symlink python**: `/tmp/bhashamedia_conda/bin/python -m pip install --no-cache-dir TTS==0.22.0`. Build monotonic_align C extension — **must use the symlink so clang -isystem contains no spaces**. | Exit code 0. `from TTS.api import TTS` import success. `TTS().list_models()` string contains `xtts_v2`. |

## Phase 3: Model Pre-Downloads (NOT on First User Click)
**Goal:** Install-time download everything. User first click = instant inference.

| # | Task | Output Evidence |
|---|---|---|
| 3.1 | NLTK: `mkdir -p app/nltk_data && NLTK_DATA="$PWD/app/nltk_data" python -c "import nltk; nltk.download('punkt'); nltk.download('punkt_tab')"`. | `ls app/nltk_data/tokenizers/punkt/PY3/*.pickle` exists. |
| 3.2 | Whisper large-v3: `Systran/faster-whisper-large-v3` → `app/models/whisper-large-v3/` via huggingface_hub snapshot_download. | `du -sh app/models/whisper-large-v3/` size ≥ 2.5 GB. HF_HUB_OFFLINE=1 test: `WhisperModel(..., download_root=app/models)` loads without network call. |
| 3.3 | XTTS v2: `coqui/XTTS-v2` → `app/models/xtts_v2/` via snapshot_download. Include config, model, vocab, speakers reference if any. | `du -sh app/models/xtts_v2/` ≥ 1.5 GB. Contains `model.pth` or equivalent safetensors + `config.json`. |
| 3.4 | Create app/outputs dir. Write `.gitkeep` to app/models/, app/outputs/, app/nltk_data/ dirs so git tracks folder structure (actual contents in .gitignore). | `ls app/models app/outputs app/nltk_data` — 3 dirs exist with .gitkeep files. |

## Phase 4: Launcher Scripts Final Form (Pinokio Runtime)
Goal: match examples line-by-line (see CHECK_LIST.md §4 for exact lines).

| # | Task | Output Evidence |
|---|---|---|
| 4.1 | Finalize install.js: add auto-symlink BEFORE TTS install + Layer 2 requirements + torch.js + nltk + model downloads. | `node -c install.js` syntax OK. Contains `requires: { bundle: "ai" }` + Critical URL regex block in start.js. |
| 4.2 | Finalize start.js: conda attribute + 4 env vars + `{{port}}` + URL capture regex (verbatim from mochi example with index `[1]`). | `node -c start.js` syntax OK. Side-by-side vs mochi start.js the `on:` + `local.set` patterns match char-by-char. |
| 4.3 | Finalize pinokio.js: Install → Start → Open Web UI lifecycle. Use `info.exists("conda_env")`, `info.running(...)`, `info.local().url`. | `node -c pinokio.js` OK. Open Web UI `href` uses `{{local.url}}` exactly. |
| 4.4 | torch.js cross platform: all 8 branches accept BOTH venv AND conda args. Apple Silicon = torch 2.7.0 CPU wheel force install. | `node -c torch.js` OK. |
| 4.5 | reset.js / update.js / link.js / pinokio.json / icon.png final pass. | `node -c <each>` OK. pinokio.json JSON schema valid (no trailing commas). |

## Phase 5: App UI Final Form (app.py) — 7 Clean Tabs Only
**Goal:** Remove Local MMS tab + any ad-hoc helpers. Keep minimal.

| # | Task | Output Evidence |
|---|---|---|
| 5.1 | Remove `local_bangla_tts()` function + "🌐 Local Bangla TTS (Facebook MMS)" tab. | app.py grep: NO occurrence of `facebook/mms-tts-ben`, NO `local_bangla_tts` function. |
| 5.2 | Verify tab order: ① STT / ② Edge TTS / ③ XTTS Clone / ④ Audio Edit / ⑤ Video SRT / ⑥ Video Editor / ⑦ Slideshow. Exactly 7 `with gr.Tab()` statements. | Grep count `with gr.Tab(` = **7**. |
| 5.3 | Edge TTS graceful error handler. ANY of 403/NoAudio/WS/empty/timeout → print 3 specific recovery actions (VPN / Swap Voice / Tab ③ XTTS). | Code path review. Simulate error via raising a test Exception → status text contains all 3 recovery bullet points. |
| 5.4 | XTTS voice clone tab. Use TTS class directly, `model_name="tts_models/multilingual/multi-dataset/xtts_v2"` with local cache dir. `language="bn"` hardcoded as default (dropdown still shows "bn", "en", "hi" for experimentation). | Import from inside function only. Graceful ImportError → "One-time fix needed: TTS not compiled → one-click Reinstall Button will run symlink step (already done in install.js)". |
| 5.5 | NLTK_DATA top-of-file setter. | app.py L20-ish has `Path(__file__).parent / "nltk_data"` mkdir with `os.environ.setdefault("NLTK_DATA", ...)`. |
| 5.6 | `python -m py_compile app/app.py` → exit 0. ✅ Syntax clean. | Exit code 0 from py_compile. |

## Phase 6: End-to-End Verification + User Report
**Goal:** Every facility produces **real output file** we can list with file sizes.

| # | Task | Output Evidence |
|---|---|---|
| 6.1 | Write and run `_verify_all_facilities.py` runner script (calls the functions in app.py directly). | Produces a markdown table. |
| 6.2 | Boot Gradio server: `PYTORCH_ENABLE_MPS_FALLBACK=1 ... python app.py --server-port {{port}}` in daemon background. Capture Running URL in log. | `curl <URL>/api/info` returns HTTP 200/405 either (means server live). |
| 6.3 | Run facility tests ①-⑦ (see acceptance criteria SPEC §6), record file size/sr/duration. | app/outputs/ has ≥ 15 files (STT 3, TTS 2, Audio 3, Video SRT 2, Video Editor 4, Slideshow 2). All video files pass ffprobe h264 check. |
| 6.4 | Final Pass-Fail report delivered to user via chat (7 rows + summary). | Report table has Status column green for 7/7 (or if Edge-403 still blocks after VPN mention, the report notes professional resolution plan clearly). |
| 6.5 | README.md final pass: add "7 Facilities" overview table, 1-line Pinokio install steps, Curl + Python + JS API call examples, Troubleshooting section with 3 Q&A (Edge 403 / TTS build space path / slow model downloads). | File ends with `---` line and has ≥3 API examples. |

## Estimated Phase Durations (Apple M1/M2/M3, 50 Mbps)
| Phase | Approx Duration |
|---|---|
| 1 Clean Foundation | 3 min |
| 2 Python deps + TTS C-extension | 8-10 min (TTS compile is long) |
| 3 Models (Whisper 3G + XTTS 2.1G) | 10-15 min (depends on internet) |
| 4 Launcher JS polish | 4 min |
| 5 App UI final cleanup | 3 min |
| 6 E2E Verification | 15 min (first inference model loads) |
| **Total** | **~45 min - 1 hr** |

## Rollback Plan (If Any Phase Fails)
- Phase1 failure: delete conda_env, start fresh. Old conda_env_old_backup untouched.
- Phase2 TTS failure: don't proceed to Phase 3. Fix the clang/symlink issue. Document exact fix.
- Phase3 model download interrupt: resume safe with snapshot_download (uses partial cache + resume).
- Phase4 launcher mismatch: compare diff side-by-side against AllTalk-TTS install.js + mochi start.js example blocks.
- Phase5 app break: rollback to `.archive/app.py.bak_<timestamp>`.
- Phase6 facility fail: no final "Done" report. Re-run the _verify_all script until the pass count = 7/7.
