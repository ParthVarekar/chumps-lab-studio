# Chumps Lab Studio — Research & Implementation Blueprint

*Research date: 5 November 2026. Every version, price and licence below was checked on that date unless marked otherwise.*

This folder is the Phase 1 deliverable: research, repository audit, architecture decision and build plan for a personal, AI-assisted desktop video editor. **No application code has been written yet**, as requested.

## How to read the evidence labels

| Label | Meaning |
|---|---|
| **[Measured]** | I ran it on your laptop or inspected the source code myself in this session. |
| **[Verified]** | Read from an official model card, licence text, docs page or GitHub API on 5 Nov 2026. |
| **[Reported]** | A third-party benchmark or forum post. Plausible, not confirmed by me. |
| **[Estimate]** | My own projection. Treat as a planning number to be replaced by a benchmark in Phase 2. |

## Contents

| # | Document | Covers deliverables |
|---|---|---|
| 0 | This page | **A. Executive summary** |
| 1 | [01-style-study.md](01-style-study.md) | Measured analysis of your videos, Fireship and bog |
| 2 | [02-repository-audit.md](02-repository-audit.md) | **B. Repository audit** (Rendiv, Remotion, Storytold, HyperFrames, 40+ others) |
| 3 | [03-architecture.md](03-architecture.md) | **C. Architecture comparison**, **I. Desktop application design** |
| 4 | [04-stack-and-models.md](04-stack-and-models.md) | **D. Technology stack**, **E. AI model strategy** |
| 5 | [05-pipeline-and-motion.md](05-pipeline-and-motion.md) | **F. Pipeline design**, **G. Visual design & motion system** |
| 6 | [06-assets-costs-licensing.md](06-assets-costs-licensing.md) | **H. Assets**, **J. Costs**, **K. Licensing** |
| 7 | [07-roadmap-risks-prototype.md](07-roadmap-risks-prototype.md) | **L. Roadmap**, **M. Risks**, **N. First prototype** |
| 8 | [08-prompt-editing.md](08-prompt-editing.md) | Prompt-based editing and fixing mistakes: pointing, ops, preview, models (proposal) |
| — | [evidence/](evidence/) | Raw cut-rate data and the script that produced it |

---

## A. Executive summary

### What we are building

A Windows desktop editor (Electron + React) in which the AI's editing decisions are stored as **data, not code**: a typed, versioned *Edit Decision Document* (EDD). A library of hand-designed motion components (zooms, pop-ins, callouts, diagrams, charts, emotion effects) turns the EDD into frames through **Remotion**. You and the AI edit the same document: the AI proposes, you can override, lock or regenerate any single decision, and the renderer turns the result into an MP4.

```
narration + script + footage + assets
        │
        ▼
 Python sidecar (local ML): transcription, word alignment, emphasis, scene detection, tagging, embeddings
        │
        ▼
 Nemotron 3 Ultra (API): beat sheet → per-beat visual plan → EDD patches
        │
        ▼
 EDD (JSON, schema-validated, locks + history)  ◄──── you, in the timeline UI
        │
        ▼
 Remotion component library → preview (Player) / render (headless Chrome + NVENC)
        │
        ▼
 QA: exact geometry checks (from the layout) + Nemotron 3.5 Super VL on sampled frames → EDD patches
```

### The five findings that shaped the design

