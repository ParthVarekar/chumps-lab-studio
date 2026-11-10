# Editor refinement log

Goal: close the gap between this editor and a real NLE (Kdenlive, HyperFrames Studio) with the features that matter for tutorial editing. Each step is tested, committed and pushed.

## Gaps found (Kdenlive manual, HyperFrames catalogue)
Grouping/linking of clips, copy/paste, markers, ripple delete, track mute/lock, effect stacks with keyframes, more transitions (push, iris, whip-pan, zoom blur), speed ramps.

## Done
1. **Groups** (7 Nov 2026). `meta.group` tag on any item. Moving, duplicating, locking or deleting one member acts on the whole group; resizing an edge only touches that item. `group` / `ungroup` ops (the AI can use them too), `group` option on every `add_*` op. UI: Group / Ungroup buttons and Ctrl+G / Ctrl+Shift+G, selecting one member selects the group, link icon and shared colour stripe on grouped clips. **Zoom + spotlight** and **Zoom + highlight** tiles: one drag creates a zoom and its effect already linked. Tests: `app/test/ops.test.ts` (group section), two new browser checks in `e2e.mts`.
2. **Keyboard essentials.** Ctrl+C / Ctrl+V (paste so the earliest copied item lands on the playhead, spacing and groups kept), Ctrl+A select all, Alt+←/→ nudge by a frame (Alt+Shift: a second; a grouped item nudges its whole group). Two more browser checks.
3. **Disable / enable** (E, or the toolbar button). `meta.disabled` keeps an item in the edit but removes it from the preview, the render and the sound mix; the clip is dimmed and struck through. Group-aware (`set_enabled` op, also available to the AI). Handy for A/B-ing a zoom or effect without deleting it.

## Next
Markers on the ruler, ripple delete, track mute, more transitions (push, iris, whip-pan, zoom blur), keyframed effect settings.
4. **Four more transitions** in the Transitions tab, one `Reveal` component: **Iris** (circle closes then opens), **Clock wipe**, **Slats** (staggered bars), **Whip blur** (fast sideways smear). Checked on real Remotion stills. Inspired by HyperFrames' transition catalogue (iris / radial / whip-pan families), re-done as plain CSS so they stay deterministic.
5. **Markers.** `markers` on the edit (never rendered). M drops one at the playhead, Shift+M removes the one under it, Ctrl+←/→ jumps between them; they show as a blue lane on the timeline, click to seek. `add_marker` / `remove_marker` ops (the AI can mark chapters too).
6. **Ripple delete** (Shift+Delete, or the Ripple button). Removes the selection (with its group) and slides every later, unlocked item left by the width of the hole; locked items and earlier items stay. Implemented once as `rippleOps()` in the command layer, so scripts and the AI can use it too. Unit-tested.
7. **The assistant knows the new commands.** `group`, `ungroup`, `set_enabled` and `add_marker` are chat tools ("turn off that zoom so I can compare, and put a marker at 1:04" works), and the item list it sees shows `group=` and `OFF`. `/api/items` reports `group` and `disabled` too.
8. **Lane mute.** Click a lane's name on the timeline to switch every item in it off (struck-through label), click again to bring them back. Built on `set_enabled`, group-aware.

## Next (not started)
Keyframed effect settings, speed changes / freeze frame, lane lock, marker rename and drag.

## Element engine v2 (10 Nov 2026)
9. **Motion language, staged entrances and 3D scenes.** openclicky (MIT) has no portable 2D/3D engine (it is a macOS Swift app; its 3D is a paid Tripo cloud client), so its *motion rules* were ported and the rest built here:
   - `engine/src/element/motion.ts`: its easing tokens (expo / quart / quint out, expo in, expo in-out), duration buckets, exits at 75 %. `ease()` and `smooth()` in formulas.
   - `appear: {at, kind, duration, until}` on any node (fade, rise, pop, draw, grow, drop, slide-left/right): staggered reveals for explainers.
   - `scene3d` node (`scene3d.tsx`): box, cylinder, cone, pyramid, sphere, plane, line (arrow), label; orbit camera; flat shading; drawn as SVG, auto-fitted to its viewport, no WebGL or new dependencies.
   - Five presets: Layer stack (3D), Spinning cube (3D), Bar chart (3D), Client-server-database (3D explainer), Three-step flow (explainer). Tests in `engine/test/element.test.ts`; `app/test/elsheet.mts` draws a contact sheet of any preset/spec over time.
   - **The AI designer now writes `scene3d` and `appear`** (prompt + worked examples); checked on "a 3D stack of three layers labelled App, API and Database" and "explain how a web request flows from the browser to a server and then to a database" (both valid on the first try, labels as asked). Still not done: 2D/3D/Explainer mode chips in the designer card.
10. **Big model: Inkling 2 Small (free)** replaces Nemotron 3 Ultra for the app's hard jobs (`BIG_MODEL`, override `CLS_BIG_MODEL`). OpenRouter's free endpoint refuses API clients intermittently (403 "only available on agentic harnesses"); a 403 is remembered and Nemotron 3 Ultra answers instead, then the local Bonsai. JSON wrapped in a code fence is unwrapped. The sidecar planner stays on Nemotron Ultra (a refused plan call would break the pipeline); `PLANNER_FREE` in `gateway.py` is the one line to change.
11. **Premiere Pro keymap and tools** (`app/src/shortcuts.ts`, one table that also drives the `?` help sheet). J/K/L shuttle (J plays backwards by stepping the playhead, L/J repeat for 2x, 4x), arrows frame / five frames, Up/Down to previous/next edit point, I/O/X marks with an In-Out band on the timeline, `;` Lift and `'` Extract (`rangeOps`), Ctrl+K add edit, C razor and V selection tool (buttons in the toolbar), A select forward, Q/W trims, Ctrl+X, Ctrl+Shift+A, Shift+M / Ctrl+Shift+M marker navigation, Ctrl+Alt+M delete marker, S snapping, `\` fit, Ctrl+S reassurance. Moved to match Premiere: S was split (now Ctrl+K), L was lock (now Ctrl+L, since L is shuttle), Shift+arrows is five frames. 12 more browser checks plus ops tests.
   **Not done:** multi-point keyframes (only start to end pose), speed / freeze frame, slip and slide tools, 3-point editing, multi-track targeting.
12. **Designer mode chips** (Auto / 2D / 3D / Explainer) on the Elements card steer the brief toward a flat graphic, a `scene3d`, or a staged explainer.
13. **Motion keyframes** (Inspector > Motion): any layer eases from where it is placed to an end pose (move x/y in % of the frame, scale, rotate, fade-to, ease) across its whole life; `set_motion` op (the AI can use it too). The animation span follows the layer when it is retimed, split or runs across beats. Checked on a real render (a word slides from left to right between 6.6 s, 8 s and 9.5 s).
14. **Assistant: `animate`.** "make the image here slowly zoom in 20% and fade away as it ends" becomes one `set_motion` (checked as a dry run). Known quirk: the model also added an unrequested end-time change in that run.
