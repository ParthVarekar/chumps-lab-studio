# 3. Architecture comparison (C) and desktop application design (I)

## 3.1 The decision that matters most: what does the AI produce?

Before comparing engines, one choice dominates everything else: whether the AI's output is **code** (it writes `.tsx`/`.html` compositions) or **data** (it writes a structured edit document that a fixed component library renders).

| | AI writes code | AI writes data (EDD) |
|---|---|---|
| Validation | Only by compiling and rendering | JSON Schema / Zod, instantly |
| Manual edits in a UI | Needs code-rewriting round-trips | Native: the UI edits the same fields |
| Locks ("don't touch my edit") | Very hard (code merges) | One `locked: true` flag per node |
| Regenerate one decision | Rewrite a file and hope | Replace one node |
| Diff and undo | Text diffs of code | Structured patches (RFC 6902 JSON Patch) |
| Visual variety | Unlimited, also unlimited breakage | Bounded by the library, which is grown on purpose |
| Consistency / no "AI look" | Hard to enforce | Enforced by design tokens in the components |

**Decision: data for the edit, code only for new components.** When the planner wants a visual that no component can make (a specific animated GPU-die diagram, say), it opens a separate **component request**: the coding model writes a new parameterised component in a sandbox folder, it is rendered as a test still and a short clip, you approve it once, and from then on it is just another component the EDD can reference. That is how the library grows beyond your current style without the edit itself becoming code.

## 3.2 Candidate architectures

| | **A. Rendiv-first** | **B. Remotion + AI-written TSX** | **C. Remotion + EDD + Electron (recommended)** | **D. HyperFrames + EDD** | **E. Hybrid NLE (FilmCraft/Resolve + overlay renderer)** |
|---|---|---|---|---|---|
| Idea | Use Rendiv and its Studio | The common "agent writes Remotion code" setup | Typed EDD rendered by our Remotion component library; open-source timeline component + `@remotion/player` | Same EDD, compiled to HyperFrames HTML instead | NLE holds the edit; our engine renders motion graphics as alpha clips, sent over OTIO/MCP |
| Development effort | Medium, plus fixing Rendiv | **Lowest to first video** | Medium | Medium–high (EDD→HTML compiler, adapter work) | **Highest** (two timelines, round-tripping) |
| Editing flexibility | Low (timing-only overrides) | Low (edit = code edit) | **High** | High | Very high in the NLE, but AI changes and manual NLE changes diverge |
| Visual quality ceiling | Same as Remotion | High | High | High | High |
| Animation capability | Remotion-equivalent subset | Full Remotion ecosystem | Full Remotion ecosystem | GSAP/CSS/Lottie/Three, 450 blocks | Split across two tools |
| AI agent fit | Good (skills) | Good for one-shot, poor for iteration | **Best for iteration** (patches, locks) | Good | Good in principle (MCP), immature |
| Desktop integration | Browser Studio | Remotion Studio (dev tool) | Electron app, own UI | Own UI or HyperFrames Studio | Native NLE |
| Render performance | Playwright screenshots, no tuning yet | ~22–28 fps on M1 [Reported] | Same as B, plus per-beat caching | Similar (Chrome + FFmpeg) | NLE export speed + overlay renders |
| Hardware needs | Low | Low | Low (8 GB VRAM is ample for rendering) | Low | Low–medium |
| Offline | Yes | Yes | Yes (except LLM/VL API calls) | Yes | Yes |
| Licence | Apache-2.0 | Remotion (free for you) | Remotion (free for you) | Apache-2.0; GSAP proprietary | NLE licences + ours |
| Long-term maintainability | **Poor** (single maintainer) | Poor (generated code piles up) | **Good** | Good, but young (8 months) | Poor today (FilmCraft alpha) |
| Verdict | Reject | Reject as the main design; reuse for component authoring | **Adopt** | **Fallback** if Remotion's licence or performance becomes a problem | **Later export path**, not the core |

**Why C beats D, briefly.** Both separate data from rendering, which is the important part. C wins because the EDD maps naturally to React components with typed props, because `@remotion/player` gives a frame-accurate, seekable preview inside our own React UI today, and because Remotion's ecosystem (motion blur, Three, transitions, captions, layout measurement) is larger and older. D's advantages (Apache-2.0, HTML) matter mostly for distributing a product, which you've said you won't do. Keeping the EDD renderer-agnostic keeps D available: a second "backend" can compile the same EDD to HyperFrames HTML.

## 3.3 Recommended architecture in detail

### Processes

