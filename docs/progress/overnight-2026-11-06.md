# Overnight work — 6 Nov 2026 (autonomous)

You asked me to keep going on my own while you slept. Everything below was built, run and checked
against rendered frames; nothing was committed (the folder isn't a git repository yet) and no paid API
was used.

## Summary

| Area | What now exists | Verified by |
|---|---|---|
| Prototype runs on your Linux video | 3 runs with fixes between them; archived in `D:\ChumpsLabStudio\projects\proto-linux-1001\runs\run1..3` | frame-by-frame checks, [prototype-N.md](prototype-N.md) |
| Second video (C++, 1:20–2:40) | Ingested; run 1 used the pipeline untouched, runs 2–3 fixed the placement problems it exposed | Super VL: severity-3 issues 5 → 0; see "C++ test" below |
| Ingest | `python -m cls_sidecar.ingest`: raw recordings + narration → project (30 fps proxy, shots, loudness, ASR, OCR) | ran on both videos |
| Technical components | CodeBlock, Terminal, BarChart, Gauge, NeuralNet (+ JetBrains Mono font) | rendered demo `D:\ChumpsLabStudio\projects\demo-tech`, frames inspected, two sizing bugs fixed |
| Planner knows them | New devices `terminal`, `code`, `neural_net`, `stat_chart`, `gauge` with **fact guards**: chart/gauge numbers must be spoken (digits or words), commands/code must be on screen or spoken, network diagrams only when the narration is about models | offline tests: 93 spoken ✓, 95 not spoken ✗, real command ✓, invented command ✗ |
| Desktop app v0 | `app/`: preview, timeline, inspector, locks, remove, props editor, undo/redo, history patches, render button, review notes | off-screen self-test: screenshots, saved patch, a full render from the app (27 s, exit 0) |
| Locks survive re-planning | `merge.py`: locked/your-edited layers, zooms, moods carried into a new AI plan; colliding AI items dropped | test: locked logo kept its hand-moved position and timing; user zoom kept |
| Loudness | Final mux normalises narration to −14 LUFS (YouTube) | output measured −14.4 LUFS, −1.1 dB true peak (input was −18.5) |
| Robustness | Gateway retries upstream errors hidden in HTTP 200s; optional requests have a real deadline; review runs with reasoning off (5 s per sheet instead of ~40 s) | runs 2–3 |

## C++ test

Input: your **finished** C++ video, 1:20–2:40 (80 s), ingested with
`python -m cls_sidecar.ingest proto-cpp-0120 …`. Nothing in the pipeline was tuned for it before run 1.
Project: `D:\ChumpsLabStudio\projects\proto-cpp-0120` (runs 1–6 archived in `runs\`, run 7 is current).

**First attempt failed, then fixed.** Ultra spent 19,878 of its 20,000 output tokens *thinking* and returned
no plan (`finish_reason=length`). Planning calls now cap reasoning with `reasoning.max_tokens` (6–8 k) and,
if the model still gives no tool call, retry once with reasoning off (`planner._ultra_tool`).

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| What changed | pipeline as-is | placement uses OCR text coverage, not just edge density; smaller caption spots; compact titles; label goes on the side that covers least text; blocked big words become quick zooms | + drop anything your footage already shows in big text; labels stay inside the zoomed view; one label at a time |
| Layers / zooms / moods | 14 / 7 / 1 | 11 / 8 / 1 | 9 / 8 / 1 |
| Visual events / min | 15.8 | 14.2 | 12.8 |
| Super VL issues (sev 3) | 18 (**5**) | not reviewed | 15 (**0**) |
| …of which not about our overlays | 0 | — | 2 (your diagonal "Variables"/"Operators"), 2 "no fix needed", 1 meme placeholder |
| Planning / render / review | 194 s / 176 s / 21 s | cached / 175 s / — | cached / 130 s (per-beat cache reused 46 %) / 21 s |

What run 1's frames showed and the fixes:

| Seen in run 1 | Why | Now |
|---|---|---|
| "GLIDING", "FUNDAMENTAL", "NIGHTMARE", "INFINITE" big words across the code editor | Dark-theme code has thin glyphs, so edge density at 480 px stayed under the "busy" threshold | `text_cover()` measures how much on-screen text a box would hide. Captions try 7 spots (incl. corners and a lower band). "NIGHTMARE" now sits in the editor's empty right side. With no clear spot, a big word becomes a **quick punch-in (0.17 s in, ~1 s hold) on the on-screen text the narration matches**, your contextual quick zoom, else it's dropped with a reason |
| "CONDITIONALS"/"LOOPS" full-width over the page | Titles always used one fixed band | Titles pick the band that covers least text, or a compact card |
| "Logic Flow" pill on the next code line, "Friend's Logic" on your yellow header | Pill was always placed below (or above) the target | Below / above / right / left, whichever covers least text |
| "First Win" placed outside the zoomed view (never visible) | Labels ignored the camera | Labels are placed inside the camera's view (pill size ÷ zoom). If the camera is about to look elsewhere, the label ends when it moves |
| Two label pills at once | Nothing prevented it | A new label ends the previous one |
| "IF ELSE" under your "What's Past If-else" card; "User Input" label under your big "User Input" | Footage is your finished edit | Visuals whose words your footage already shows in big text are dropped (`shown_big()`) |

### Runs 4–7: timing and pacing

Run 3's frames had two more problems, both about *when* a label is up rather than where:

| Seen | Why | Now |
|---|---|---|
| Linux: "Zorin Appearance" outlined an empty desktop, because the menu had closed 0.5 s earlier | OCR samples every 1.5 s, and an element's `to` is its last sighting **+ 1.5 s** | Labels live inside the target's likely visible window (midpoints of the sampling gaps). OCR pieces of the same text that were split by a misread character are chained back together first (`visible_span()`) |
| C++: "Ladder Logic" outlined the right paragraph, then the page scrolled and it framed a code comment | Scrolls between OCR samples are invisible to OCR | `stable_until()` compares the footage around the target every 0.2 s. Phase correlation catches the scroll shift; a large pixel change catches cuts. The label ends there, or is dropped if that leaves < 1 s |
| Linux run 6: two new zooms landed on rows that your jelly clip and Rubik's cube were covering at that moment | OCR saw the text 1 s before/after | **Re-read on the exact frame**: before a zoom lands or a label pops, the compiler OCRs a crop of that frame (GPU, ~0.1 s) and checks the target text is really there, trying +0.4 s and +0.8 s before giving up. On C++ it rejected 5 zooms/labels; every one I checked by eye was right (your "Variables" overlay over the terminal, a changed command, a scrolled paragraph, an editor line that had moved up 5 %) |
| Pacing top-up (run 4) asked for 4 more big words on code screens, all rejected again | The planner didn't know the screen had no room | The compiler measures **free space for big words per beat** (C++ beats 3/6/7: 0–18 %; Linux: 83–100 %), and the top-up prompt tells the planner to use zooms/labels there. Run 5's top-up obeyed: 0 captions in those beats, camera moves 8 → 10 |

Two rules tried tonight and **reverted**, because the frames proved them wrong:
- Holding a zoom only while its OCR element is visible dropped 8 good Linux zooms. OCR splits text too easily.
- Ending a zoom when the pixels under it change did the same. In a screen recording the zoomed region
  changes *because* of what the zoom is about: a menu opening, a search filling in.

Labels kept the stricter timing; zooms didn't.

When a zoom or label can't be placed because its target is covered, gone or scrolled, it now falls back
to a **quick zoom on readable on-screen text that matches the narration**, verified on the frame. On Linux
this turned the two covered zooms into zooms on "Jelly Mode" and "Desktop", the words being said at
that moment.

**Final state (run 8 on both videos, no AI requests left tonight for a Super VL pass):**

| | Linux: run 3 (start of night) | Linux: run 8 | C++: run 1 | C++: run 8 |
|---|---|---|---|---|
| Visual events / min | 13.1 | 11.5 | 15.8 | 9.0 |
| Layers / camera moves | 10 / 7 | 7 / 8 | 14 / 7 | 6 / 6 |
| Geometry issues | 0 | 0 | 0 | 0 |
| Labels/zooms whose target isn't really there at that moment | several (checked by eye) | **0**: every target is re-read on its frame | several (Super VL: 5 severity-3) | **0**: every target is re-read on its frame |
| Render (per-beat cache) | 162 s | 92 s | 176 s | 51 s |

**The pipeline generalised.** A second video with a different subject (code editors and docs pages
instead of a Linux desktop) worked without re-prompting. Every remaining complaint is either about your
own overlays, a semantic duplicate of them ("First Win" vs your "ACHIEVEMENT UNLOCKED", our small Python
logo next to your big one), or a title that still sits over a page with no free space. On raw
recordings those conflicts don't exist.

**Pacing honesty.** Linux is at 11.5 and C++ at 9.0 visual events/min, below the 16.2 target. Every
fix tonight traded a visual that would be wrong (covering code, doubling your overlay, outlining
something that's gone) for a gap. On this footage the gaps are mostly where *your* finished edit already
does something. On raw recordings the same rules should leave far more room. If pacing is still short
there, the levers are a second top-up round and labels that follow a scrolling page. (The "72.8/min" in
the C++ report counts your finished video's own cuts, overlays and transitions, so it isn't a target.)

## Raw footage + invented narration (evening, 6 Nov)

You pointed me at `E:\c++` (13 raw screen recordings, 1–26 min each) and told me to make up the audio.
Those clips carry sparse spoken narration of their own, so I **replaced** it: I took `6.loop.mp4`, 0–144 s,
looked at what happens on screen every 6 s (docs page → VS Code → for-loop syntax → flowchart → typing a
`while`), wrote a 14-line script in your voice ("Yeah. That's a nightmare.") timed to those moments, and
synthesised it offline with the Windows voice "David". The first real run of the pipeline on raw footage:
`D:\ChumpsLabStudio\projects
aw-loop-0150`.

New tool: `cls_sidecar/tts.py`. Script of timed lines → `narration.wav` + `timing.json` (a line that overruns
starts right after the previous one; 2 of 14 started < 1 s late). Parakeet transcribed the synthetic voice
correctly, so everything downstream ran unchanged.

| Run | What it showed | Fix |
|---|---|---|
| 1 | 8 visual events (3.3/min). The pacing top-up timed out on the free endpoint | rerun |
| 2 | 20 layers, but beats 7–9 (the last 35 s) had **nothing**: the planner covered beats 0–5 and the top-up only 0–6, while still listing 7–9 as short | pacing top-up runs up to **two rounds**; round 2 asks only for beats under half their target |
| 2 | "C++" logo was the plain letter C, and it popped twice | in a C++ tutorial "C" maps to the C++ logo; the same logo within 4 s is dropped |
| 2 | Three step headers drawn on top of each other (64–67 s); the last stayed up 40 s | a new header replaces the previous one; carried headers expire after 15 s |
| 3 | Headers sat on the browser tab bar; a header and a title said the same thing at the same moment | headers sit below the window chrome (y 9.5 %); a title in the same 2 s wins, in either order; headers vary their entrance |
| 4 (current) | 14 layers + 8 zooms, 22 events (9.2/min); geometry: 1 low-severity "repetition" note | |

Verified in the final frames: zooms land on the narrated text, the "int i = 1" label outlines the right
line, titles are readable. Still open: the C++ logo and the "OUTPUT" word are large over code/diagram for
~2 s, and the AI frame review keeps asking for backing strips behind titles. That is a style decision for
you; your own edits use outlined white text with no backing.

Tests: 14 now (`uv run --with pytest pytest tests -q` in `sidecar/`).
Pacing is still under your 16.2/min. Raw docs pages are dense, so the strict placement rules leave gaps.

## Round 2 (your feedback): timing, a real voice, sound effects, memes

**Your notes:** zoom-in is good but zoom-out is out of sync; placement is sometimes bad; same for pop-ups and
other motion graphics ("timing planning is the issue"); use a better TTS; add free SFX (whooshes, key clicks);
find a free meme library (image, video, audio).

### Timing: what was actually wrong

I measured the footage instead of guessing. The loop recording scrolls and switches windows about 30 times in
144 s. My cut detector found 2 of them, so zooms were placed on content that scrolled away or got cut mid-zoom,
and the zoom-out fired on a fixed timer. Overlays also stayed up for fixed lengths (1.2 / 1.6 / 2.2 s)
whatever was being said.

| Problem | Fix |
|---|---|
| Footage motion unknown | `footage.py`: samples the footage at 10 Hz (changed share of pixels + global shift by phase correlation) → a list of scrolls/cuts, cached in `analysis/motion.json` |
| Zoom landed during a scroll | A zoom waits for the footage to settle (≤ 1.2 s), else it's dropped or becomes a quick punch-in |
| Zoom aimed at where the text *was* | The target is re-located by OCR on the exact frame where the zoom lands (`ocr.locate`) |
| Zoom-out on a timer | Zoom-out starts when the narrated **clause** ends (punctuation or a pause), or 0.12 s before the next scroll/cut, whichever is first. Max hold 6 s. E.g. "never gets bored." out at 3.45 s, next scroll 3.7 s |
| Labels outlived their target | Label ends before the next scroll/cut and inside the target's visible window |
| Fixed overlay lengths | Exits follow speech: logo = word end + 0.6 s (1.4–2.6 s), kinetic word = word end + 0.2 s (0.9–1.6 s), title = clause end + 0.2 s (1.4–2.8 s), colour chip = word end + 0.9 s |
| Two zooms on the same code | The second is dropped if its view overlaps ≥ 60 % of a zoom still up |
| Same word planned twice ("HUNDRED" ×2, "i <= 5" ×2) | Same device + same words within 2.5 s → one |
| Top-up's beat numbers off by one | A visual belongs to the beat that contains its **anchor word**, not the model's `beat` number (16 visuals had been lost as "too close to beat end") |

### Voice

Kokoro-82M (Apache-2.0) runs locally on the CPU at ~3× real time; model files (350 MB) are in
`D:\ChumpsLabStudio\models\kokoro`. `cls_sidecar.tts` uses it by default (voice `am_michael`, speed 1.05);
`--engine sapi` keeps the Windows voice. The 14-line script lands on time (0 lines late). It reads "C++" as
"C plus plus", which the speech model transcribes as `C<unk>`; the planner now strips `<unk>`, and the C++ logo is
chosen when the screen says `.cpp` too.

### Sound effects (all CC0, ledger in `D:\ChumpsLabStudio\library\sfx\LICENSES.md`)

Eight OpenGameArt packs (Kenney's Interface and Sci-Fi sounds, qubodup's swishes and whooshes, Keyboard
Soundpack, RPG pack, …): 184 clips in 28 roles (`sfxlib.py`). Placement is in the compiler: quick swish on a
zoom-in, softer whoosh on the zoom-out, whoosh on titles, pops on logos and kinetic words, a select-click on
labels, impact/boom on moods, typing on our own Code/Terminal graphics, plus a paired sound on a meme. Same
sound role never stacks within 0.25 s, and a pick is deterministic per event so re-planning doesn't reshuffle it.
New in the EDD: `audio.sfx[]` (id, src, at, volume, role, meta). Mixed in the final step; the mix gets
the exact gain to -14 LUFS from a measuring pass, then a soft limiter.

Not done: key clicks synced to typing **in the footage**. I tried detecting keystrokes from pixels; scrolls and the
mouse cursor give the same signal (65 false "typing runs"), so I dropped it. Needs a different signal (the
recording's own keyboard audio, or an input log).

### Memes (image, video, audio)

The famous meme clips are almost all unlicensed copyrighted material, and a monetised channel can be claimed
over them, so I didn't bundle them. What is in `D:\ChumpsLabStudio\library\memes` (`memelib.py`, credits in
`CREDITS.md`):
- **30 animated reaction stickers** (💀 😭 🤯 🔥 🤡 🚨 …): Google's Animated Noto Emoji, CC BY 4.0, transparent WebP,
  played by a new `MemeSticker` component. A credit line is stored with each one.
- **7 comedic sounds**: Wilhelm-style scream (CC0), sad trombone (CC BY 4.0), rimshot (Kevin MacLeod, CC BY 3.0),
  laughter (CC BY 3.0), and CC0 level-up / alarm / applause from OpenGameArt. Each sticker has a paired sound.
- The planner is given the sticker list, so a planned meme is always one that exists; unmatched memes are dropped and
  listed under "memes missed" instead of showing a placeholder. Your own memes go in `library\memes\mine\`.

CC BY items need a credit in the video description: `library\memes\CREDITS.md` lists them (not generated into
the render yet).

### Result on the raw loop clip (`raw-loop-kokoro`, runs 1-4)

| | Before (SAPI voice, run 4) | Now |
|---|---|---|
| Visual events | 22 (9.2/min) | 22 (9.2/min) + **31 sound effects** |
| Zoom-outs | on a timer | on the clause end / before the next scroll |
| Overlap/duplicate geometry issues | 1 note | 0 |
| Output loudness | -14.4 LUFS | -15.2 LUFS, true peak -1.4 dBFS |

Pacing is still below your 16.2/min: the stricter rules drop anything that would land on a scroll or cover text.
Loudness is -15 rather than -14 because the limiter has to protect AAC overshoot; YouTube only turns louder
videos down, so it plays as is.

Tests: 18 (`uv run --with pytest pytest tests -q` in `sidecar/`).

## Other fixes made overnight


- **AI re-plan button**: the pipeline crashed at its very last line on a Windows console (printing "≥" in
  cp1252), which the app would have reported as a failed re-plan. stdout is now UTF-8, and the app also
  sets `PYTHONIOENCODING=utf-8` for the child process.
- **GPU OCR**: RapidOCR now runs on the RTX 5050 (needs `onnxruntime.preload_dlls()` first): 0.64 s per
  frame vs 2.61 s on CPU.
- **QA**: new `label_crowding` geometry check (two UI labels at the same height at once).
- **Tests**: `sidecar/tests/test_compiler.py`, 11 offline tests (no AI requests; two build small synthetic
  videos) for the fact guards, text coverage, caption fallback to a corner or a quick zoom, duplicate
  checks, labels inside the zoom, one label at a time, scroll detection and re-reading text on the frame. Run them with
  `uv run --with pytest pytest tests -q` in `sidecar/`.

## When you're back

1. **Watch the two renders**: `D:\ChumpsLabStudio\projects\proto-linux-1001\renders\edd-1080p-x264-veryfast-crf18.mp4`
   and the same path under `proto-cpp-0120`. Every visual's reason, and every dropped or converted one with
   its reason, is in each project's `prototype_report.md`. Or open either project in the app.
2. **Optional Super VL pass** on the final renders. The free quota reset at 05:30 IST; this uses 3 requests per
   project and doesn't re-plan:
   `uv run python -m cls_sidecar.prototype D:\ChumpsLabStudio\projects\proto-cpp-0120` (in `sidecar/`).
3. **The next real test needs raw recordings + the script** for one section. Finished videos have taught the
   pipeline what they can. Most remaining drops and complaints are your own overlays getting in the way.
4. **Your calls, not mine**: reboot once to shrink the pagefile that grew on C:, and decide whether to put
   this folder under git (nothing has been committed).
