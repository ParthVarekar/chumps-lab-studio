# Phase 2 — Rendering foundation (6 Nov 2026)

## Result against the completion criteria

| Criterion | Result |
|---|---|
| A hand-written 60 s EDD renders at 1080p30 | **Pass.** `sample-linux-1001` (Linux video 10:01–11:01, real 1080p60 footage + narration): 6 beats, 13 layers, 2 camera moves, 1 mood → 1800-frame 1080p30 MP4 with AAC narration |
| Benchmark recorded (720p/1080p, concurrency 2–8, NVENC vs x264) | **Pass.** See table below; raw data in `D:\ChumpsLabStudio\projects\sample-linux-1001\cache\bench\benchmark.json` |
| Two renders of the same EDD give identical frame hashes on 30 sampled frames | **Pass.** 30/30 PNGs byte-identical across two independent browser sessions |
| Changing one beat re-renders in ≤ 25 % of full time | **Pass.** Changing one title's text re-rendered only `b5-customize`: 23.6 s vs 146.3 s for the full render = **16 %** |

## Benchmark (Core 7 240H, RTX 5050 Laptop, Windows 11, Remotion 4.0.541, headless Chrome with ANGLE)

| Run | Frames | Render s | fps |
|---|---|---|---|
| 720p, concurrency 2 (first 2 beats) | 345 | 35.1 | 9.8 |
| 720p, concurrency 4 | 345 | 26.3 | 13.1 |
| **720p, concurrency 6** | 345 | 24.3 | **14.2** |
| 720p, concurrency 8 | 345 | 25.7 | 13.4 |
| 1080p, x264 veryfast CRF 18, full 60 s | 1800 | 144.6 | 12.5 |
| 1080p, NVENC 16 Mb/s, full 60 s | 1800 | 145.2 | 12.4 |
| 720p, x264, full 60 s | 1800 | 140.9 | 12.8 |
| 1080p, one beat changed (cache) | 285 | 22.1 | 12.9 |

### What the numbers say

- **≈ 2.4× real time at 1080p.** A 10-minute video ≈ 24 minutes for a first full render; afterwards only edited beats re-render.
- **Resolution and encoder barely matter** (720p ≈ 1080p, NVENC ≈ x264). The bottleneck is Chrome producing frames and Remotion extracting frames from the **60 fps** source footage, not encoding. So NVENC is not worth its lower quality-per-bit for finals, and 720p previews save little.
- **Concurrency 6 is the sweet spot** on this 10-core CPU; 8 is slower.
- The biggest remaining lever is footage decoding: **30 fps proxies** of source footage (planned for ingest, Stage 1) should help more than any render setting. To measure in Phase 3.

## What was built (`engine/`)

| Part | Notes |
|---|---|
| EDD schema v1 (Zod) + JSON Schema export | `src/edd/schema.ts`; `schema/edd.schema.json` and `schema/components.schema.json` for the Python side and LLM tools |
| 8 components | Title, KineticWord, Header, PopImage, EvidenceCard, MemeCut, UILabel, ColorChip, each with a props schema |
| Motion | 8 entrance presets (pop, slide, slide-blur with directional motion blur, fade, drop, scale-in, typewriter, cut) and 4 exits; camera zoom/hold/return with perspective tilt and clamping; 5 moods (anger, sad, happy, shock, confusion) with envelopes and seeded shake |
| Looks | `footage-first` (your white-outlined type over footage) and `terminal-noir`; bundled OFL fonts (Archivo Black, Inter) |
| Pipeline | Bundle cache (by engine source hash), project media served over HTTP (not copied), per-beat content-hash cache, lossless concat, narration mux, JSON report per render |
| Tools | `render`, `bench`, `determinism`, `schema`, `export-icons` (Simple Icons, CC0) |

## Found along the way

- On Windows Remotion **copies** the whole public folder into each bundle (no symlink option on win32), so media is served from the project folder instead.
- Text must be measured **after** fonts load, or a fallback-font measurement gets cached and renders differ; `useFontsReady` gates rendering on it. That is what makes the determinism check pass.
- Remotion uses NVENC on Windows only when no CRF is given (`hardwareAcceleration` + `videoBitrate`).
- First directional-blur and camera-blur settings were far too strong; toned down after looking at frames.

## Known limitations (next phases)

- The sample's base footage is your *finished* edit, so some sample overlays sit on top of your original ones. The prototype (N) will use your raw recordings.
- Word-anchored times are resolved by the sample generator script; the planner-side resolver comes in Phase 3.
- No music/SFX bus or loudness normalisation yet (narration only).
