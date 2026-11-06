# 4. Technology stack (D) and AI model strategy (E)

## 4.1 Your machine [Measured]

| Part | Value | Consequence |
|---|---|---|
| Laptop | HP OMEN 16-am0xxx | — |
| CPU | Intel Core 7 240H (10 cores: 6 P + 4 E, 16 threads) | Remotion concurrency ~6–8; Python CPU jobs fine |
| GPU | RTX 5050 Laptop, **8 GB**, compute capability **12.0** (Blackwell), driver 617.42 | Needs **CUDA ≥ 12.8 builds** of PyTorch (2.7+) and CTranslate2 int8 workarounds; has NVENC (H.264/HEVC/**AV1**) |
| RAM | 24 GB | One ~8 GB model in VRAM + Chrome render workers; no 24 GB+ local LLMs |
| Disk | **C: 11.6 GB free**, D: 110 GB free | All models, caches, media on D: |
| Installed | Node 24.15, Python 3.14 (+3.10, uv-managed 3.11), FFmpeg 8.1.1 (NVENC, QSV, AV1), Ollama 0.23.3 with qwen3:8b, qwen3-coder-30b, gemma3-4b; CUDA toolkit 13.4; Rust | Python 3.14 is too new for much of the ML ecosystem: the sidecar uses a **uv-managed Python 3.12** venv |

> Note: running `ollama list` during the audit started the Ollama background app (v0.23.3). It also reported that v0.40.14 is available; Nemotron 3.5 Bolt needs Ollama ≥ 0.40.10.

## 4.2 Stack

Each row: what it does → why → alternatives → integration difficulty → performance/resources → licence → offline → limitations.

| Layer | Choice | Why | Alternatives | Difficulty | Resources | Licence | Offline | Limitations |
|---|---|---|---|---|---|---|---|---|
| Desktop shell | **Electron** (+ Vite, React 19, TypeScript) | Ships Node + Chromium; Remotion renders in Chrome so preview matches render | Tauri (WebView2 ≠ render Chrome; needs Node sidecar anyway) | Low | ~200 MB RAM | MIT | Yes | Bundle size ~150 MB |
| Preview | **@remotion/player** | Frame-accurate, seekable, inside our UI | HyperFrames player | Low | Browser | Remotion | Yes | Heavy 3D scenes may preview below 30 fps → proxy mode |
| Rendering | **@remotion/renderer** + **NVENC** (`h264_nvenc`/`hevc_nvenc`) | Mature, deterministic, concurrency, hardware encode | HyperFrames producer; Rendiv | Low–medium | CPU-bound (Chrome), 2–4 GB RAM per few workers | Remotion | Yes | ~15–30 fps est. on your CPU; benchmark in Phase 2 |
| Motion primitives | Remotion `interpolate`/`spring`/`Easing`, `@remotion/motion-blur`, `@remotion/transitions`, `@remotion/layout-utils`, `@remotion/paths`/`shapes` | All frame-deterministic | GSAP (licence), Motion (not deterministic) | Low | — | Remotion | Yes | — |
| 3D | **@remotion/three** + React Three Fiber + drei | Neural-net, GPU, chip, globe scenes | Spline (API down this session), Babylon | Medium | GPU in Chrome (`--gl=angle`) | MIT / Remotion | Yes | Headless WebGL on Windows must be verified (`--gl=angle` or `vulkan`) |
| Charts | **visx** or hand-written SVG components | Full control of animation per frame | D3 (fine for scales/layout) | Medium | — | MIT | Yes | We animate, the library only computes layout |
| Vector animation | `@remotion/lottie` + LottieFiles free assets | Icons and reactions | Rive | Low | — | MIT runtime; per-asset licence | Yes | Check each Lottie's licence |
| Technical animation clips | **Manim CE** (optional) | Math/CS explanations | Motion Canvas | Medium | CPU | MIT | Yes | Separate render, placed as video |
| State + history | Zustand + Immer + `fast-json-patch`; Zod schemas | Patches give undo, provenance, AI diffs | Redux, Yjs | Low | — | MIT | Yes | — |
| Timeline widget | **`@xzdarcy/react-timeline-editor`** (decided), `dnd-timeline` as fallback | Reuse, don't build: drag/resize/ruler/playhead come with it | OpenCut / Clypra code as reference (MIT apps, not libraries) | Low–medium | — | MIT | Yes | One row height (custom row renderer for the waveform); external data updates must be verified in a Phase 6 spike (see 3.4) |
| Waveforms | **wavesurfer.js** | Standard, fast | peaks.js | Low | — | BSD-3 | Yes | — |
| ML sidecar | **Python 3.12 via uv**, PyTorch **2.14.1+cu130** (verified on sm_120), FastAPI, Pydantic | Ecosystem; structured LLM outputs | Node-only (no ML) | Medium | venv 3.2 GB on D: | MIT | Yes | All caches (uv, HF, torch, CUDA JIT) redirected to D: |
| ASR | **Parakeet TDT 0.6B v3** via **onnx-asr + ONNX Runtime CUDA** (fp32 default, int8 fallback) — *verified in Phase 0* | Native word timestamps; measured RTF 0.14 on your GPU; names (GIMP, Zorin) correct in fp32 | faster-whisper large-v3-turbo (float16 on RTX 50); NeMo not needed | Low | 5.0 GB peak commit fp32 / 3.0 GB int8 | CC-BY-4.0 | Yes | ≤ 24 s per call (we chunk at quiet points); weights must be plain files, not the HF cache |
| Script alignment | **ctc-forced-aligner** + text diff | When you have the script, align the *script* to audio: correct spellings of names/jargon | WhisperX, Montreal Forced Aligner | Low | <1 GB | BSD-2 | Yes | — |
| Prosody/emphasis | **librosa** / **parselmouth** (pitch, energy, pauses) | Find stressed words and pauses for zoom timing | — | Low | CPU | ISC / GPL-3 (parselmouth) | Yes | Heuristic; combined with LLM text judgement |
| Shot detection | **PySceneDetect** | Shots in footage and B-roll | FFmpeg scene filter (already used) | Low | CPU | BSD-3 | Yes | — |
| Focus points | **SAM 2.1 tiny/small** + OCR boxes from **PaddleOCR**/RapidOCR | Know *where* "neural network" is on screen to zoom to it | Florence-2 grounding | Medium | 1–3 GB VRAM | Apache-2.0 | Yes | Screen recordings: OCR boxes are often better than segmentation |
| Cut-outs | **BiRefNet** | Remove backgrounds for pop-in images | RMBG-2.0 (non-commercial) | Low | ~2 GB VRAM | MIT | Yes | — |
| Embeddings | **Qwen3-VL-Embedding-2B** (text/image/video) + SigLIP 2 for fast tags | Semantic asset search across modalities | jina-clip-v2 (CC-BY-NC), CLIP | Low | ~2–4 GB VRAM (Q8/FP16) | Apache-2.0 | Yes | — |
| Vector store | **LanceDB** (+ SQLite for metadata) | Embedded, on-disk, no server | sqlite-vec, Qdrant | Low | Disk | Apache-2.0 | Yes | — |
| Local LLM/VLM runtime | **llama.cpp `llama-server`** (OpenAI-compatible), Ollama for convenience | Same API shape as the cloud providers | LM Studio | Low | — | MIT | Yes | One model in VRAM at a time |
| Image generation (optional) | **FLUX.2 [klein] 4B** (FP8) via ComfyUI | Apache-2.0; fits 8 GB with encoder offload | Z-Image-Turbo GGUF Q4 (Apache-2.0), SDXL | Medium | ~6–7 GB VRAM peak | Apache-2.0 | Yes | Generated images are the *last* resort for this style; ~5–15 s/image est. |
| Interchange | **OpenTimelineIO** | Export to Resolve / Kdenlive / FilmCraft | FCPXML, MLT XML | Low | — | Apache-2.0 | Yes | Effects don't transfer; we export overlays as alpha clips |

## 4.3 AI model strategy (E)

### The two models you asked for [Verified]

| | **Nemotron 3 Ultra** | **Nemotron 3.5 Super VL** |
|---|---|---|
| Exact ID | `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B` (BF16, NVFP4, Base, GenRM variants) | `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B` (BF16, NVFP4) |
| Released | 4 Jun 2026 | 15 Oct 2026 |
| Size | 550B total / 55B active, hybrid Mamba-2 + MoE + attention (LatentMoE), MTP | 120B total / 12B active, same family + C-RADIO vision encoder |
| Context | Up to 1M; **262K on OpenRouter providers** | Up to 1M (OpenRouter lists 1M; NVIDIA's hosted endpoint lists 262K) |
| Inputs | Text | Text, images, video (mp4 **≤ 2 min**) |
| Reasoning | On/off via chat template, budget control | Off / medium / on, budget control |
| Weights licence | **OpenMDW-1.1** (permits commercial use) | **OpenMDW-1.1** |
| Minimum hardware | 8× H100 (NVFP4: 4× B200 or 8× H100) | 2× H100 / 1× RTX PRO 6000 / DGX Spark (GB10) |
| On your laptop | **Impossible** | **Impossible** |
| **Chosen access: OpenRouter free variant** | **`nvidia/nemotron-3-ultra-550b-a55b:free`**, served by NVIDIA, 1M context, up to 65,536 output tokens | **`nvidia/nemotron-3.5-super-vl:free`**, served by NVIDIA, 1M context, up to 131,072 output tokens, text + image + video input |
| Free-variant parameters [Verified, OpenRouter endpoints API] | reasoning, reasoning_effort, temperature, top_p, seed, max_tokens, **tools/tool_choice**; **no `response_format`** | reasoning, temperature, top_p, seed, max_tokens, tools, **`response_format` / structured outputs** |
| Paid fallback (same id without `:free`, per 1M tokens) | $0.50–0.60 in / $2.20–2.40 out | $0.06–0.15 in / $0.35–0.50 out |
| Other free option | build.nvidia.com trial key (see below) | build.nvidia.com trial key |
| Benchmarks of note | Artificial Analysis Coding Index 49.3, GPQA 86.7 %, IFBench 81.4 % (reasoning mode, per OpenRouter) | GPQA 87–92 %, τ-bench ~70–75 % (per OpenRouter provider runs) |

**build.nvidia.com "free" key [Verified via third-party reading of NVIDIA's terms; Reported for the rate limit]**: no credit card, ~40 requests/minute, no time limit. But the Trial Terms allow use "for internal testing and evaluation purposes, not in production", define production as anything other than development/testing/research/evaluation, and let NVIDIA collect prompts and outputs to improve its models. Using it to *develop and evaluate* this editor is within the terms. Using it to produce every episode of a monetised channel is, in my reading, outside them. Since you've chosen OpenRouter's free variants (also served by NVIDIA), this key is only a backup source of the same models. Do not send anything private through either.

**OpenRouter free tier — the limits that shape the design [Verified, OpenRouter limits docs]**

| Account state | Requests / minute | Requests / day |
|---|---|---|
| Less than $10 of credits ever purchased | 20 | **50** |
| At least $10 purchased (one-time, all-time total) | 20 | **1,000** |

- The limit counts **requests, not tokens**, so the pipeline makes **few, large requests**: several beats per planning call, 12-frame contact sheets per VL call, all patches for a review pass in one call.
- Both free endpoints are **served by NVIDIA**. Assume NVIDIA's trial-style data handling applies (prompts may be retained and used for improvement). Don't send anything private. OpenRouter has a separate privacy setting for free models; if free requests are refused, check it first.
- Free endpoints can return 429 "at capacity" at busy times. The gateway retries with backoff, and for a time-critical render it can fall back to the paid id (cents per video) or a local model; both fallbacks are off unless you switch them on.
- Ultra's free endpoint doesn't accept `response_format`, so structured output from Ultra uses **a single forced tool call** whose JSON Schema is the EDD patch schema; Super VL's free endpoint supports structured outputs directly.
- Also free and worth noting: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` accepts **audio** input. It's a candidate for a second opinion on tone and emotion in the narration (Stage 2), to test in Phase 3.

**My assessment of fit**: Ultra is a strong reasoning/coding model at a very low price, but it is text-only and is not the top coding model available (Artificial Analysis ranks several closed models higher). It is a good choice for planning and EDD generation. For writing *new components*, keep the gateway model-agnostic so you can route that one job to whichever coding model you prefer (including Claude through Claude Code, which you're already using).

### Responsibilities by model

| Job | Model | Where | Why |
|---|---|---|---|
| Beat sheet, visual planning, EDD patches, critique → patch translation | **Nemotron 3 Ultra** (reasoning on, budgeted) | API | Needs long context (whole script + style profile + asset catalogue summary) and judgement |
| New component code | Ultra or another coding model, via the same gateway | API | Rare (a few per video), quality matters |
| Subjective frame review: relevance, readability, balance, "does this look AI-made" | **Nemotron 3.5 Super VL** (reasoning medium) | API | Visual taste; short clips ≤ 2 min can be sent directly |
| Before/after comparison of a fix | Super VL | API | Pairwise judgement is more reliable than absolute scores |
| Quick local pre-screen of frames, OCR, captions for asset tagging | **Gemma 4 E4B** (Apache-2.0, ~5–6 GB Q4) or **Qwen3-VL 8B** Q4 (~6.2 GB) | Local llama.cpp | High volume, free, offline |
| Short text jobs: search-query generation, subtitle cleanup, segment labels | **Nemotron 3.5 Bolt E4B** (Q4_K_M 6.18 GB; Ollama ≥ 0.40.10 ships it with a vision projector) or qwen3:8b (installed) | Local | Free, fast; Bolt E4B is officially text-only, vision is unofficial |
| ASR + word times | Parakeet TDT 0.6B v3 | Local GPU | Fast, accurate |
| Embeddings | Qwen3-VL-Embedding-2B; SigLIP 2 | Local GPU | Asset search |
| Segmentation / focus | SAM 2.1 tiny/small; OCR | Local GPU | Zoom targets |
| Image generation (optional) | FLUX.2 [klein] 4B | Local GPU | Fill gaps only |

**Not recommended**: Nemotron 3.5 **Bolt 74B-A9B "24GB"** locally. It needs ~22 GB for weights alone (IQ2), NVIDIA's smallest recipe targets 32 GB+ GPUs, and with 8 GB VRAM + 24 GB RAM you'd be swapping **[Verified model card; Estimate for your machine]**.

### Calling patterns that keep cost and latency down

- **Structured outputs everywhere**: every Ultra call returns JSON validated against a Zod/Pydantic schema; invalid output is retried once with the validator error, then falls back to a simpler prompt.
- **Hierarchical planning**: one global call (whole script → beats, arc, pacing, recurring motifs), then one call per beat (beat text + neighbours + candidate assets → visual plan). Beats can run in parallel (respecting rate limits).
- **Batch beats**: on the free tier, plan ~6 beats per Ultra call instead of one; the 1M context and 65K output limit allow it.
- **Prompt caching** (paid fallback only): the system prompt + style profile + component catalogue is identical across calls; providers list cache-read prices of $0.10/M for Ultra and $0.02/M for Super VL.
- **Frames as contact sheets**: send 12 frames per VL request as a labelled grid (~640 px per frame) with the beats' plan text, instead of one frame per request. Re-review only beats that changed in later passes.
- **Request budget per 10-minute video** [Estimate]: global plan 1 · beat plans ~10 · new components ~6 · VL pass 1 ~26, passes 2–3 ~16 · patch calls ~9 → **~70 requests**. That is 2 days of the 50/day free limit, or a small fraction of the 1,000/day limit. The prototype (90 s) needs ~15.

### Latency [Estimate]

| Step (10-min video) | Calls | Wall-clock |
|---|---|---|
| Global plan (Ultra) | 1 | 1–3 min (reasoning) |
| Beat plans (Ultra, ~60 beats in batches of 6, ≤ 20 requests/min) | ~10 | 5–12 min |
| VL review, first pass (~26 sheets of 12 frames) | ~26 | 4–10 min |
| Local ASR + alignment + analysis | — | 2–5 min |
| Render 1080p30 (≈ 18,000 frames at 15–30 fps) | — | 10–20 min |