```
┌──────────────────────────── Electron app ─────────────────────────────┐
│  Renderer process (React + TypeScript)                                 │
│   ├─ Timeline, Inspector, Script view, Asset browser, QA panel         │
│   ├─ @remotion/player  ← renders the EDD live with the component lib   │
│   └─ EDD store (Zustand + Immer, JSON-Patch history, locks)            │
│                                                                        │
│  Main process (Node)                                                   │
│   ├─ Project I/O, file watching, autosave                              │
│   ├─ Render service: @remotion/bundler + @remotion/renderer            │
│   ├─ LLM gateway: OpenRouter / NVIDIA / local llama.cpp (one interface)│
│   ├─ GPU scheduler: one GPU-heavy job at a time                        │
│   └─ Sidecar supervisor ──────────────┐                                │
└───────────────────────────────────────│───────────────────────────────┘
                                        ▼  JSON-RPC over localhost HTTP
┌──────────────── Python sidecar (uv, Python 3.12, CUDA 12.8 wheels) ────┐
│  ASR (Parakeet) · script alignment · prosody/emphasis · emotion       │
│  scene detection · SAM2 focus points · BiRefNet cut-outs              │
│  embeddings (Qwen3-VL-Embedding) · tagging (SigLIP 2) · LanceDB       │
│  frame sampler + geometry QA helpers · image generation (optional)    │
└────────────────────────────────────────────────────────────────────────┘
          ▲ on demand: llama-server (Gemma 4 E4B / Nemotron Bolt E4B / Qwen3-VL 8B)
```

- **Why Electron, not Tauri**: Remotion's renderer is a Node library that drives Chrome. Electron ships Node and Chromium; Remotion maintains an Electron template. With Tauri we'd still have to bundle Node as a sidecar, and the Player would run in WebView2, which differs from the Chrome used at render time (preview ≠ render risk). Electron's ~150–250 MB RAM overhead is acceptable on 24 GB.
- **Why a Python sidecar**: every model we need (Parakeet/NeMo or ONNX, SAM2, BiRefNet, embedding models) is Python-first. Keeping it in one supervised process with a small RPC surface lets us restart it, swap models and keep GPU memory under control.
- **GPU scheduler**: the RTX 5050 has 8 GB. Only one heavy model is resident at a time (e.g. Parakeet → unload → SAM2 → unload). NVENC encoding and Chrome's GPU rasterisation can overlap with small models but not with image generation.

### Project on disk (all on D:)

```
D:\ChumpsLabStudio\projects\<slug>\
  project.json            # settings, pacing profile, style profile ref
  edd.json                # the Edit Decision Document (current)
  history\000123.patch.json  # JSON-Patch per change, with author (ai|user), reason, timestamp
  media\                  # originals (or links to them)
  proxies\                # 540p/720p proxies for footage
  analysis\               # transcript.json, words.json, beats.json, shots.json, prosody.json
  assets.lance\           # project-local vector index (global index lives in D:\ChumpsLabStudio\library)
  cache\beats\<hash>.mp4  # rendered beat segments, keyed by content hash
  renders\                # previews and finals
  qa\                     # sampled frames, geometry reports, VL reports
```

### Key mechanisms

- **Content-hash caching**: each beat is rendered separately and stored under the hash of its EDD subtree + component versions + asset hashes. Changing one beat re-renders one beat; the final is a concatenation (stream copy when codecs match). This is what makes "regenerate only the affected compositions" real.
- **Determinism**: no `Math.random()` without a seed from the EDD; fonts are bundled locally, not fetched; assets are content-addressed; component library is versioned and the version is stored in the EDD.
- **Provenance**: every node in the EDD carries `origin` (`ai` / `user` / `template`), `reason` (one sentence from the planner), and `assetRefs` with licence info. You can always ask "why is this here?".

## 3.4 Desktop application design (I)

### Layout

