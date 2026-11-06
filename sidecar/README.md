# cls-sidecar

The Python side of Chumps Lab Studio: transcription, media analysis, embeddings and the model gateway.

## Where things live

| What | Where | Why |
|---|---|---|
| Code | this folder (`sidecar/`) | small, versioned |
| Virtual environment | `D:\ChumpsLabStudio\envs\sidecar`, linked here as `.venv` (directory junction) | PyTorch + CUDA is several GB; C: is nearly full |
| uv download cache | `D:\ChumpsLabStudio\cache\uv` (set in `pyproject.toml`) | same |
| Hugging Face / torch caches | `D:\ChumpsLabStudio\cache\…` (set by `cls_sidecar.paths` on import) | model weights |
| Request log | `D:\ChumpsLabStudio\logs\llm-requests.jsonl` | metadata only, for request/token budgets |

Override the root with the `CLS_STUDIO_ROOT` environment variable.

## Setup

```powershell
cd sidecar
uv sync
```

If `.venv` is ever missing (e.g. a fresh clone), recreate the link before `uv sync`, otherwise uv builds the environment on C::

```powershell
uv venv D:\ChumpsLabStudio\envs\sidecar --python 3.12
cmd /c mklink /J .venv D:\ChumpsLabStudio\envs\sidecar
```

## Phase 0 checks

```powershell
uv run python -m cls_sidecar.gpu_check
uv run python -m cls_sidecar.asr D:\ChumpsLabStudio\projects\_phase0\linux_1001_1101_16k.wav --out D:\ChumpsLabStudio\projects\_phase0\words.json
uv run python -m cls_sidecar.openrouter_check --sheet D:\ChumpsLabStudio\projects\_phase0\sheet_1019_1049.png --transcript D:\ChumpsLabStudio\projects\_phase0\words.json
```

The OpenRouter check needs `OPENROUTER_API_KEY` in the environment and uses 2 of the day's free-tier requests.
