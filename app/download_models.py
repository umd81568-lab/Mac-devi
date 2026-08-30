#!/usr/bin/env python3
"""Optional model downloader for BhashaMedia AI facilities.

Usage:
    python app/download_models.py --list
    python app/download_models.py --model whisper
    python app/download_models.py --model xtts
    python app/download_models.py --model sadtalker
    python app/download_models.py --model llama

All downloads use huggingface_hub snapshot_download with resume support, so an
interrupted download can simply be re-run. Nothing here is required to start
the app — each facility works only when its model is present, and app.py
reports exactly which command to run if a facility's model is missing.
"""
import argparse
import os
import sys

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

CATALOG = {
    "whisper": {
        "repo": "Systran/faster-whisper-large-v3",
        "dest": "whisper-large-v3",
        "size": "~3.1 GB",
        "used_by": "Tab 1 (STT) / Tab 5 (Video -> SRT) / Tab 10 (Live Voice Call)",
    },
    "xtts": {
        "repo": "coqui/XTTS-v2",
        "dest": "xtts_v2",
        "size": "~2.1 GB",
        "used_by": "Tab 3 (offline voice clone) / Tab 8 narration fallback",
    },
    "sadtalker": {
        "repo": "vinthony/SadTalker",
        "dest": "sadtalker",
        "size": "~3.5 GB",
        "used_by": "Tab 9 (Image -> Talking Avatar)",
    },
    "llama": {
        "repo": "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        "dest": "llama3_1",
        "size": "~4.6 GB",
        "used_by": "Tab 10 (local agent, llama.cpp backend only — Ollama users don't need this)",
        "allow_patterns": ["*Q4_K_M.gguf"],
    },
}


def download(name):
    entry = CATALOG[name]
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("huggingface_hub is required: pip install huggingface_hub")
        sys.exit(1)
    dest = os.path.join(MODELS_DIR, entry["dest"])
    os.makedirs(dest, exist_ok=True)
    print(f"Downloading {entry['repo']} -> {dest} ({entry['size']}) ...")
    kwargs = {"local_dir": dest, "local_dir_use_symlinks": False, "resume_download": True}
    if "allow_patterns" in entry:
        kwargs["allow_patterns"] = entry["allow_patterns"]
    snapshot_download(entry["repo"], **kwargs)
    print("Done.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=sorted(CATALOG.keys()), help="Which model to download")
    parser.add_argument("--list", action="store_true", help="List available models and exit")
    args = parser.parse_args()

    if args.list or not args.model:
        print(f"{'name':<10} {'size':<8} used_by")
        for key, entry in CATALOG.items():
            print(f"{key:<10} {entry['size']:<8} {entry['used_by']}")
        if not args.model:
            return
    download(args.model)


if __name__ == "__main__":
    main()
