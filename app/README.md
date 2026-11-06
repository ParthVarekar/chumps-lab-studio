# @cls/app: the editor

A video editor for the AI-planned edits, in the browser at **http://localhost:4173**. The preview is the Remotion
Player running the engine's own compositions, so what you see is what renders.

```
npm run web      build the UI and start the server (then open http://localhost:4173)
npm run serve    start the server without rebuilding
npm start        a desktop window around the same server (untested on this machine)
npm test         unit tests for the command layer
node ../node_modules/tsx/dist/cli.mjs test/e2e.mts   end-to-end test in a real Chrome (18 checks, on a copy of a project)
```

## What you can do

| Where | What |
|---|---|
| **Library** (left) | A rail of sections. *Add*: title, big word, step header, lower third, step badge, colour chip, code, terminal, zoom/label, mood effects. *Effects*: highlight box / circle / underline, spotlight, blur and blackout, arrow, click ripple. *Transitions*: flash, dip to black, colour wipe, glitch, vignette, letterbox. *Captions*: pop, line or karaoke words from the transcript. *Elements*: AI-designed animated graphics (see below) plus 14 ready-made ones. *Logos*: search 3,000. *Stickers*: 30 animated reactions. *Sounds*: 184 effects. *Script*: the transcript. **Every tile is placed the same way**: click it and drag a box (or arrow, or click a point) on the preview, or **drag the tile onto the picture**. Effects follow the camera, so they stay on the thing you pointed at |
| **Preview** (centre) | Play, frame-step, guides. Click an item and **drag its handles on the preview** to move or resize. Draw a box to zoom or label. Sound plays in the preview |
| **Timeline** (bottom) | Lanes for video, voice (waveform), camera, overlays, labels on the UI, moods, sounds. Drag to move, drag the edges to resize, snap to other items, zoom/fit, split, duplicate, delete, lock, multi-select (Shift-click) |
| **Inspector** (right) | Start/end/length, position and size, every setting of the selected graphic (text, colour, variant…), entrance and exit animation, zoom region and motion, mood, sound volume. Shows who made it (AI or you) and **why** |
| **Assistant** (right) | Ask for an edit in plain English, or type a shortcut. You see the change as a draft first; **Apply** or **Discard**. Your playhead and selection are sent with the message, so “this zoom” works |
| **Review** (right) | The pipeline's own findings as a list: click to jump, “Fix with AI” sends it to the assistant |
| **Top bar** | Undo/redo, AI re-plan (keeps what you edited or locked), Render, link to the rendered video |

Keys: Space play, ← → one frame (Shift: one second), S split, [ ] start/end at the playhead, Del delete, Ctrl+D
duplicate, Ctrl+Z / Ctrl+Shift+Z undo/redo, L lock, +/- timeline zoom, / ask the assistant, Esc cancel.

Typed shortcuts for the assistant (instant, no AI model): `zoom 1:04 "Test Condition"`, `label 0:20 "main" as "entry point"`,
`title 0:10 "Loops"`, `big now "FOREVER"`, `sfx 0:20 whoosh` (also `rimshot`, `laugh`, `sad`…), `mood now shock`,
`remove b9v7`, `move b4cam1 to 25`, `nudge u2 -0.3`, `end u2 at 31`, `lock u2`.

## Elements: graphics the AI invents

*Elements* tab → describe it (“a small speedometer showing 78%”, “a pulsing wifi signal”), optionally **draw its area**, set start and length, **Design it**.
The model writes a *spec* (data: shapes, animation tracks, expressions, and the **settings it decides this element needs**), never code.
The spec is read by a safe renderer (`engine/src/element/`, no `eval`). Before you see it, code checks it: schema, every expression
evaluated at several times, node budget, “something moves”, no spinning text, text parameters resolve, and the rendered markup
changes over time. Failures go back to the model as a short report (3 tries, the big model on the last). It is told the region's size,
the footage colour under it (so it adds a backing plate on busy areas), nearby on-screen text and the numbers being said.
You get a draft to Apply or Discard. Afterwards the inspector shows its settings as sliders/colours/toggles, **Change it in words** refines it
(“thicker needle, make it red”), and **Save to my elements** keeps it in `library/elements/`. The chat does the same: “add a pulsing wifi signal here”.

