# Prototype N — first AI-planned edit (6 Nov 2026)

Input: the **finished** Linux video, 10:01–11:19 (78 s), as you chose: narration + footage that already contains your own overlays.
Output: `D:\ChumpsLabStudio\projects\proto-linux-1001\renders\edd-1080p-x264-veryfast-crf18.mp4`
Full machine report: `D:\ChumpsLabStudio\projects\proto-linux-1001\prototype_report.md`

```
uv run python -m cls_sidecar.prototype D:\ChumpsLabStudio\projects\proto-linux-1001
```

## What happened, in numbers

| Stage | Result |
|---|---|
| Transcription (Parakeet) | 277 words, 4 s |
| OCR of on-screen text (RapidOCR) | 427 text elements with positions and time spans, 100 s (CPU) |
| Planning (Nemotron 3 Ultra, free) | 9 beats, 16 visuals; 2 requests, 175 s; 18 k tokens in / 6 k out |
| Compile → EDD | 11 layers, 4 camera zooms, 5 logos matched (Linux, OpenAI, Zoom, GIMP, Photoshop), 1 visual dropped |
| Render | 2,340 frames at 1080p in 174 s (13.4 fps; the 30 fps footage proxy helped vs 12.5 fps in Phase 2) |
| QA | 2 geometry warnings (safe area); Super VL: 2 issues, both correct; 2 requests, 49 s |
| Total | 6 min 45 s, 4 free requests, $0 |

## Against the "done when" criteria

| Criterion | Result |
|---|---|
| One command from inputs to `edit.mp4` + `edd.json` | **Pass** |
| Every visual has a reason naming its word | **Pass** (e.g. "Show GIMP logo when 'GIMP' first spoken at word 90") |
| Pacing within ±25 % of your edit of the same section | **Fail.** Ours: 11.5 visuals/min, median gap 3.2 s. Your edit: 16.2 changes/min, median gap 1.2 s. The planner under-delivers on count |
| You rate ≥ 50 % of beats better/acceptable | **Waiting on you** |
| Same inputs → same video | **Pass for a given plan** (compile + render are deterministic, Phase 2). Re-planning gives a different plan, by nature |

## What worked (seen in the frames)

- **Contextual zooms**: into "Zorin Appearance" in the menu exactly when it's mentioned, and into the games list on "search games". This is the device closest to your style.
- **Step headers**: "1. Install an app", "2. Customize Zorin Appearance", small, yellow, top-left.
- **Logo pop-ins on the right words**: Tux on "Linux", OpenAI on "ChatGPT", GIMP's mascot and the Photoshop logo on "GIMP… Photoshop".
- Super VL's two findings were both real (see below), with no invented issues.

## What went wrong, and why

| Problem | Cause | Fix |
|---|---|---|
| A **Zoom** (video-call app) logo on "It Zoom has this software store" | Parakeet misheard "Zorin" as "Zoom"; the planner trusted it | Script alignment when a script exists; until then tell the planner ASR mishears names and to prefer names visible in OCR ("Zorin" was on screen) |
| "Linux-certified apps" and "Layout presets" labels **outline the wrong place** | The planner picked OCR elements that were on screen at a *different* time | Compiler must reject targets not visible at the visual's time (±0.5 s) and fall back to the same text visible then |
| Header disappears mid-step (Super VL caught it) | Layers live inside one beat; the next beat starts and the header goes | Persistent layers that span beats until the next header |
| "PRESETS" covers the layout thumbnails (Super VL caught it) | OCR sees text, not UI graphics, so the slot looked empty | Don't put kinetic captions over UI-dense shots; use VL feedback to move them |
| Zoom onto your own "Ps" logo; our title and logos doubling yours | Base footage is your finished edit; filtering your overlays from OCR wasn't strict enough | Heuristic filter (big, short, high-contrast text = overlay); goes away with raw footage |
| Too few visuals (11.5/min vs 16.2) | Planner treats the pacing target loosely | Give a per-beat count target (e.g. "10 s at standard ≈ 2–3 visuals") and have the compiler report shortfalls |

## Run 2 — after the fixes