1. **Neither Nemotron model can run on this laptop, but both are free on OpenRouter.** Nemotron 3 Ultra is 550B parameters (55B active) and Nemotron 3.5 Super VL is 120B (12B active); both need datacenter GPUs. OpenRouter serves both as **`:free` variants hosted by NVIDIA** (`nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3.5-super-vl:free`) **[Verified, OpenRouter API]**. The catch is the free-tier request cap: **20 requests/minute and 50 requests/day**, or **1,000/day** once an account has bought $10 of credits in total. The pipeline is therefore designed to fit a video into ~70 large, batched requests (Section 4.3).
2. **Your baseline pacing is the Linux video from 9:19 onward, now measured.** It averages **12 visual changes per minute** (median gap 2.6 s) and only **1.4 hard cuts per minute**. Most changes are a **literal illustration popping in on the word it names** (the VMware logo on "VMware", a Rubik's cube on "desktop cube", a Tata Nano on the `nano` command), plus **zoom-and-hold into the exact UI element** being discussed. The visual typically lands **~0.5 s before its word** **[Measured]**. Your C++ video and the first 9 minutes of the Linux video are much denser (36–62 changes/min); they become the "dense" profile for intros. Details in [01-style-study.md §1.6](01-style-study.md#16-baseline-linux-video-from-919).
3. **Rendiv is not a safe foundation.** It is a 9-month-old, single-maintainer (166 stars, v0.2.6) re-implementation of Remotion's API, and its Studio only stores clip start/duration overrides **[Measured]**. Remotion (v4.0.541, 71k stars, daily commits) has everything Rendiv has plus transitions, captions, Three.js, Lottie, motion blur, light leaks, SFX and an embeddable Player, and its licence is **free for an individual**, including monetised YouTube **[Verified]**.
4. **Storytold is now ArtCraft**, and its *FilmCraft* (Rust NLE) and *EffectCraft* (Rust motion-graphics app) are impressive and agent-driveable over MCP, but they are 5 weeks old, alpha, macOS-first, and carry 2,000+ and 1,000+ open issues **[Verified]**. They are worth watching and become an optional "finish in a real NLE" export through OpenTimelineIO later, not the foundation.
5. **The QA loop should not ask a vision model what the code already knows.** Overlaps, clipping, safe-area violations, text size and repetition can be computed *exactly* from the layout of each frame. The VL model is then spent only on subjective questions (Is this readable? Does this image match "neural network"? Is the composition balanced?), on 20–40× fewer frames.

### Recommended architecture (detail in [03-architecture.md](03-architecture.md))

**"Remotion core, data-driven timeline, Electron shell, Python ML sidecar, Nemotron via OpenRouter free tier"**, with HyperFrames as the documented fallback renderer and FilmCraft as a future OTIO export target.

### Decisions confirmed after review (5 Nov 2026)

| Topic | Decision |
|---|---|
| Models | Nemotron 3 Ultra and Nemotron 3.5 Super VL through **OpenRouter `:free` variants**. Paid variants (same model ids without `:free`) and local models are fallbacks only |
| Timeline UI | **Use an open-source component, don't build one.** Default: `@xzdarcy/react-timeline-editor` (MIT); fallback: `dnd-timeline` (MIT, headless). Build only what neither covers (Section 3.4) |
| Pacing baseline | **Linux video, 9:19 to end** = the "standard" profile. The fast opening and the C++ video = the "dense" profile, used for intros and recaps |

### What is realistic

| Milestone | Realistic target | Confidence |
|---|---|---|
| First AI-assembled video you'd consider publishing after light manual fixes | ~6–8 weeks of part-time work (end of Phase 3) | Medium |
| Desktop app with a real multi-track timeline, locks and per-decision regeneration | ~4 months | Medium |
| "Give it a project, get a video that needs only minor fixes" | 6+ months, and only after the style library has grown from your corrections | Low–medium |

What will *not* be realistic on this hardware: running Nemotron locally, real-time preview of heavy 3D scenes at 1080p, or rendering a 20-minute 1080p60 video in under ~30 minutes **[Estimate]**.

### Things you asked for that I recommend changing

| Your assumption | My recommendation | Why |
|---|---|---|
| The AI writes composition code | The AI writes **EDD data**; code generation is reserved for genuinely new visual components, which are reviewed once and then reused as presets | Data can be validated, diffed, locked, partially regenerated and edited in a UI. Free-form code can't do any of these reliably. |
| Use Nemotron 3.5 Super VL to find layout problems | Compute layout problems from geometry; use the VL model for taste and relevance | Exact, free and instant; VL models are unreliable at pixel-level positions. |
| Infer emotion from narration and add effects | Infer candidates, but cap them with a **budget** (e.g. ≤ 1 emotion effect per 45 s) and score them for strength | Over-use is the main way these effects start to look templated. |
| Build a general asset web scraper | Start from **your own library** + Pixabay/Openverse/Wikimedia APIs + generated graphics; treat memes as a curated local library | Licences, rate limits and the June 2026 Tenor shutdown make scraping fragile; GIPHY's free key is 100 calls/hour and forbids caching. |
| One big model for everything | Ultra for planning/code, Super VL for visual judgement, small local models (Parakeet, Qwen3-VL-Embedding, Gemma 4 / Nemotron Bolt E4B) for the high-volume jobs | Cost, latency and offline operation. |

### Disk space warning

Your **C: drive has 11.6 GB free** **[Measured]**. The ML models, proxies and render caches for this project will need 40–80 GB. Everything heavy (model weights, Hugging Face cache, Remotion cache, project media) must live on **D: (110 GB free)**. The roadmap starts with this.
