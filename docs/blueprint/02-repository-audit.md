# 2. Repository audit (deliverable B)

Method: shallow-cloned and read the source of Rendiv, FilmCraft, EffectCraft and a sparse checkout of Remotion; pulled licence, stars and last-push dates for ~45 more projects from the GitHub API; read the READMEs/docs of HyperFrames and the Remotion licence. All on 5 Nov 2026.

## 2.1 Rendiv — `thecodacus/rendiv`

| | |
|---|---|
| Licence | Apache-2.0 **[Verified]** |
| Activity | Created 20 Feb 2026; last commit 15 Sep 2026; 166 stars; 20 open issues; one main author **[Verified]** |
| Version | `@rendiv/*` 0.2.6, 21 packages, ~220 TS/TSX files **[Measured]** |

**Architecture [Measured from source]**

- **Composition model**: a video is a React component that reads `useFrame()` and renders a frame. `<Sequence>`, `<Series>`, `<Loop>`, `<Freeze>`, `interpolate`, `spring`, `holdRender`/`releaseRender`. This is Remotion's API with renamed hooks (`useCurrentFrame` → `useFrame`, `delayRender` → `holdRender`).
- **Renderer** (`packages/renderer`, ~1,100 lines): launches Chromium through **Playwright**, sets the frame through `page.evaluate`, waits for holds, takes a `page.screenshot()` (PNG or JPEG), then stitches frames with `ffmpeg-static` (`libx264`, CRF 18 by default, encoder override allows `h264_nvenc`). Concurrency = multiple pages.
- **Studio** (`packages/studio`): a Vite plugin with an embedded terminal (`node-pty` + `xterm`) so you can run a coding agent inside the Studio. Its timeline editing persists **only `{ from, durationInFrames }` per sequence** to `timeline-overrides.json`. Position, animation, asset and effect edits are not represented.
- **Ecosystem packages**: transitions, shapes, paths, noise, motion-blur, fonts, google-fonts, gif, lottie, three, captions, text, effects. All mirror Remotion packages of the same name.

**Verdict: do not use as the foundation.** It offers nothing Remotion lacks, it is maintained by one person, and its Studio's edit model is too thin for locks and per-decision overrides. The licence is better than Remotion's, which matters only if you ever wanted to sell the editor. Its *ideas* are worth keeping: the per-frame timing breakdown in `render-frames.ts` (setFrame / waitForHolds / screenshot) is a good model for our render profiler, and the in-Studio agent terminal is a nice touch.

## 2.2 Remotion — `remotion-dev/remotion`

| | |
|---|---|
| Licence | **Remotion License** (source-available, not OSI open source) **[Verified, LICENSE.md]** |
| Activity | 70,984 stars, commits every day, v4.0.541 **[Verified]** |
| Size | 120+ packages in the monorepo **[Measured]** |