```
┌───────────────┬───────────────────────────────────────┬────────────────┐
│ Project       │                                       │ Inspector      │
│ ├ Media       │           Preview (Player)            │ ─ What: Pop-in │
│ ├ Assets      │     safe-area + grid overlays (toggle)│   image        │
│ ├ Script      │     click any element to select it    │ ─ Why: "GPU"   │
│ └ QA (12)     │                                       │   at 01:42.3   │
│               │                                       │ ─ Props…       │
│ Script view:  ├───────────────────────────────────────┤ ─ Alternatives │
│ words, beats, │ ◀ ▶  01:42:08 / 09:58   1080p  30 fps │ ─ 🔒 Lock      │
│ emphasis      ├───────────────────────────────────────┤ ─ ↻ Regenerate │
│ markers       │ Timeline                              │   this beat    │
│               │ Beats   ▏B12 ▏B13       ▏B14▏         │                │
│               │ Camera  ▏zoom▏    ▏pan  ▏             │ AI assistant   │
│               │ Overlay ▏img ▏txt▏meme▏  ▏diagram▏    │ (proposals as  │
│               │ Text    ▏    ▏title ▏                 │  diffs to      │
│               │ Base    ▏screen-rec ─────────────────▏│  accept/reject)│
│               │ FX      ▏      ▏red-tint▏             │                │
│               │ Voice   ▁▂▅▇▅▂▁▂▅▇▇▅▂ (waveform)      │                │
│               │ Music   ───────────────────────────── │                │
│               │ SFX     ▪   ▪      ▪                  │                │
└───────────────┴───────────────────────────────────────┴────────────────┘
```

### Timeline component (decided: reuse, don't build)

| | **`@xzdarcy/react-timeline-editor`** (default) | **`dnd-timeline`** (fallback) |
|---|---|---|
| Licence | MIT | MIT |
| Version / activity | 1.0.0, released 25 Jan 2026; 801 stars; 42 open issues | 3.1.1, released 16 May 2026; 252 stars; 5 open issues |
| Usage | ~47,500 npm downloads/month | ~70,600 npm downloads/month |
| What it gives us | A complete timeline widget: rows (tracks) of actions (clips) with start/end, drag and resize (interact.js), time ruler, playhead cursor, scale/zoom, virtualised rows, custom render per action | Headless hooks (`useRow`, `useItem`) on top of dnd-kit: dragging, resizing, snapping to a grid, stacking overlapping items; zero styling |
| Fit with the EDD | Direct: track → `TimelineRow`, layer → `TimelineAction` (`start`, `end`, `effectId` = layer kind) | Direct, but we draw every pixel ourselves |
| Our work on top | Styling, waveform row, origin/lock badges, word-anchored snapping | All of the above **plus** the ruler, playhead and clip visuals |
| Known gaps | One row height for all rows (issue #69; the voice-waveform track needs to be taller); a report of trouble updating data from outside the component (#66), which is exactly what AI patches do; no built-in undo or multi-select (#73, #74; we have our own history anyway) | Less out of the box; more code for us |
| React 19 | Peer `react >= 18` | No React peer constraint declared |

**Plan**: the first day of Phase 6 is a spike on the default. It passes if (1) an external EDD patch updates the timeline without remounting it, (2) a 400-clip, 9-track, 10-minute project scrolls and zooms smoothly, and (3) a taller waveform row can be done with a custom row renderer. If any check fails, switch to `dnd-timeline`. Writing our own timeline is the last resort, and only for the parts neither covers.

Not chosen as components: OpenCut (MIT, 97k stars) and Clypra (MIT, 3.3k stars) are whole editor apps, not libraries; we can read their timeline code for interaction details. Remotion's paid Editor Starter is no longer considered. Waveforms come from **wavesurfer.js** rendered inside the voice row.

### Workflows

- **Review mode** (the default after AI generation): the timeline shows every AI decision with a small origin marker. `J/K/L` to play, `N` to jump to the next decision, `A` accept, `X` reject (replace with the best alternative), `R` regenerate, `L` lock.
- **Script view**: the narration as text, aligned to time. Clicking a word seeks there. Beats are shown as paragraphs; emphasis words are underlined; you can drag a visual from the asset panel onto a *word* (not a time), and it stays attached to that word if timings change.
- **Direct manipulation in the preview**: drag to reposition, corner handles to scale, a focus-point crosshair for zooms. Every change becomes a user patch.
- **QA panel**: a list of issues (geometry and VL) with thumbnails; each has "fix automatically", "ignore" and "go to".
- **Assistant panel**: natural-language requests ("make the GPU section punchier", "fewer memes in the intro"). The answer is always a **proposed patch**, previewed before it is applied.

### Visual design of the app

- Neutral graphite UI (`#141416` → `#1E1F22` surfaces), one accent used only for selection and the playhead, track colours muted and distinguishable by lightness, not hue alone.
- Typography: one UI family (Inter or IBM Plex Sans, bundled), tabular numerals for timecode, 12–13 px base in dense panels.
- No gradients, no glow, no purple; motion only for state changes (≤ 150 ms).
- Panels dock and remember their layout. Keyboard-first, with every action also in a command palette (`Ctrl+K`), because every action is a command, which also makes it callable by the AI.
