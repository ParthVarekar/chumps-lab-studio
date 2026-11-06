# 9. More effects, one-gesture placement, and AI-made elements

Status: BUILT 7 Nov 2026 (all of sections 1-3; checks in section 4 pass: `engine/test/element.test.ts`, `app/test/e2e.mts` 26 checks, real Remotion stills of effects and elements). Builds on the editor (`app/README.md`) and the command layer (`app/shared/ops.ts`).

You asked for (1) a fuller sidebar (effects, transitions, captions, sounds…), (2) the "draw the area and it happens" ease of
the zoom for everything else, and (3) **elements the AI invents on the spot**: a moving speedometer, a waving plant, a
pulsing wifi signal, each with its own settings, that look like they belong in the video.

## 1. Sidebar: what goes in it

A vertical rail of sections (the old row of tabs ran out of room):

| Section | Contents |
|---|---|
| **Add** | title, big word, step header, colour chip, lower third, step badge, code, terminal |
| **Effects** (drawn on a region) | highlight (box / ellipse / underline), spotlight (dim everything else), blur or censor, arrow, click ripple, zoom, label |
| **Transitions** (centred on the playhead) | flash, dip to black, colour wipe, glitch, zoom punch, shake, vignette, letterbox |
| **Captions** | one click: subtitle line, pop-word, karaoke highlight, from the transcript, whole video or a range |
| **Elements** | AI designer + a gallery of ready-made animated elements, each with settings |
| **Logos / Stickers / Sounds / Script** | as now |

## 2. One gesture to place anything

Every tile has a *placement*, and all placements share the zoom's interaction:

| Placement | Gesture | Examples |
|---|---|---|
| **region** | click the tile, drag a box on the preview (or drag the tile onto the preview: it drops a default box under the pointer) | highlight, spotlight, blur, element, label, zoom |
| **vector** | drag from where it starts to where it points | arrow |
| **point** | click or drop at a spot | sticker, logo, badge, ripple, title, lower third |
| **moment** | click once; centred on the playhead | flash, wipe, glitch, dip, punch, vignette, letterbox |
| **range** | pick whole video / from playhead / a selected word range | captions |

The thing appears at the playhead for a sensible default length, selected, with handles and timeline bar for refining.
Effects that sit on the UI are placed in the zoom-aware "on UI" space, so they follow the camera and the box you drew
maps correctly even when the view is zoomed.

## 3. AI-made elements: how it can be good, not just possible

**The model never writes code.** It writes a *scene spec*: a small declarative JSON format (below) that a safe renderer
draws. Research on LLM-authored animation (Choreo, Cleya, MoVer) points the same way: a bounded grammar the model hits
reliably, then *verify and correct*. MoVer measured 58.8 % correct first try and 93.6 % with verification feedback, so
the pipeline is generate → check → repair, not generate once.

### The spec (`ElementSpec`)

- `viewBox`, a list of **params** (key, label, type, min/max/step, default) that become sliders, colour pickers and
  toggles in the inspector, **designed by the model for that element**: a speedometer gets `value`, `max`, `needle
  speed`; a flickering tube gets `flicker rate`.
- A tree of **nodes**: `rect, circle, ellipse, line, path, polyline, polygon, text, group`, with whitelisted attributes
  (no scripts, links, styles or external files).
- **Animation tracks** on any node: `rotate, translateX/Y, scale, opacity, draw` (stroke draw-on), or any numeric
  attribute, with kinds `sin` (breathing, waving), `loop` (rotating, pulsing rings), `ramp` (needle sweeps to a value,
  with spring overshoot), `flicker`, `once`.
- **Expressions** instead of code: any value starting with `=` is a tiny arithmetic expression over params, the repeat
  index `i`, count `n` and time `t` (`+ - * / ( )`, `sin cos min max abs pow clamp`), evaluated by a hand-written
  parser (no `eval`), e.g. `=-120 + value/max*240`, `=cx + 40*cos(i*30)`. `repeat: {count}` generates ticks, bars, arcs.
