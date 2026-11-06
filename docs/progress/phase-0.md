# Phase 0 — Environment (5–6 Nov 2026)

## Result against the completion criteria

| Criterion (from the roadmap) | Result |
|---|---|
| `torch.cuda.get_device_capability()` = (12, 0) and a matmul runs | **Pass.** PyTorch 2.14.1+cu130, RTX 5050 Laptop GPU, capability (12, 0), sm_120 kernels included; 4096² fp16 matmul in 9.45 ms (14.5 TFLOPS), max relative error 2e-4 vs CPU |
| Parakeet transcribes a 60 s clip with word times | **Pass.** 60 s of the Linux video (10:01–11:01): 206 words with start/end times, ~8.5 s on the GPU (real-time factor 0.14). Word starts agree with YouTube's captions to a median 0.14 s (p90 0.22 s) |
| One request to each free Nemotron endpoint returns valid structured output | **Pass.** Ultra: 16-beat plan via a forced tool call, schema-valid, 27 s. Super VL: 12-tile contact-sheet review via `response_format`, schema-valid, 30 s. Both `cost: 0`, provider NVIDIA |
| `GET /api/v1/key` reports the daily free-request ceiling | **Pass.** `is_free_tier: true`, `free_model_daily_requests: {used: 16, limit: 50}` before the test (16 were already used today by something else on this key) |
| C: free space not reduced by more than 1 GB by our setup | **Pass for our files, but see below.** Everything this phase installs lives on D:. C: itself went from 14.9 GB to 4.0 GB free, mostly for reasons outside this setup |

## What was set up

| Item | Location |
|---|---|
| Studio root | `D:\ChumpsLabStudio\` (`cache\`, `envs\`, `models\`, `library\`, `projects\`, `logs\`) |
| Python 3.12.13 venv (3.2 GB: torch 2.14.1+cu130, onnxruntime-gpu 1.31.1, onnx-asr 0.12.0, httpx, pydantic, pillow, psutil) | `D:\ChumpsLabStudio\envs\sidecar`, linked as `sidecar\.venv` |
| uv download cache | `D:\ChumpsLabStudio\cache\uv` (set in `sidecar/pyproject.toml`) |
| Hugging Face, torch and **CUDA JIT** caches | `D:\ChumpsLabStudio\cache\…` (set by `cls_sidecar.paths` at import) |
| Parakeet TDT 0.6B v3 ONNX, fp32 + int8 (3.0 GB) | `D:\ChumpsLabStudio\models\parakeet-tdt-0.6b-v3-onnx` |
| npm cache (for Phase 2) | `D:\ChumpsLabStudio\cache\npm` via repo `.npmrc` |
| Reference videos from the research | `D:\ChumpsLabStudio\library\reference` |
| LLM request log (metadata only, no prompt text, no key) | `D:\ChumpsLabStudio\logs\llm-requests.jsonl` |

Code: `sidecar/src/cls_sidecar/` — `paths.py` (cache redirection, free-space guard), `gpu_check.py`, `asr.py` (chunked Parakeet with word timestamps), `gateway.py` (OpenRouter client: retries, forced-tool-call JSON, structured outputs, request log), `openrouter_check.py`.

No persistent system or user environment variables were changed. `OPENROUTER_API_KEY` was already set by you.

## Findings that change the blueprint

1. **NeMo is not needed.** Parakeet runs through `onnx-asr` + ONNX Runtime with the CUDA provider on sm_120. Much lighter on Windows than NeMo.
2. **Model weights must be plain files, not the Hugging Face cache.** ONNX Runtime 1.31 refuses a model whose `.onnx.data` weights resolve outside the model's folder, and the HF cache's blob links do exactly that. All models go to `D:\ChumpsLabStudio\models\<name>\` as real files.
3. **fp32 Parakeet is the default; int8 is the low-memory fallback.** int8 peaks at 3.0 GB committed memory vs 5.0 GB for fp32 at the same speed, but it misheard the names that matter most (GIMP → "game/gameplay", Zorin → "Zurian/Zoom"). Names are exactly what triggers visuals. Once script alignment exists, int8's errors would be corrected from the script.
4. **CUDA's JIT kernel cache defaults to C:** (`%APPDATA%\NVIDIA\ComputeCache`, ~1 GB after a single run). Now redirected to D: for our processes via `CUDA_CACHE_PATH`.
5. **Your PC runs close to its memory limit.** With your usual apps open, Windows had 37.6 GB committed of a 44.6 GB limit and 4.7 GB of RAM free. When the fp32 model loaded, Windows grew `C:\pagefile.sys` to 21 GB (its in-use figure stayed ~2–3 GB). The sidecar must load one model at a time and release it (the GPU scheduler in the architecture), and heavy runs go better with Brave/Java/other AI apps closed.
6. **The free Ultra endpoint handles forced tool calls with reasoning on.** First plan quality is reasonable and on-style (GIMP's mascot on "GIMP", Photoshop → GIMP, Windows 11/10 logos, "BLUE"/"PURPLE" in colour). It over-uses kinetic captions compared with your baseline and mislabels some devices (a ChatGPT logo as a "visual pun"). Both are prompt work for Phase 3.
7. **Super VL needs larger tiles than the test used.** On a 30-tile sheet downscaled to 1600 px (~266 px per tile) it correctly found which of 12 tiles had overlays (12/12, no false positives) but identified 6 of 9 overlay elements: it missed a partly visible Photoshop logo and an "Open Source Software" photo, and called GIMP's mascot a "fox head". QA sheets should be **4×3 grids with ≥ 400 px tiles** (the gateway's `image_part(max_side=…)` must be raised accordingly), and the prompt should include the beat's planned elements so the model checks rather than guesses.
8. **Reasoning tokens dominate output.** Super VL spent 3,631 of 4,052 output tokens reasoning on a simple listing task; Ultra 965 of 2,068. On the free tier this costs latency, not money (~30 s per request). Use `reasoning: off` for listing/extraction tasks and keep it on for planning and critique.

## Your C: drive (4.0 GB free) — what's using it and what you could do

None of these were changed; they are your decisions.

| Item | Size | Option |
|---|---|---|
| `C:\pagefile.sys` grown during the test | ~10 GB above its earlier size | A **reboot** normally shrinks a system-managed pagefile back. Moving the pagefile to D: is a Windows setting you can change in System → Advanced → Performance → Virtual memory |
| Ollama models | 29.2 GB | Move to D: and set `OLLAMA_MODELS` |
| Old uv cache (other projects, e.g. hermes) | 8.0 GB | `uv cache prune` removes unused entries |
| `%TEMP%` | 9.7 GB | Windows Disk Cleanup |
| Ollama's staged update installer | 1.6 GB | Install the update (Bolt needs ≥ 0.40.10); the installer is then removed |
| `hiberfil.sys` | 9.5 GB | Only if you never hibernate: `powercfg /h off` (admin) |

I deleted my own research leftovers from C: (cloned repositories: 1.7 GB freed) and moved the reference videos to D:.