**Licence in plain terms**: free (including commercial use) for an **individual**, a for-profit company with ≤ 3 employees, or a non-profit. You may modify it for your own use. You may *not* sell, rent or relicense a derivative of Remotion. A planned 5.0 licence (draft PR #3750, still open) counts contractors towards team size and binds the company licence to new terms; neither affects you as an individual. **You qualify for the free licence today, including for monetised YouTube videos.** If you ever wanted to distribute the editor as a product, you'd need the "Automators" company licence ($0.01/render, $100/month minimum) **[Verified, remotion.pro]**.

**Packages that matter for us [Measured from package.json]**

| Package | Use in our system |
|---|---|
| `remotion` (core) | Frame clock, `Sequence`, `interpolate`, `spring`, `Easing`, `delayRender` |
| `@remotion/player` | Embeddable preview with seeking, in our own React UI. **This is how we avoid building a preview engine.** |
| `@remotion/renderer` | Node rendering API: `renderMedia`, `renderStill`, `selectComposition`, concurrency, `--gl` options, hardware encoders |
| `@remotion/transitions` | `TransitionSeries` with fade/slide/wipe/flip/clock-wipe presentations, and custom ones |
| `@remotion/motion-blur` | `CameraMotionBlur`, `Trail`: the motion-blurred title slide you use |
| `@remotion/three` | React Three Fiber synced to the frame clock: 3D objects, neural-net and GPU scenes |
| `@remotion/lottie`, `@remotion/rive` | Pre-made vector animations (icons, reactions) |
| `@remotion/captions` | Word-timed caption data structures and TikTok-style pages |
| `@remotion/install-whisper-cpp`, `@remotion/openai-whisper` | Transcription helpers (we'll use Parakeet instead, Section 4) |
| `@remotion/light-leaks`, `@remotion/starburst`, `@remotion/noise`, `@remotion/effects` | Ready-made texture effects for emotion and transitions |
| `@remotion/sfx` | Sound-effect library |
| `@remotion/layout-utils` | `measureText`, `fitText`: auto-sizing labels, essential for geometry QA |
| `@remotion/media-parser`, `@remotion/webcodecs` | Fast metadata parsing, in-browser conversion |
| `@remotion/web-renderer` | In-browser rendering (newer; useful for quick previews of single beats) |
| `@remotion/svg-3d-engine`, `@remotion/rounded-text-box`, `@remotion/shapes`, `@remotion/paths` | Building blocks for diagrams and callouts |
| `template-electron` | Official starting point for an Electron + Remotion desktop app |

**Performance [Reported]**: about 22–28 fps for a typical 1080p30 motion-graphics scene on an M1 (a 10-minute video in ~13 min); throughput stops scaling past concurrency ~8 on large servers; heavy `<OffthreadVideo>` use is the usual bottleneck. Remotion's own docs say to tune with `npx remotion benchmark`. I have **not** benchmarked it on your laptop yet; that is a Phase 2 task with a pass/fail threshold.

**Editor-related**: Remotion Studio is a developer tool (props editing, timeline view of sequences), not an NLE. The **Editor Starter** is a paid, one-time-purchase template with timeline, canvas, asset upload and 80+ feature flags; its price wasn't shown on the docs page I read. It was the single biggest shortcut to a timeline UI, but after review we're using a free open-source timeline instead (Section 3.4).

**Verdict: adopt directly as the rendering and preview core.**

## 2.3 Storytold — `github.com/storytold`

The organisation is not one repository. It holds 80 repos **[Verified]**:

- **2020–2024 history** (FakeYou/"vo.codes" TTS, Unreal Engine plugins, Kinect capture, Bevy experiments). Not relevant.
- **ArtCraft suite (2025–2026, Apache-2.0 / MIT)**, built in Rust with `egui`:

| Repo | What it is | Stars | Created | State |
|---|---|---|---|---|
| `artcraft` | AI image/video "crafting engine" for artists | 38.9k | — | Active (not inspected in depth) |
| **`filmcraft`** | Non-linear video editor | 17.6k | 30 Sep 2026 | v0.17.1, alpha |
| **`effectcraft`** | Motion graphics / compositing (After-Effects-like) | 8.5k | 1 Oct 2026 | v0.21.1, alpha |
| `craft-ai-integrations` | Shared AI provider/keys layer | 139 | — | "first draft" |
| `soundcraft`, `anicraft`, `vectorcraft`, others | Other creative apps | — | Oct 2026 | — |

### FilmCraft [Measured from source + README]

- ~1,190 Rust files, ~463k lines, 40+ crates: its own H.264/HEVC/ProRes/AV1/AAC/Opus codecs, a linear-light GPU compositor, exact integer time, captions, speech (optional), TTS, scopes.
- **Interchange crate**: OTIO, FCP7 XML, FCPXML, AAF, EDL, OMF, ALE. Image sequences and ProRes (incl. alpha) import.
- **Built for agents**: 650+ engine commands behind the UI, CLI, a JSON-lines control channel and an **MCP server**; every widget has an automation id; `ui.screenshot`.
- **Windows x64** MSI and portable builds ship with every release.
- **Self-reported status**: "alpha", feature breadth ~86 %, "ready for real work" ~56 %. Colour grading, keys and export rendering mostly on CPU. **2,054 open issues**. Windows "gets far less testing than macOS".

### EffectCraft [Measured from source + README]

- ~1,215 Rust files, ~516k lines; 308 effects, layer styles, expressions, 3D cameras/lights, Lottie import/export, a SAM2/MobileSAM roto crate.
- **Readable project format**: versioned JSON (`.ecproj`), diffable.
- **Agent surface**: `effectcraft-cli mcp`, one-shot CLI (`render --comp Main --out main.mp4`), control channel.
- First commit 1 Oct 2026; self-reported ~45 % production-ready; 1,053 open issues; Windows has "basic interaction bugs".

**Verdict: watch closely, don't build on them yet.** They are the most interesting projects in this audit, and FilmCraft's OTIO + MCP surface is exactly what a "send to NLE for finishing" feature needs. But two months of history and half a million lines of fast-changing Rust is not a stable base for a personal project you want to finish. Plan: in Phase 6 add an **OTIO export** (base video + rendered alpha overlays per track) that FilmCraft, DaVinci Resolve and Kdenlive can all open. Re-evaluate FilmCraft as a primary editor in ~6 months.

## 2.4 HyperFrames — `heygen-com/hyperframes` (found during research)

| | |
|---|---|
| Licence | Apache-2.0, "no per-render fees or commercial-use thresholds" **[Verified]** |
| Activity | Created 10 Mar 2026, 79.4k stars, 212 open issues, daily commits **[Verified]** |
| Model | Plain **HTML** with `data-start` / `data-duration` / `data-track-index` attributes; animation via adapters (GSAP, CSS, WAAPI, Lottie, Three.js, Anime.js, custom); Puppeteer + FFmpeg; deterministic |
| Extras | ~450 catalog blocks (transitions, kinetic type, charts, maps, 3D, camera moves), agent skills, Studio ("available, evolving"), a free desktop Studio app with a paid Pro plan for HeyGen's generative models |

**Verdict: the strongest alternative to Remotion, kept as the fallback.** It wins on licence and on "agent writes it" ergonomics. It loses for us on three points: (1) its data model is HTML attributes, while we want a typed EDD the UI can edit, which React components map onto more naturally; (2) its default animation runtime is GSAP, whose licence is proprietary and forbids use in visual no-code animation builders that compete with Webflow (an editor with animation controls could arguably be one, see Section 6); (3) its Studio and timeline are younger than Remotion's Player. Its catalog is Apache-2.0 and is a good source of **ideas and code to port** into our component library.

## 2.5 Other projects considered

Star counts, licences and last push from the GitHub API on 5 Nov 2026. "Use" says exactly what we would take.

### Rendering and motion graphics

| Project | Licence | Stars / last push | Use | Decision |
|---|---|---|---|---|
| Motion Canvas | MIT | 19.7k / Jul 2026 | Generator-based animation, excellent for code-style explainer animation | Not adopted: its own editor and imperative timeline don't fit a data-driven EDD; slowing activity |
| Revideo (Motion Canvas fork) | MIT | repo moved, not verified | Headless Motion Canvas rendering | Not adopted |
| Manim (Community) | MIT | 42.3k / active | Math/CS animations (graphs, transforms) | **Optional**: render specific technical clips to ProRes 4444 and place them as video layers |
| Lottie-web | MIT | 32.4k / Sep 2025 | Vector animations | Via `@remotion/lottie` |
| Rive (wasm) | MIT runtime | 1.0k / active | Interactive vector animation with state machines | Via `@remotion/rive`, optional |
| React Three Fiber | MIT | 33.5k / active | 3D in React | **Adopt** through `@remotion/three` |
| Motion (Framer Motion) | MIT | 34.9k / active | UI animation | **Adopt for the app UI only**; not frame-deterministic for rendering |
| GSAP | Proprietary "No Charge" | 30.2k / active | Timeline animation | **Avoid in the renderer** (licence clause, and Remotion's `interpolate`/`spring` cover it) |
| Theatre.js | Apache-2.0 | 12.9k / Aug 2024 | Visual keyframe editor | Not adopted: stale |
| editly | MIT | 5.6k / May 2025 | JSON → video slideshow editor | Not adopted: stale, too limited; its JSON spec is a useful reference |
| fframes | — | not checked | Rust/Skia renderer, ~4.5× faster than Remotion in one [Reported] test | Not adopted: rewrites everything for render speed we don't need |

### Editors and timeline UIs

| Project | Licence | Stars / last push | Use | Decision |
|---|---|---|---|---|
| OpenCut | MIT | 97.4k / Sep 2026 | Web-based CapCut-style editor | **Mine for code** (timeline interactions, MIT); not inspected in depth, verify in Phase 6 |
| `@xzdarcy/react-timeline-editor` | MIT | 801 / Jan 2026 | React timeline widget (tracks, drag, resize, cursor) | **Adopted** as our timeline (Section 3.4) |
| `dnd-timeline` | MIT | 252 / Aug 2026 | Headless timeline hooks on dnd-kit | **Fallback** if the spike fails |
| Clypra | MIT | 3.3k / active | Tauri + React + Rust desktop editor | Reference code only (an app, not a library) |
| Remotion Editor Starter | Paid template | — | Full editor template | Not used (open-source timeline chosen) |
| twick | unclear (NOASSERTION) | 546 | React video editor SDK | Not adopted: licence unclear |
| Diffusion Studio core | MPL-2.0 | 1.3k / Nov 2025 | Browser WebCodecs editing engine | Not adopted: quiet for a year |
| Etro | GPL-3.0 | 1.2k | Browser video editing framework | Not adopted: GPL, small |
| Kdenlive / Shotcut (MLT) | GPL / LGPL-2.1 | MLT 1.9k / active | Mature desktop NLEs | **Export target** (via OTIO/MLT XML), not a foundation |
| Olive | GPL-3.0 | 9.1k / Dec 2024 | NLE | Not adopted: stalled |
| OpenShot (libopenshot) | LGPL-3.0 | 1.6k / active | NLE library | Not adopted: Qt/C++ integration cost |
| DaVinci Resolve (free) | Proprietary freeware | — | Best free NLE; scripting API | **Export target** via OTIO/FCPXML |
| FilmCraft | MIT/Apache | see §2.3 | Rust NLE, MCP | **Future export target / re-evaluate** |
| OpenTimelineIO | Apache-2.0 | 2.1k / active | Interchange format | **Adopt** for export |

### Audio, speech and timing

| Project | Licence | Use | Decision |
|---|---|---|---|
| NVIDIA Parakeet TDT 0.6B v3 (model) | CC-BY-4.0 | ASR with native word timestamps, punctuation, ~6.3 % avg WER | **Adopt** as primary ASR |
| faster-whisper | MIT (26.5k, active) | Whisper on CTranslate2 | **Fallback** ASR (non-European languages). On RTX 50-series int8 can fail; use `float16` **[Verified, CTranslate2 #1865]** |
| WhisperX | BSD-2 (25.1k, active) | Whisper + wav2vec2 alignment + diarisation | Fallback aligner |
| ctc-forced-aligner | BSD-2 (574, Sep 2026) | Align a **known script** to audio | **Adopt** for script-to-audio alignment |
| whisper.cpp | MIT (55k) | CPU/GPU Whisper | Not needed |
| stable-ts | MIT, **archived** | Timestamp stabilisation | Not adopted |
| auto-editor | Unlicense (5.8k, active) | Silence/motion-based cutting | **Adopt** ideas or call it for silence detection in raw footage |
| PySceneDetect | BSD-3 (5.4k, active) | Shot boundaries in footage | **Adopt** for footage ingest |
| wavesurfer.js | BSD-3 (10.5k, active) | Waveform rendering in the UI | **Adopt** |

### Vision, retrieval and agents

| Project | Licence | Use | Decision |
|---|---|---|---|
| SAM 2 | Apache-2.0 (20.1k) | Segment/track the subject for zoom focus points | **Adopt** (small/tiny checkpoints) |
| BiRefNet | MIT (4.4k, active) | Background removal (cut-outs for "pop-in" images) | **Adopt**; avoid RMBG-2.0 (non-commercial) |
| Qwen3-VL-Embedding 2B | Apache-2.0 | Text ↔ image/video embeddings for asset search | **Adopt** |
| SigLIP 2 | Apache-2.0 | Fast zero-shot tagging | **Adopt** as a cheap tagger |
| open_clip | custom (NOASSERTION) | CLIP models | Not needed |
| LanceDB | Apache-2.0 (11.8k) | Embedded vector DB, files on disk | **Adopt** |
| sqlite-vec | Apache-2.0 (8.2k, May 2026) | Vectors inside SQLite | Alternative |
| llama.cpp | MIT (133k) | Local LLM/VLM server, OpenAI-compatible | **Adopt** for local models |
| Ollama | MIT | Easier local model management | Already installed (0.23.3, needs update to ≥ 0.40 for Bolt) |
| LangGraph | MIT (44.5k) | Graph-based agent orchestration | Not adopted: our pipeline is a fixed DAG, a library adds little |
| PydanticAI | MIT (21k) | Typed LLM calls with schema validation | **Adopt** in the Python sidecar for structured outputs |
| Mastra | unclear (NOASSERTION) | TS agent framework | Not adopted: licence unclear |
| SearXNG | AGPL-3.0 (39k) | Self-hosted meta-search (image search) | **Optional**, local only (AGPL is fine for private use) |
| Iconify | MIT tooling; **per-set icon licences** | 200k+ icons | **Adopt**, filtering sets by licence |
| Openverse | MIT | CC/public-domain image search | **Adopt** |
