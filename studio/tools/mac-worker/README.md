# Local AI Studio Mac worker

This folder contains the native companion used to connect an Apple Silicon Mac to
Studio. It is intentionally separate from project data and does not write
provider tokens to disk outside macOS Keychain.

## Build and sign on macOS

1. Open Studio Settings and generate a one-time pairing code.
2. Install the pinned LongCat-Video-Avatar 1.5 MLX presenter runtime and its
   model weights. This is a production install: it requires Apple Silicon,
   Python 3.12, Metal/MPS, ffmpeg, and the disk and memory capacity for the
   selected model:

```sh
cd /path/to/LocalAIStudio/tools/mac-worker
bash install_presenter.sh
```

   The installer uses Homebrew, creates an isolated Python environment at
   `~/Library/Application Support/LocalAIStudio/presenter/.venv`, pins the
   `xocialize/longcat-avatar-mlx` runtime to a reviewed commit, records the
   selected model revision in
   `~/Library/Application Support/LocalAIStudio/presenter/presenter_model.json`,
   and verifies the install.

   The safe default is the 4-bit q4 DMD-merged model:

   - `bash install_presenter.sh` or `bash install_presenter.sh --variant q4`
   - about 25 GB of model weights; keep at least 30 GB free on the model disk
   - at least 32 GB unified memory is recommended for generation

   Owners of Macs with at least 64 GB unified memory can opt into the higher
   quality bf16 DMD-merged model:

   - `bash install_presenter.sh --variant bf16` (or `bash install_presenter.sh --bf16`)
   - about 46.4 GB of model weights; keep at least 55 GB free on the model disk
   - at least 64 GB unified memory is required; the installer refuses bf16 on
     smaller Macs

   The selected variant and exact Hugging Face revision are persisted in the
   manifest. Use `bash install_presenter.sh --no-model` to install dependencies
   and write the selection without downloading weights; the worker stays
   blocked until those exact weights are present.
   
   Install the MLX-native image runtime separately:

```sh
bash install_image.sh
```

   This creates
   `~/Library/Application Support/LocalAIStudio/image/.venv`, installs the
   pinned mflux `0.19.1`, copies the adapter,
   and downloads an 8-bit local FLUX.1-schnell checkpoint. On an M1 Pro with
   64 GB unified memory, allow roughly 15 GB of free disk space. To prepare
   dependencies without downloading weights, use `bash install_image.sh
   --no-model`; readiness remains false until the model is installed.
3. Build the worker:

```sh
swiftc -O -o StudioWorker StudioWorker.swift \
  -framework Metal -framework Security -framework CryptoKit
```

4. Sign the binary with the developer certificate used by your Mac deployment:

```sh
codesign --force --options runtime --sign "Developer ID Application: YOUR TEAM" StudioWorker
```

5. Start it with the Studio API base URL and the pairing code:

```sh
./StudioWorker --studio-url https://your-studio-host/api --pairing-code ONE_TIME_CODE
```

The worker sends a nonce-signed health report and heartbeat, then polls only
approved commands. Model downloads are restricted to a known Phi-3 MLX
repository mapping. Hugging Face credentials are read without terminal echo and
stored under the macOS Keychain service `com.localaistudio.mac-worker`; the
credential value is never sent to Studio or written to worker logs.

## Image generation capability

Image jobs run entirely through mflux's native MLX FLUX.1-schnell
implementation; there is no placeholder or synthetic fallback. The signed
health report advertises `imagePipeline` and the exact `imageModel` only after
the separate image virtualenv, pinned mflux package, manifest, and local
checkpoint pass diagnostics.

The adapter accepts `--prompt`, `--negative-prompt`, `--output`, `--width`,
`--height`, `--steps`, `--guidance`, and `--seed`. Dimensions must be
multiples of 64 from 512 through 2048. FLUX.1-schnell has distilled guidance,
so mflux accepts but may explicitly report that negative prompt/guidance are
ignored for this model. Generated files must be valid, nontrivial PNGs at the
requested dimensions before the worker uploads them.

Check readiness without generating:

```sh
"$HOME/Library/Application Support/LocalAIStudio/image/.venv/bin/python" \
  "$HOME/Library/Application Support/LocalAIStudio/image/image_pipeline.py" \
  --check --json
```

Manual generation:

```sh
"$HOME/Library/Application Support/LocalAIStudio/image/.venv/bin/python" \
  "$HOME/Library/Application Support/LocalAIStudio/image/image_pipeline.py" \
  --prompt "A product photograph of a ceramic teapot" \
  --negative-prompt "" --output "$HOME/Desktop/teapot.png" \
  --width 1024 --height 1024 --steps 4 --guidance 0 --seed 42
```

`generate-image` jobs emit progress through the existing Studio job-events
endpoint and upload `{data, mimeType: "image/png", metadata}` to
`system/bridge/studio-jobs/{jobId}/image-output`.

## Human presenter capability

Presenter jobs are not image wrappers. The signed worker advertises presenter
readiness only when all of these are available on the Mac:

- Apple Silicon Metal/MPS and Python + MLX
- The installed local human-performance pipeline at
  `~/Library/Application Support/LocalAIStudio/presenter/presenter_pipeline.py`
- A pipeline that accepts `--reference`, `--audio`, `--output`, `--mode`,
  `--framing`, `--delivery-mode`, `--duration`, and `--script`, and writes a
  real MP4 with synchronized voice audio and visible human motion

The shipped `presenter_pipeline.py` adapter runs LongCat-Video-Avatar 1.5 in
MLX AI2V mode. It uses the real-human reference for identity, Whisper audio
embeddings for speech-conditioned motion, and generates in 93-frame chunks for
longer scenes before muxing the original voice track. It accepts image
references and extracts the first frame of a real-human video reference; it
does not loop or wrap that frame as output. It rejects missing weights,
audio-less output, short output, and visually static output before upload.

The default q4 DMD-merged variant is the supported broadly compatible choice.
The installer can select the bf16 DMD-merged variant for Macs with at least
64 GB unified memory; it records the exact model revision and runtime variant
together in the presenter manifest. The adapter validates that manifest against
its allowlisted q4/bf16 mapping and the pinned MLX runtime before readiness is
advertised. Do not copy weights between variant directories or edit the
manifest by hand; mismatches block the worker rather than silently falling
back to q4.

To validate the installed runtime without generating a video:

```sh
"$HOME/Library/Application Support/LocalAIStudio/presenter/.venv/bin/python" \
  "$HOME/Library/Application Support/LocalAIStudio/presenter/presenter_pipeline.py" \
  --check
```

The check output names the selected model variant and revision. The signed
worker includes that same label in its readiness report, so Studio can show
whether the connected Mac is using q4 or bf16.

The worker downloads only the consented reference and local voice track for the
command, runs that pipeline locally, and uploads the MP4 over the signed bridge.
Studio verifies the MP4 has audio, the requested duration, and non-static video
motion before marking it complete. If the pipeline is missing or verification
fails, the job is failed with an actionable message; there is no still-image or
audio-only fallback.