- Colours are **theme tokens** (`accent`, `text`, `ink`, `muted`) or params, so an element picks up the video's look.

### Making it fit ("not out of touch")

The generator is given, besides the request:
1. **The look**: palette tokens, the outlined-white-text style, stroke widths, corner radii, easing used by the other graphics.
2. **The spot**: the region's size and aspect ratio, the **colours and brightness of the footage under it** (so it can
   choose light/dark ink and add a backing plate if contrast is low), and the nearby on-screen text.
3. **The context**: what is being said around that time and any number in it ("CPU at 78%" → speedometer `value` 78).
4. **Worked examples**: 3 preset elements of the house style.

Then checks run **before** you see it: schema; every expression evaluates without error at several times; nothing
draws outside its viewBox; something actually moves; text is readable at its size; colour contrast against the sampled
background; node budget. A failed check is sent back to the model as a short report, once or twice. Anything still
wrong is shown to you, not hidden.

### Your control

Draw a region on the preview, set start/end (defaults to the playhead + 3 s), say what you want: the element appears as
a **draft** (same preview-then-apply as other AI edits). Then:
- tweak its **params** with the generated controls (no AI needed),
- **refine** in words ("thicker needle, slower"): the model edits the spec, not redraws from nothing,
- **save** to "My elements" to reuse; saved and preset elements are the examples future requests learn from.

The chat can create elements too ("add a pulsing wifi signal here"), through the same generator.

## 4. Build order and checks

1. Engine: effect, transition and caption components; `ElementSpec` schema, expression parser, renderer; 12 presets.
2. Editor: sidebar rail, placement gestures (draw / drop), element inspector (generated controls, refine, save).
3. Server: generator (context, prompt, validation, repair), refine, save, assistant integration.
4. Verify: unit tests for the parser/renderer, schema fuzz (rejects unsafe specs), render a real frame of every preset,
   browser end-to-end for placement gestures and the element flow.

## 5. Honest limits

- A free model will sometimes produce an ugly or off-brief element. The checks catch broken ones, not tasteless ones;
  refine-by-chat and the params are the answer, and presets are the safety net.
- Elements are vector animations; photographic or 3D things (a realistic plant) are stylised, flat illustrations.
- Blur/censor uses the browser's backdrop filter; it is checked on a real render below.
- Design failures seen on the local model and what now catches them: a label inside a spinning group (error: move the text out), `"$$label"` for a text
  parameter (accepted when it names a real one), array indexing in expressions (told in the prompt, reported with the value written), nodes with no `origin`
  (now pivot on their own centre instead of the box corner). Cloud-model results are still unmeasured because the free quota ran out.
- Editor bugs the end-to-end run found and fixed on the way: the last pointer move of a fast drag was dropped (a drawn box came out 1/6 smaller), and opening a
  second project closed the first one's media server (the open editor lost its video).
- Local model: Bonsai 2 27B (PrismML llama.cpp) is now the first fallback: ~40 tokens/s, 26-67 s per element, mostly first-attempt valid. Rocket (body, window, fins, flame),
  waving plant, glowing wifi pulse, 78% speedometer with count-up and a 3-bar chart all came out recognisable. Gemma 4 26B was slower (15 tok/s) and plainer; qwen3:8b mostly broken.
- Checks added after looking at the local models' output: theme words held in colour settings now resolve (bars were invisible), bare formulas such as `211-60-i*80` are read
  as expressions in attributes and animation fields, shapes drawn mostly outside the viewBox are rejected (the chart brief now fails honestly after 3 tries instead
  of shipping a broken element), and a first attempt with fewer than 3 shapes gets one retry.
- Also added from Bonsai's output: a bounding-box check (bars hanging off the frame), a prompt rule against printing a setting's value on the graphic, and a bar-chart recipe in the prompt.
  A chart whose model ignores its own bar settings is a semantic slip no structural check sees; only a vision pass (not built) would catch it.
