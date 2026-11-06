# 5. Pipeline design (F) and visual/motion system (G)

## 5.1 The Edit Decision Document (EDD)

Every stage reads and writes this one document. It is the contract between the AI, the UI and the renderer. Sketch (TypeScript, validated with Zod):

```ts
type Time = { word?: WordRef; at?: number /* seconds */; offset?: number }; // anchor to a word when possible

interface EDD {
  version: 3;
  componentLibrary: string;          // e.g. "cls-motion@0.4.2" — pinned for determinism
  format: { width: 1920; height: 1080; fps: 30 };
  look: LookRef;                     // palette, type scale, grain, safe area (see 5.8)
  pacing: "dense" | "standard" | "calm";
  tracks: { voice: AudioClip; music: AudioClip[]; sfx: SfxCue[] };
  beats: Beat[];                     // ordered, contiguous
}

interface Beat {
  id: string; start: Time; end: Time;
  narration: { text: string; wordIds: string[] };
  intent: { point: string; viewerShouldUnderstand: string; tone: Tone; humour?: string };
  base: BaseLayer;                   // footage / screen recording / generated background
  layers: Layer[];                   // accumulate within the beat
  camera: CameraMove[];              // zooms, pans, tilts over the beat's stage
  moods: MoodEffect[];               // emotion effects, budgeted
  transitionIn?: Transition;
  meta: NodeMeta;
}

interface Layer {
  id: string;
  kind: "image" | "meme" | "screenshot" | "text" | "label" | "icon" | "chart"
      | "diagram" | "code" | "terminal" | "video" | "component";
  component: string;                 // e.g. "EvidenceCard", "PopImage", "NeuralNet"
  props: Record<string, unknown>;    // validated against that component's own schema
  enter: { at: Time; preset: string; direction?: Dir; durationFrames: number };
  exit?: { at: Time; preset: string };
  box: { x: number; y: number; w: number; h: number; rotation?: number; anchor?: string }; // in frame %
  z: number;
  assets: AssetRef[];                // content hash + source + licence
  meta: NodeMeta;
}

interface NodeMeta {
  origin: "ai" | "user" | "template";
  locked: boolean;                   // AI never patches a locked node or its children
  reason?: string;                   // one sentence: why this exists
  alternatives?: string[];           // ids of runner-up proposals, kept for "replace"
  qa?: { lastScore: number; issues: string[] };
}
```

Anchoring to **words** rather than seconds is deliberate: if you re-record a sentence and re-align, every visual tied to a word moves with it.

## 5.2 Stage by stage

| # | Stage | Inputs | Work | Outputs | Runs on |
|---|---|---|---|---|---|
| 1 | **Ingest** | Files dropped into a project | ffprobe metadata; content hash; proxies (720p H.264 via NVENC) for footage; shot detection (PySceneDetect); OCR of screen recordings at 1 fps; audio loudness (EBU R128) | `media.json`, `shots.json`, `ocr.json`, proxies | CPU + NVENC |
| 2 | **Audio & narrative** | Narration audio, script (optional) | Parakeet ASR → words with times; if a script exists, align **script text** to audio (ctc-forced-aligner) and keep ASR only where you ad-libbed; pauses (silence > 250 ms); pitch/energy per word → emphasis score; sentence boundaries; local LLM tags jokes/rhetorical questions | `words.json` (word, start, end, emphasis, pauseAfter), `sentences.json`, `prosody.json` | GPU (small) |
| 3 | **Semantic planning** | words, sentences, style profile, asset catalogue summary, component catalogue | **Pass 1 (Ultra)**: beat sheet: boundaries, point, tone, arc, recurring motifs, where hard cuts go, where the footage should carry the story. **Pass 2 (Ultra, ~6 beats per request to fit the free tier)**: visual plan: which words get visuals, what kind, which zooms, which mood, with 2–3 alternatives per slot and search queries for assets | `beats.json`, `visual-plan.json` | API |
| 4 | **Asset discovery & generation** | Visual plan slots + queries | Search local library (embeddings), then providers (Section 6); rank with Qwen3-VL-Embedding + reranker; cut-outs (BiRefNet); generate only as last resort; component requests for missing visuals | Resolved `AssetRef`s with licence records; component requests | Local + APIs |
| 5 | **Composition** | Visual plan + assets + look | Deterministic **layout solver** places layers (grid, safe areas, avoid the focus region, avoid captions); **motion chooser** assigns entrance presets (5.6); **camera planner** computes zoom rects from focus points (5.5); mood budget enforcement; SFX cues on entrances and cuts | `edd.json` | CPU |
| 6 | **Render** | EDD | Per-beat render with content-hash cache; preview at 720p/30 with `jpeg` frames; final at 1080p (or 1440p) with PNG frames for text-heavy beats; NVENC HEVC/H.264; audio mix (voice −16 LUFS integrated for YouTube, music ducked under voice by −14 to −18 dB) | `renders/preview.mp4`, beat cache | CPU + NVENC |
| 7 | **QA** | EDD + render | Geometry checks on every sampled frame (5.4); pacing metrics vs profile (from Section 1); VL review of selected frames/clips; produce issue list with severity | `qa/report.json` | Local + API |
| 8 | **Improve** | Issues + EDD | Ultra translates issues into **JSON-Patch** on unlocked nodes; validator; re-render changed beats only; VL pairwise compare before/after; accept if better | new EDD version | API + local |

