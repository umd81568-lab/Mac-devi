# Local AI Studio

An all-in-one, local-first production workspace for Apple Silicon Macs. It combines:

- script-to-scene planning and final video rendering
- private voice synthesis and consented voice profiles
- realistic human-presenter video through LongCat-Video-Avatar MLX
- local FLUX image generation through MLX/mflux
- private live voice conversations through Ollama
- explicit model, provider, queue, and Mac-worker readiness controls

## Development

```sh
pnpm install
pnpm --filter @workspace/api-server run dev
```

The API requires `DATABASE_URL`. The production Mac inference runtimes are installed separately:

```sh
bash tools/mac-worker/install_presenter.sh --bf16
bash tools/mac-worker/install_image.sh
```

Use the bf16 presenter profile only on Macs with at least 64 GB unified memory. See
[`tools/mac-worker/README.md`](tools/mac-worker/README.md) for pairing and worker setup.

The Live room calls a local Ollama server. It defaults to `qwen2.5:14b`; override
`OLLAMA_BASE_URL` or `OLLAMA_MODEL` when using another local endpoint or model.