**Models:** cloud free tier first (50 requests/day). If that fails, **Bonsai 2 27B** answers locally through PrismML's llama.cpp build.
Bonsai 2 is Qwen3.5-27B squeezed to ~1.4 bits per weight (5.9 GB, the file Ollama downloaded as `bonsai2-27b`); it sits wholly on the 8 GB GPU
(~7 GB used), generates ~40 tokens/s and loads in ~12 s. It only works on PrismML's build (stock llama.cpp and Ollama reject the file or give gibberish),
installed in `D:\llama-prism\bin` (release prism-b12128, CUDA 13.3, from github.com/PrismML-Eng/llama.cpp, SHA-256 checked). The studio server starts it by itself
the first time it is needed (log: `D:\ChumpsLabStudio\logs\llama-server.log`), on port 8089 (8080 is used by other software here). Ollama's `qwen3:8b` is the last resort.
Override with `CLS_LLAMA_DIR`, `CLS_LLAMA_MODEL`, `CLS_LLAMA_PORT`, `CLS_LOCAL_MODEL`. Which model answered is shown in the reply.

To run it by hand (your command, adapted: Bonsai is dense, so no MoE flags; thinking off; 16k context):

```
cd D:\llama-prism\bin
.\llama-server.exe --model "D:\Ollama\models\blobs\sha256-53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3" --alias bonsai2-27b --host 127.0.0.1 --port 8089 -c 16384 -b 1024 -ub 512 -np 1 -t 8 -ngl all --fit off -fa on -ctk q8_0 -ctv q8_0 -kvo --load-mode none --cache-ram 0 --spec-type none --jinja --reasoning off --temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.05
```

Tried and dropped: Gemma 4 26B-A4B (15 tokens/s, plainer drawings) and qwen3:8b (mostly empty or broken elements).

## How it is built

- `shared/ops.ts`: **the command layer**. Every change (a click, a drag, a shortcut, the AI) is a list of commands
  (`add_layer`, `add_zoom`, `set_time`, `set_box`, `set_props`, `set_style`, `split`, …) applied to the edit. Times are
  global seconds; the layer hides the engine's beat structure (a graphic crossing a beat boundary is re-homed or
  continued automatically).
- `server/main.ts`: holds the live document, applies commands, saves each change with a history record
  (`history/NNNNNN.patch.json`), keeps undo/redo, and **pushes every change to open editors** over `/api/events`.
- `server/assistant.ts`: plain English → commands. Typed shortcuts first; otherwise the fast vision model
  (`nemotron-3.5-super-vl:free`, 1-18 s). The model names *what* (item ids, on-screen text, a spoken word); code
  computes *when and where* from the transcript, OCR boxes and scroll/cut times, so AI edits land like planned ones.
- `src/`: React UI (Zustand store, `react-moveable` for on-canvas handles, `react-resizable-panels`,
  `@xzdarcy/react-timeline-editor` for the timeline, `lucide-react` icons).

## The AI uses the same editor

Anything the UI can do, an AI (or a script) can do over HTTP, and the open editor shows it live. Requests need the
header `X-Studio: 1` and a localhost origin.

| Call | Does |
|---|---|
| `POST /api/open {dir}` | open a project; returns the edit, transcript, revision |
| `GET /api/items?dir=` | every item with its id, type, start/end, text, who made it, locked |
| `GET /api/ops-schema` | JSON Schema of all commands (the tool definitions) |
| `POST /api/ops {dir, ops, author:"ai", dryRun?}` | apply commands (or preview with `dryRun`); returns a note per command |
| `POST /api/undo` / `/api/redo` `{dir}` | step history |
| `POST /api/assistant {dir, message, time, selection}` | plain English → commands (does not apply them) |
| `POST /api/library/add {dir, kind:"sfx"|"sticker"|"icon", id, at}` | add from the libraries |
| `POST /api/render {dir}` / `POST /api/replan {dir}` | render; AI re-plan |
| `GET /api/events` | live stream of changes and job logs |
| `GET /api/components` | JSON Schema of every component's settings |
| `GET /api/elements` / `POST /api/elements/design` `{dir, brief, region, time, duration}` / `/refine` / `/save` | the element designer: gallery, design, change in words, keep |

`node ../node_modules/tsx/dist/cli.mjs test/ask.mts "zoom 1:04 \"Test Condition\"" --apply` talks to the assistant from a terminal.
In the browser, `window.__studio.getState()` exposes the editor's state for scripts that drive the page.

## Not done yet

- Generated elements are flat vector drawings; the checks catch broken ones, not tasteless ones. The local model is slower (20-80 s) and plainer than the cloud one; cloud quality is untested while the daily quota is spent.

- Keystroke-synced typing sounds on footage; camera moves that cross a beat boundary stay clamped to one beat.
- The assistant doesn't look at the frame (only transcript, on-screen text and the edit); drawing a region sends its text, not pixels.
- No import UI for new footage (use `python -m cls_sidecar.ingest`), no multi-clip video editing (one recording per project).
- Locks and "edited by you" protect items from the AI re-plan; chat edits are marked as yours once applied.