## 5.3 How the planner thinks (prompt design)

The planner is given *principles and constraints*, not a template:

- The style principles from [01-style-study.md](01-style-study.md) §1.4 and the measured `style-profile.json`.
- The **component catalogue**: each component's name, purpose, props schema, and 2–3 thumbnail descriptions. The planner can only pick from it or file a component request.
- **A pacing profile per beat** (`dense` / `standard` / `screen-carries`, measured in §1.6 of the style study), chosen from the beat's intent and how much the base footage already moves. Default is `standard`: 12–18 visual changes/min.
- **Timing default**: a word-anchored visual enters at **word start − 0.5 s** (your measured habit), never earlier than the previous sentence's end.
- **Budgets** for the beat: target visual changes per minute for its profile; max one mood effect per 45 s; max one meme per 30 s; max two zooms per sentence.
- **Preferred devices** in order, from the baseline: literal word illustration (logo, icon, photo, cut-out), zoom-and-hold into the exact UI element, label placed on that UI element, single-word kinetic caption, visual pun, meme clip.
- **Variety memory**: the last 8 entrance presets/directions, the last 20 asset ids, the last 5 layouts used. The planner is told what it must not repeat.
- **Footage awareness**: shot list + motion level of the base layer; "if the base layer already changes meaningfully, prefer fewer overlays".
- Output: JSON only, with `reason` per decision and ranked alternatives.

## 5.4 Visual QA, designed for an 8 GB laptop

### Tier 1: exact geometry checks (free, every sampled frame)

Each component in our library reports its boxes. In an inspection pass, a headless Chrome page loads the same bundle, seeks to each sampled frame and reads `getBoundingClientRect()` for every element with a `data-edd-id`, plus a downscaled screenshot for pixel statistics.

| Check | Rule (initial values, tuned in Phase 5) |
|---|---|
| Safe area | Text and key subjects inside 5 % margins (title-safe) |
| Text size | Cap height ≥ 3 % of frame height for labels, ≥ 5 % for titles |
| Contrast | WCAG contrast ≥ 4.5:1 between text and the pixels behind its box (sampled from the render) |
| Overlap | Text box overlaps another text box or a focus region (from SAM2/OCR) → issue |
| Clipping | Element box partly outside frame without an intentional "bleed" flag |
| Scale | Pop-in image < 8 % of frame area → "too small"; > 70 % without being a full-frame card → "crowded" |
| Repetition | Same entrance preset+direction 3× in a row; same asset reused within 3 min; same layout 3 beats running |
| Pacing | Median gap between changes and share of gaps > 5 s vs profile, per minute of video |
| Dead air | > 4 s with no layer change *and* low base-layer motion |
| Abruptness | Entrance < 4 frames for kinds other than meme/cut |

### Tier 2: which frames go to Nemotron 3.5 Super VL

Sampling strategy, per beat:

1. **Settled frames**: one frame shortly after each layer finishes entering (where the composition is "complete").
2. **Peak frames**: the held moment of each zoom.
3. **Transition midpoints** and the first frame after each hard cut.
4. **Short clips** (2–6 s, 480p) around each new kind of motion the first time it appears, since Super VL accepts video ≤ 2 min.
5. Every frame Tier 1 flagged, to confirm or reject.
6. Deduplicate by perceptual hash; batch **12 frames per request** as a labelled contact sheet with the beats' narration and plan (the free tier limits requests per day, not tokens).

