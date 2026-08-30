#!/usr/bin/env python3
"""Run the pinned LongCat-Video-Avatar MLX runtime for Studio.

This adapter deliberately has no synthetic or still-image path. It loads the
audio-conditioned LongCat Avatar 1.5 model, generates moving frames from the
consented reference and audio, then muxes the original voice track into MP4.

The worker invokes this file with the managed virtualenv created by
install_presenter.sh. The runtime checkout and model are kept outside project
data under ~/Library/Application Support/LocalAIStudio/presenter/.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, NoReturn


SUPPORT_DIR = Path.home() / "Library" / "Application Support" / "LocalAIStudio" / "presenter"
RUNTIME_DIR = SUPPORT_DIR / "longcat-avatar-mlx"
RUNTIME_COMMIT = "e2e1e8701424cef0e601281b62e228e5289ed032"
WEIGHTS_DIR = SUPPORT_DIR / "weights"
WHISPER_FEATURE_DIR = SUPPORT_DIR / "whisper-large-v3"
MODEL_MANIFEST = SUPPORT_DIR / "presenter_model.json"
MODEL_SPECS: dict[str, dict[str, str]] = {
    "q4": {
        "runtimeVariant": "q4-merged",
        "repository": "mlx-community/LongCat-Video-Avatar-1.5-q4-dmd-merged",
        "revision": "5d5b5d61ce6c206930a94c760f6941aff03f9389",
        "directory": "LongCat-Video-Avatar-1.5-q4-dmd-merged",
        "label": "LongCat-Video-Avatar 1.5 q4 DMD-merged",
    },
    "bf16": {
        "runtimeVariant": "merged",
        "repository": "mlx-community/LongCat-Video-Avatar-1.5-bf16-dmd-merged",
        "revision": "e80d3712658fc91e2f2a0a8a3b5d7a6230ca9ab3",
        "directory": "LongCat-Video-Avatar-1.5-bf16-dmd-merged",
        "label": "LongCat-Video-Avatar 1.5 bf16 DMD-merged",
    },
}
FPS = 25
FRAMES_PER_CHUNK = 93
MIN_FRAMES = 29
MAX_DURATION_PER_CHUNK = (FRAMES_PER_CHUNK - 1) / FPS


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def require_command(name: str) -> str:
    command = shutil.which(name)
    if not command:
        fail(f"Required command '{name}' is not installed. Run install_presenter.sh again.")
    return command


def load_runtime_module() -> Any:
    runtime_script = RUNTIME_DIR / "scripts" / "run_inference.py"
    if not runtime_script.is_file():
        fail(f"Pinned LongCat MLX runtime is missing: {runtime_script}")
    spec = importlib.util.spec_from_file_location("local_ai_studio_longcat_runtime", runtime_script)
    if spec is None or spec.loader is None:
        fail("Could not load the pinned LongCat MLX runtime.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def selected_model() -> dict[str, str]:
    if not MODEL_MANIFEST.is_file():
        fail(
            "Presenter model selection is missing. "
            "Run install_presenter.sh to select and install q4 or bf16."
        )
    try:
        manifest = json.loads(MODEL_MANIFEST.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Presenter model selection manifest is unreadable: {error}")
    if not isinstance(manifest, dict):
        fail("Presenter model selection manifest must be a JSON object.")

    variant = manifest.get("variant")
    if not isinstance(variant, str):
        fail("Presenter model selection manifest has no valid model variant.")
    expected = MODEL_SPECS.get(variant)
    if expected is None:
        fail(f"Unsupported presenter model variant in manifest: {variant!r}")
    for key, expected_value in (
        ("runtimeVariant", expected["runtimeVariant"]),
        ("repository", expected["repository"]),
        ("revision", expected["revision"]),
        ("directory", str(WEIGHTS_DIR / expected["directory"])),
        ("label", expected["label"]),
        ("runtimeCommit", RUNTIME_COMMIT),
    ):
        if manifest.get(key) != expected_value:
            fail(
                f"Presenter model manifest does not match the pinned {variant} "
                f"configuration for {key}."
            )
    return {"variant": variant, **expected}


def model_path(model: dict[str, str]) -> Path:
    return WEIGHTS_DIR / model["directory"]


def validate_runtime_variant(runtime: Any, model: dict[str, str]) -> None:
    runtime_variants = getattr(runtime, "VARIANT_DIRNAMES", None)
    if not isinstance(runtime_variants, dict):
        fail("Pinned LongCat MLX runtime does not expose its model variant mapping.")
    if runtime_variants.get(model["runtimeVariant"]) != model["directory"]:
        fail(
            "Pinned LongCat MLX runtime/model variant mismatch: "
            f"{model['runtimeVariant']} does not load {model['directory']}."
        )


def validate_model_variant(model: dict[str, str]) -> None:
    config_path = model_path(model) / "dit" / "config.json"
    try:
        config = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"LongCat model variant metadata is unreadable: {error}")
    if not isinstance(config, dict):
        fail("LongCat model variant metadata must be a JSON object.")
    quantization = config.get("quantization")
    if model["variant"] == "q4":
        if not isinstance(quantization, dict) or quantization.get("bits") != 4:
            fail("LongCat q4 model variant is missing its 4-bit quantization metadata.")
    elif quantization is not None:
        fail("LongCat bf16 model variant contains quantized weights; refusing a mixed install.")


def check_install() -> tuple[dict[str, str], Any]:
    model = selected_model()
    require_command("ffmpeg")
    require_command("ffprobe")
    if not (SUPPORT_DIR / "presenter_pipeline.py").is_file():
        fail("presenter_pipeline.py is not installed in the Local AI Studio support directory.")
    if not RUNTIME_DIR.is_dir() or not (RUNTIME_DIR / ".git").is_dir():
        fail("Pinned LongCat MLX runtime is not installed.")
    installed_commit = run([
        require_command("git"),
        "-C",
        str(RUNTIME_DIR),
        "rev-parse",
        "HEAD",
    ], capture=True).stdout.strip()
    if installed_commit != RUNTIME_COMMIT:
        fail(
            "The installed LongCat MLX runtime is not the pinned revision "
            f"{RUNTIME_COMMIT}."
        )
    if not model_path(model).is_dir():
        fail(
            "LongCat MLX model weights are not installed. "
            f"Download {model['repository']} at revision {model['revision']} into {model_path(model)}."
        )
    required_files = (
        "audio_encoder/config.json",
        "dit/config.json",
        "dit/diffusion_pytorch_model.safetensors.index.json",
        "pipeline_config.json",
        "text_encoder/config.json",
        "text_encoder/model.safetensors.index.json",
        "tokenizer/tokenizer.json",
        "vae/config.json",
        "vae/diffusion_pytorch_model.safetensors",
    )
    missing = [name for name in required_files if not (model_path(model) / name).is_file()]
    if missing:
        fail(f"LongCat MLX model weights are incomplete; missing: {', '.join(missing)}")
    validate_model_variant(model)
    if not WHISPER_FEATURE_DIR.is_dir():
        fail("Whisper feature configuration is not installed.")
    try:
        import mlx  # noqa: F401
    except ImportError as error:
        fail(f"MLX is not available in the worker virtualenv: {error}")
    runtime = load_runtime_module()
    validate_runtime_variant(runtime, model)
    return model, runtime


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture,
    )


def extract_audio(audio: Path, output: Path, start: float, duration: float) -> None:
    run([
        require_command("ffmpeg"),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(audio),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output),
    ])


def image_reference(reference: Path, temporary: Path) -> Path:
    # LongCat's MLX AI2V path consumes one image frame. For a video reference,
    # use its first real frame as the identity/reference image; generated
    # motion still comes from the audio-conditioned model, never from a loop.
    suffix = reference.suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        return reference
    output = temporary / "reference-frame.png"
    run([
        require_command("ffmpeg"),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(reference),
        "-frames:v",
        "1",
        str(output),
    ])
    if not output.is_file() or output.stat().st_size == 0:
        fail("The real-human reference video did not contain a readable frame.")
    return output


def preprocess_audio(audio: Path) -> Any:
    import librosa
    import mlx.core as mx
    import numpy as np
    from transformers import WhisperFeatureExtractor

    samples, _ = librosa.load(str(audio), sr=16000, mono=True)
    extractor = WhisperFeatureExtractor.from_pretrained(str(WHISPER_FEATURE_DIR))
    features = extractor(samples, sampling_rate=16000, return_tensors="np").input_features
    return mx.array(features.astype(np.float32))


def write_video(video: Any, path: Path) -> None:
    import imageio
    import numpy as np

    # Runtime output is [B, C, T, H, W]. This conversion is the same shape
    # contract used by the upstream MLX inference script.
    frames = (
        np.asarray(video)
        .transpose(0, 2, 3, 4, 1)[0]
        .__add__(1)
        .__mul__(127.5)
        .clip(0, 255)
        .astype(np.uint8)
    )
    if len(frames) < 2:
        fail("LongCat MLX returned fewer than two frames; refusing a static output.")
    writer = imageio.get_writer(str(path), fps=FPS, codec="libx264", quality=8)
    try:
        for frame in frames:
            writer.append_data(frame)
    finally:
        writer.close()


def mux_audio(video: Path, audio: Path, output: Path, duration: float) -> None:
    run([
        require_command("ffmpeg"),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output),
    ])


def concatenate_videos(videos: list[Path], output: Path) -> None:
    if len(videos) == 1:
        shutil.copyfile(videos[0], output)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as listing:
        listing_path = Path(listing.name)
        for video in videos:
            listing.write(f"file '{video.as_posix().replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n")
    try:
        run([
            require_command("ffmpeg"),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listing_path),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            str(output),
        ])
    finally:
        listing_path.unlink(missing_ok=True)


def verify_output(path: Path, expected_duration: float) -> None:
    probe = run([
        require_command("ffprobe"),
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ], capture=True)
    data = json.loads(probe.stdout)
    streams = data.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    duration = float(data.get("format", {}).get("duration") or 0)
    if not video or not video.get("width") or not video.get("height") or not audio:
        fail("LongCat output did not contain a readable MP4 video and voice audio.")
    if duration < max(1, expected_duration - 0.5):
        fail("LongCat output was shorter than the requested presenter performance.")

    # Match the server's non-static check before upload. The output must have
    # at least two scene changes; audio alone is never enough.
    motion = run([
        require_command("ffmpeg"),
        "-hide_banner",
        "-loglevel",
        "info",
        "-i",
        str(path),
        "-vf",
        "select='gt(scene,0.001)',showinfo",
        "-an",
        "-f",
        "null",
        "-",
    ], capture=True)
    showinfo = f"{motion.stdout}{motion.stderr}"
    if len(re.findall(r"showinfo.*n:\s*\d+", showinfo)) < 2:
        fail("LongCat output was visually static; refusing to upload a still-image fallback.")


def generate(args: argparse.Namespace) -> None:
    if not args.reference.is_file() or args.reference.stat().st_size == 0:
        fail("The consented real-human reference file is missing or empty.")
    if not args.audio.is_file() or args.audio.stat().st_size == 0:
        fail("The local voice track is missing or empty.")
    if args.duration <= 0 or args.duration > 120:
        fail("Presenter duration must be between 1 and 120 seconds.")
    model, runtime = check_install()

    import mlx.core as mx

    variant_directory = model_path(model)
    pipeline = runtime.build_pipeline(WEIGHTS_DIR, variant=model["runtimeVariant"])
    reference_prompt = (
        f"A real human presenter speaking directly to camera with natural "
        f"{args.delivery_mode} delivery, {args.framing} framing. "
        f"Visible mouth, face, head, shoulder, torso, and body movement follows "
        f"the speech. {args.script.strip()}"
    )
    ids, mask = runtime.tokenize_prompt(reference_prompt, variant_directory)
    text_hidden = pipeline.text_encoder(ids, mask=mask)
    text_embeds = text_hidden[:, None, :, :]
    text_mask = mask[:, None, None, :]
    empty_ids = mx.zeros_like(ids)
    empty_mask = mx.zeros_like(mask)
    uncond_hidden = pipeline.text_encoder(empty_ids, mask=empty_mask)
    uncond_embeds = uncond_hidden[:, None, :, :]
    uncond_mask = empty_mask[:, None, None, :]

    with tempfile.TemporaryDirectory(prefix="local-ai-presenter-") as temporary_name:
        temporary = Path(temporary_name)
        reference = image_reference(args.reference, temporary)
        # Re-run preprocessing for a video reference's extracted first frame.
        image = runtime.preprocess_image(reference, height=480, width=832)
        clips: list[Path] = []
        offset = 0.0
        remaining = args.duration
        chunk_index = 0
        while remaining > 0.001:
            chunk_duration = min(MAX_DURATION_PER_CHUNK, remaining)
            frames = max(MIN_FRAMES, min(FRAMES_PER_CHUNK, 1 + math.ceil(chunk_duration * FPS / 4) * 4))
            chunk_audio = temporary / f"audio-{chunk_index}.wav"
            raw_video = temporary / f"video-{chunk_index}.mp4"
            extract_audio(args.audio, chunk_audio, offset, chunk_duration)
            audio_mel = preprocess_audio(chunk_audio)
            video = pipeline(
                image=image,
                audio_mel=audio_mel,
                text_embeds=text_embeds,
                text_mask=text_mask,
                uncond_embeds=uncond_embeds,
                uncond_mask=uncond_mask,
                height=480,
                width=832,
                num_frames=frames,
                seed=42 + chunk_index,
            )
            mx.eval(video)
            write_video(video, raw_video)
            clips.append(raw_video)
            offset += chunk_duration
            remaining -= chunk_duration
            chunk_index += 1

        silent_video = temporary / "silent-video.mp4"
        concatenate_videos(clips, silent_video)
        mux_audio(silent_video, args.audio, args.output, args.duration)
        verify_output(args.output, args.duration)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate the installed runtime without generating.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable check details.")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--mode", default="presenter-lipsync")
    parser.add_argument("--framing", choices=("close-up", "waist-up", "full-body"), default="close-up")
    parser.add_argument(
        "--delivery-mode",
        choices=("conversational", "presentational", "energetic", "calm"),
        default="presentational",
    )
    parser.add_argument("--duration", type=float)
    parser.add_argument("--script", default="")
    args = parser.parse_args()
    if not args.check and (args.reference is None or args.audio is None or args.output is None or args.duration is None):
        parser.error("--reference, --audio, --output, and --duration are required for generation")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            model, _ = check_install()
            check_report = {
                "model": model["label"],
                "repository": model["repository"],
                "revision": model["revision"],
                "runtimeCommit": RUNTIME_COMMIT,
                "variant": model["variant"],
            }
            if args.json:
                print(json.dumps(check_report, sort_keys=True))
            else:
                print(
                    "LongCat MLX presenter runtime, "
                    f"{model['label']} model (revision {model['revision']}), "
                    "and media tools are ready."
                )
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            generate(args)
            print(f"Generated verified speech-synchronized presenter MP4: {args.output}")
        return 0
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"Presenter pipeline failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())