Run 1 is archived in `D:\ChumpsLabStudio\projects\proto-linux-1001\runs\run1\`; run 2 is the current `renders\edd-1080p-x264-veryfast-crf18.mp4`.

Fixes applied: creator-overlay filter on OCR (13 of 427 elements flagged), names-on-screen + "ASR mishears names" in the planner prompt, per-beat minimum visual counts, OCR targets must be on screen at the visual's moment (with OCR-sampling tolerance), step headers persist across beats, placement penalises busy footage (edge density) and drops captions over dense UI, headers moved inside title-safe.

| | Run 1 | Run 2 |
|---|---|---|
| Wrong logo from a misheard name | "Zoom" logo | **none** (Zorin logo instead) |
| Labels outlining the wrong place | 2 of 2 | **0 of 3** ("Install GIMP or VLC" and "Zorin Appearance" outline exactly the right UI) |
| Zooms targeting your own overlays | 1 | **0** (rejected by the compiler) |
| Header vanishes mid-step | yes | **no** (carried across 6 beats) |
| Visual events / min (yours: 16.2) | 11.5 | 11.5 |
| Median gap (yours: 1.2 s) | 3.2 s | **2.4 s** |
| Planning time | 175 s | **53 s** (both Ultra calls first try) |
| Super VL issues that were real | 2 of 2 | **~1 of 6** |

### Still wrong in run 2

- **Invented step numbering** ("2. Post-Install Setup", "3. Install Apps…") clashes with your own "1. Install an app…" header in the footage. Headers should only number steps the narration numbers.
- **A pointless zoom** into the VMware title bar at 1 s ("Zorin_Test_2").
- **The "Home folder" label pill grows with the camera zoom.** Label pills should keep a fixed screen size while their outline follows the zoom.
- **The Zorin logo sits on the to-do text.** The to-do list fills the screen, so every slot is busy; a logo there should go smaller or be skipped.
- **Count is still short of target.** The planner was told minimums per beat but the compiler dropped one visual and two were headers. Next step: the compiler reports the shortfall back to the planner for one top-up request.
- **Super VL got less reliable.** It called GIMP's mascot "missing" twice when it was on screen (it read it as a "ghost"), invented a "Custonize" typo where our header overlapped your window title, and spent ~4,300 reasoning tokens per sheet. Causes: small 480 px tiles, your overlays cluttering the base footage, and long reasoning. Next: `reasoning: off` for listing, larger tiles, and the compiler's own element list as ground truth so the model only judges *how* things look, not *whether* they exist.

## Run 3 — after the second round of fixes

Archived in `runs\run3\`. Fixes: label pills keep a fixed screen size under zoom, numbering only when the narration numbers a step, no header stacked on your own, no window-chrome zooms, small corner logos on busy shots, an automatic pacing top-up request, and a review with ground truth, 640 px tiles and reasoning off.

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Visual events / min (yours 16.2) | 11.5 | 11.5 | **13.1** |
| Median gap (yours 1.2 s) | 3.2 s | 2.4 s | 4.2 s |
| Camera zooms | 4 | 3 | **7** |
| Labels on the right UI element | 0 / 2 | 3 / 3 | 2 / 3 ("Accent Color", "Zorin Appearance" right; "Jelly mode" outlines the row under your jelly clip) |
| Invented step numbers / duplicate headers | — | yes | **no** |
| Window-chrome zooms | 0 | 1 | **0** |
| Frame review time | 49 s | 102 s | **20 s** (reasoning off: 0 reasoning tokens) |
| Review complaints that were real | 2 / 2 | ~1 / 6 | ~3 / 13 |
| Planning time | 175 s | 53 s | 420 s (one 419 s call on an overloaded free endpoint) |

**Why I stopped iterating on this input.** Checking run 3's frames against its review, most remaining "problems" are *your* overlays in the finished footage (the Windows 11 image, the Rubik's cube, your Zorin logo, your colour chip) being attributed to ours, or our overlays doubling yours. The finished video can't tell the planner apart from your edit anymore. The next meaningful test needs raw recordings; with those, the overlay filter, duplicate checks and most review noise go away.

**Small fixes made after run 3** (no re-run): UI labels are now white pills (yellow belongs to step headers in your style), colour-chip labels use the spoken colour word instead of hex codes, and the optional top-up request has a real 240 s deadline (httpx's timeout only limits the gap between bytes).

## Second video — C++ (1:20–2:40)

To check the pipeline isn't tuned to one video, I ran it on your C++ video: code editors, a terminal and
documentation pages instead of a Linux desktop. Details and per-run tables:
[overnight-2026-11-06.md § C++ test](overnight-2026-11-06.md#c-test).

- Worked without prompt changes, after one planner fix: Ultra used its whole output budget on reasoning, so
  planning now caps reasoning tokens and retries once with reasoning off.
- It exposed a blind spot: dark-theme code doesn't look "busy" to an edge detector, so big words landed on
  code. Placement now measures OCR text coverage too, tries smaller spots, and turns a blocked big word into
  a quick punch-in on the matching on-screen text.
- Labels now stay inside the zoomed view, one at a time, on the side covering the least text; anything your
  footage already shows in big text is dropped.
- Labels now also respect *time*: they stay inside the target's likely on-screen window (OCR's 1.5 s
  sampling accounted for) and end when the footage under them scrolls or cuts (checked every 0.2 s).
- Before a zoom lands or a label pops, the target text is re-read by OCR on that exact frame; covered,
  closed or scrolled targets are dropped.
- The compiler measures free space for big words per beat and tells the pacing top-up; the planner then
  asks for zooms/labels instead of captions on code-filled screens.
- Super VL severity-3 issues 5 → 0; pacing 15.8 → ~12–13 events/min (fewer, cleaner visuals). Remaining
  complaints are almost all about your own overlays in the finished footage.

## Cost and reliability notes

- The free Ultra endpoint failed for ~25 minutes earlier tonight (HTTP 400, then 504 timeouts). The gateway now retries upstream errors reported inside HTTP 200 bodies; planning uses `reasoning: low`.
- The project now uses its own key from the git-ignored `.env` (`CLS_OPENROUTER_API_KEY`). It shares the same account-level free tier as the old key (50 requests/day).