For a 10-minute video with ~300–600 visual events this is ~150–300 frames per iteration instead of 18,000 **[Estimate]**.

The VL model gets a rubric and must answer in JSON:

```json
{
  "frame": "B14@01:42.27",
  "issues": [
    { "type": "relevance", "severity": 2, "element": "L14.3",
      "observation": "Image shows a generic circuit board; narration says 'neural network'.",
      "suggestion": "replace_asset", "query": "neural network diagram layers nodes" },
    { "type": "composition", "severity": 1, "element": "L14.2",
      "observation": "Label sits on the subject's face.", "suggestion": "move", "direction": "up-left" }
  ],
  "overall": { "readability": 4, "balance": 3, "looksTemplated": false }
}
```

Ultra then turns the issues into a patch. The model is never asked for pixel coordinates; the layout solver computes them from the suggestion.

### Tier 3: you

Anything that changes more than ~30 % of a beat, replaces an asset you approved, or touches a beat you've edited is proposed, not applied.

## 5.5 Contextual zoom and reframing

1. **Trigger**: word with high emphasis score *and* a planner decision that it deserves a zoom (not every emphasis).
2. **Target**: find the on-screen region for the concept. For screen recordings, search OCR boxes for the word or its synonyms ("neural network" → OCR hit on the slide title); for footage or images, SAM2 with a point or box prompt from the VL model's coarse location ("upper-left quadrant"), or the layer's own box when the target is an overlay we placed.
3. **Frame the target**: compute a camera rect around the target with padding (target occupies ~45–60 % of frame width), keep the aspect ratio, shift so the target sits on a third line or centre depending on the composition, and clamp to the source so no black edges show.
4. **Move**: `in` over 6 frames (0.2 s at 30 fps) with a strong ease-out (cubic-bezier 0.2, 0, 0, 1) or a critically damped spring; optional motion blur on moves > 15 % of frame width per frame; optional 3–6° perspective tilt for energy (as in your C++ video).
5. **Hold** until the end of the phrase (from word timings) or a minimum of 0.6 s.
6. **Return** over 8–12 frames, *or* carry straight into the next composition if the next beat starts within 0.3 s.
7. **Limits**: no more than two zooms per sentence; never zoom on a frame where text the viewer must read would leave the frame.

## 5.6 Entrance and exit motion

Every element kind has a **verb** (consistent within a video) and a set of **variants** (rotated):

| Kind | Default verb | Variants | Typical duration @30 fps |
|---|---|---|---|
| Section title | Slide + motion blur | from left/right/bottom; letter-stagger; scale-from-120 % | 8–10 frames |
| Label / callout | Pop (spring overshoot ~1.08) | tilted −8° to −30°; with bracket line drawing to target; underline wipe | 5–7 |
| Evidence card (screenshot/document) | Scale-in from 92 % + shadow fade | slide up 6 %; rise with 2° tilt correction; highlight-sweep on the quoted line after landing | 10–14 |
| Pop-in image / cut-out | Spring pop from centre | slide from nearest edge; drop from top with bounce; stack (fan of 2–3) | 6–9 |
| Meme | **Hard cut** full-frame, or corner sticker pop | shake-in; zoom-punch | 0–4 |
| Icon / logo | Pop with small rotation (±10°) | bounce; orbit into place | 5–8 |
| Diagram | Draw-on strokes, nodes stagger | grow from source to sink; reveal by layer | 15–40 |
| Chart | Axes draw, then bars/lines grow, numbers count up | sort/race; highlight one bar | 20–45 |
| Code / terminal | Typewriter, then line highlight | diff-style insert/delete | per character |

**Motion chooser rules** (deterministic, seeded by beat id so renders are reproducible):

- Enter from the **edge nearest the element's final position**, or along the **narrative direction** (arrows and comparisons enter source → destination).
- No preset+direction pair three times in a row; no direction more than 40 % of entrances in any 60 s window.
- Emphasis words get the faster end of the range; supporting evidence the slower end.
- Exits are quieter than entrances (fade/scale-down over 4–6 frames) unless the next element replaces it in place (then cut).
- Within a beat, staggered entrances use 3–6 frame offsets so they read as one gesture.

## 5.7 Moods (emotion effects)

Composable effects with an **intensity 0–1** and a **budget**:

