#!/usr/bin/env python3
"""Generate real PNG images locally with mflux and FLUX.1-schnell."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
from pathlib import Path
import subprocess
import sys
from typing import NoReturn

SUPPORT_DIR = Path.home() / "Library" / "Application Support" / "LocalAIStudio" / "image"
MODEL_DIR = SUPPORT_DIR / "FLUX.1-schnell-8bit"
MANIFEST_PATH = SUPPORT_DIR / "image_model.json"
MODEL_NAME = "FLUX.1-schnell"
MODEL_REPOSITORY = "black-forest-labs/FLUX.1-schnell"
MFLUX_VERSION = "0.19.1"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MIN_PNG_BYTES = 10_000


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def validate_dimension(value: int, name: str) -> None:
    if value < 512 or value > 2048 or value % 64:
        fail(f"{name} must be a multiple of 64 between 512 and 2048.")


def load_manifest() -> dict[str, object]:
    try:
        manifest = json.loads(MANIFEST_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Image model manifest is missing or unreadable: {error}")
    expected: dict[str, object] = {
        "model": MODEL_NAME,
        "repository": MODEL_REPOSITORY,
        "mfluxVersion": MFLUX_VERSION,
        "quantize": 8,
        "directory": str(MODEL_DIR),
    }
    if not isinstance(manifest, dict) or any(manifest.get(key) != value for key, value in expected.items()):
        fail("Image model manifest does not match the pinned FLUX.1-schnell configuration.")
    return manifest


def check_install() -> dict[str, object]:
    try:
        installed_version = importlib.metadata.version("mflux")
    except importlib.metadata.PackageNotFoundError:
        fail("mflux is not installed in the managed image virtualenv.")
    if installed_version != MFLUX_VERSION:
        fail(f"Expected mflux {MFLUX_VERSION}, found {installed_version}.")
    try:
        import mlx.core  # noqa: F401
    except ImportError as error:
        fail(f"MLX is not available in the managed image virtualenv: {error}")
    try:
        import PIL  # noqa: F401
    except ImportError as error:
        fail(f"Pillow is not available in the managed image virtualenv: {error}")
    manifest = load_manifest()
    if not MODEL_DIR.is_dir() or not any(MODEL_DIR.iterdir()):
        fail(f"FLUX.1-schnell weights are not installed at {MODEL_DIR}.")
    if not (MODEL_DIR / "config.json").is_file():
        fail("The local mflux FLUX.1-schnell checkpoint is incomplete (config.json is missing).")
    if not any(MODEL_DIR.rglob("*.safetensors")):
        fail("The local mflux FLUX.1-schnell checkpoint contains no safetensor weights.")
    generator = SUPPORT_DIR / ".venv" / "bin" / "mflux-generate"
    if not generator.is_file():
        fail("The managed mflux-generate executable is missing.")
    return manifest


def verify_png(path: Path, width: int, height: int) -> None:
    from PIL import Image

    if not path.is_file() or path.stat().st_size < MIN_PNG_BYTES:
        fail(f"mflux output is missing or smaller than {MIN_PNG_BYTES} bytes.")
    with path.open("rb") as output:
        if output.read(len(PNG_SIGNATURE)) != PNG_SIGNATURE:
            fail("mflux output does not have a PNG signature.")
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.format != "PNG" or image.size != (width, height):
                fail("mflux output is not a valid PNG with the requested dimensions.")
    except (OSError, SyntaxError) as error:
        fail(f"mflux output is not a readable PNG: {error}")


def generate(args: argparse.Namespace) -> None:
    if not args.prompt.strip():
        fail("Prompt must not be empty.")
    validate_dimension(args.width, "Width")
    validate_dimension(args.height, "Height")
    if args.steps < 1 or args.steps > 50:
        fail("Steps must be between 1 and 50.")
    if not math.isfinite(args.guidance) or args.guidance < 0 or args.guidance > 20:
        fail("Guidance must be finite and between 0 and 20.")
    if args.seed < 0 or args.seed > 4_294_967_295:
        fail("Seed must be between 0 and 4294967295.")
    check_install()

    command = [
        str(SUPPORT_DIR / ".venv" / "bin" / "mflux-generate"),
        "--model", str(MODEL_DIR),
        "--prompt", args.prompt,
        "--negative-prompt", args.negative_prompt,
        "--output", str(args.output),
        "--width", str(args.width),
        "--height", str(args.height),
        "--steps", str(args.steps),
        "--guidance", str(args.guidance),
        "--seed", str(args.seed),
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.unlink(missing_ok=True)
    result = subprocess.run(command, check=False)
    if result.returncode:
        args.output.unlink(missing_ok=True)
        fail(f"mflux-generate exited with status {result.returncode}; no image will be uploaded.")
    try:
        verify_png(args.output, args.width, args.height)
    except Exception:
        args.output.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--prompt")
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=1024)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--guidance", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    if not args.check and (args.prompt is None or args.output is None):
        parser.error("--prompt and --output are required for generation")
    if args.json and not args.check:
        parser.error("--json is only valid with --check")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            manifest = check_install()
            report = {
                "model": manifest["model"],
                "repository": manifest["repository"],
                "mfluxVersion": manifest["mfluxVersion"],
                "quantize": manifest["quantize"],
            }
            print(json.dumps(report, sort_keys=True) if args.json else
                  f"mflux {MFLUX_VERSION} with local {MODEL_NAME} 8-bit weights is ready.")
        else:
            generate(args)
            print(f"Generated and verified MLX-native PNG: {args.output}")
        return 0
    except (RuntimeError, OSError, ValueError) as error:
        print(f"Image pipeline failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
