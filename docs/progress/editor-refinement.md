# Editor refinement log

Goal: close the gap between this editor and a real NLE (Kdenlive, HyperFrames Studio) with the features that matter for tutorial editing. Each step is tested, committed and pushed.

## Gaps found (Kdenlive manual, HyperFrames catalogue)
Grouping/linking of clips, copy/paste, markers, ripple delete, track mute/lock, effect stacks with keyframes, more transitions (push, iris, whip-pan, zoom blur), speed ramps.

## Done
1. **Groups** (7 Nov 2026). `meta.group` tag on any item. Moving, duplicating, locking or deleting one member acts on the whole group; resizing an edge only touches that item. `group` / `ungroup` ops (the AI can use them too), `group` option on every `add_*` op. UI: Group / Ungroup buttons and Ctrl+G / Ctrl+Shift+G, selecting one member selects the group, link icon and shared colour stripe on grouped clips. **Zoom + spotlight** and **Zoom + highlight** tiles: one drag creates a zoom and its effect already linked. Tests: `app/test/ops.test.ts` (group section), two new browser checks in `e2e.mts`.
2. **Keyboard essentials.** Ctrl+C / Ctrl+V (paste so the earliest copied item lands on the playhead, spacing and groups kept), Ctrl+A select all, Alt+←/→ nudge by a frame (Alt+Shift: a second; a grouped item nudges its whole group). Two more browser checks.
