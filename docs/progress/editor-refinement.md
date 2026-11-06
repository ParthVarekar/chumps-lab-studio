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