| Mood | Components (each optional) | Default intensity |
|---|---|---|
| Frustration / anger | red multiply tint 15–30 %, camera shake (noise, 2–6 px, decaying over 0.4 s), punch-in zoom 1.06–1.1, low "thud" SFX | 0.6, ≤ 0.8 s |
| Sadness / disappointment | desaturate 60–80 %, slight cool shift, slow 1–2 % drift, rain overlay (alpha video), music ducked | 0.5, a phrase |
| Happiness / satisfaction | +5–10 % exposure, warm shift, sparkle/sun overlay, bouncier springs on entrances for the next few seconds | 0.4 |
| Shock | 2-frame white flash, zoom punch, record-scratch SFX | 0.8, < 0.3 s |
| Confusion | wobble on the subject, floating "?" icons, slow push-in | 0.4 |
| Irony / deadpan | freeze-frame + desaturate + "silence" (music cut) | 0.5 |

Detection: the planner proposes moods from the text and prosody (raised pitch/energy, long pause before a punchline); the composer enforces the budget (default: one mood per 45 s, never two in a row of the same kind). You can raise or lower the budget per project.

## 5.8 Look, design tokens and the "not AI-made" rules

Each video gets **one look** (chosen or authored), stored as tokens:

- **Palette**: one neutral background family, one text colour, one primary accent and at most one secondary accent. Pick from curated looks (e.g. *Terminal Noir*: near-black + off-white + signal orange; *Paper*: warm white + ink + red pencil; *Footage-first*: no background, white type with dark outline as in your videos). No gradients unless a look defines one.
- **Type**: two families maximum (a heavy display face for titles/labels and a mono for code); bundled locally. Candidates with permissive licences: Inter, Archivo / Archivo Black, Space Grotesk, Bebas Neue, JetBrains Mono, IBM Plex (all OFL).
- **Scale**: a modular type scale (e.g. 1.333) in frame-height percentages; a 12-column grid; title-safe margins.
- **Texture**: optional film grain/noise at 2–4 % to tie stock images, screenshots and generated graphics together.

Hard rules enforced by QA: no more than 2 accent colours on screen; no text with drop shadow *and* outline *and* glow; no purple-blue gradient backgrounds; no centred-everything layouts three beats in a row; no stock-photo people "smiling at laptop" unless the joke calls for it.

## 5.9 Technical visual component library (initial set)

Each is a parameterised Remotion component with a props schema the planner fills in. Examples of props shown.

| Component | Props (abridged) | Built with |
|---|---|---|
| `NeuralNet` | `layers: number[]`, `activationPath`, `pulseOnWords` | SVG, `@remotion/paths` |
| `BarChart` / `BarRace` | `series`, `highlight`, `unit`, `sort` | SVG + d3-scale |
| `LineChart` | `series`, `annotate: {x, label}[]` | SVG, path draw-on |
| `Gauge` (speedometer) | `value`, `max`, `redline`, `label` | SVG |
| `ChipDie` (CPU/GPU) | `cores`, `activeCores`, `cache`, `labelling` | SVG / `@remotion/three` |
| `MemoryBlocks` | `cells`, `allocations`, `pointer` | SVG grid |
| `DataFlow` | `nodes`, `edges`, `packets`, `layout: "lr"|"tb"` | SVG + dagre (MIT) auto-layout |
| `ArchitectureDiagram` | `services`, `links`, `groups`, `revealOrder` | SVG + ELK.js (EPL-2.0) or dagre |
| `CircuitTraces` | `seed`, `density`, `glowPath` | Procedural SVG |
| `NetworkTopology` | `graph`, `failNodes`, `flow` | SVG / Three |
| `Terminal` | `lines`, `typingSpeed`, `prompt` | DOM + bundled mono font |
| `CodeBlock` | `code`, `lang`, `highlightLines`, `diff` | Shiki (MIT) |
| `Comparison` | `left`, `right`, `metrics`, `winner` | Layout component |
| `TimelineStrip` | `events`, `focus` | SVG |
| `WorldMap` | `countries`, `arcs`, `pins` | Natural Earth (public domain) SVG |
| `Particles` | `count`, `field`, `seed` | Canvas/Three, seeded |
| `EvidenceCard` | `image`, `highlightRect`, `source` | DOM |
| `BracketLabel` | `target`, `text`, `side` | SVG + DOM |

The library grows through **component requests** (Section 3.1). Each new component ships with: a props schema, a Storybook-style "contact sheet" composition rendering 6 variations, and a geometry report so QA can reason about it.
