# 1. Editing-style study

## 1.1 What I could and could not do

I cannot watch a video the way you do. What I did instead **[Measured]**:

1. Downloaded the five reference videos at 360p (video only) with `yt-dlp`.
2. Ran FFmpeg's scene-change detector over every frame and logged each change with its score.
3. Counted changes at three thresholds and computed the gaps between them.
4. Built 8-second contact sheets (2 frames per second) from four of them and examined them.

The script is in [evidence/cutrate.py](evidence/cutrate.py) and the raw numbers in [evidence/cut-rate-summary.json](evidence/cut-rate-summary.json).

**Caveat.** Scene-change scores are a proxy. A score ≥ 0.30 is almost always a hard cut or a full-frame replacement. 0.10–0.30 catches overlays popping in, big zooms and large text. Below 0.10 includes small motion, so it over-counts. A 1–2 s zoom can register as two or three events.

One correction to the brief: **UytYrhYLOKI** ("I discovered a sound that leaks your exact location") is from the channel **colsto**, not Chumps Lab, so I treat it as a reference video.

## 1.2 The numbers

| Video | Channel | Length | Hard cuts / min | Median gap between cuts | Visual changes / min | Median gap between changes | Gaps ≤ 2 s | Gaps > 5 s |
|---|---|---|---|---|---|---|---|---|
| Is Learning C++ Still Worth It in 2026 | **Chumps Lab** | 8:08 | 12.3 | 1.60 s | **61.6** | **0.32 s** | 84 % | 5 % |
| I Tried Linux… It Tried to Steal My Soul | **Chumps Lab** | 17:15 | 7.8 | 2.52 s | 24.9 | 1.20 s | 61 % | 16 % |
| China just dropped a new frontier model | Fireship | 6:25 | 13.1 | 3.02 s | 30.5 | 1.61 s | 58 % | 11 % |
| Noob with infinite queens VS best chess AI | bog | 20:32 | 2.0 | 6.72 s | 3.2 | 4.33 s | 24 % | 48 % |
| A sound that leaks your exact location | colsto | 29:12 | 7.7 | 4.45 s | 14.8 | 1.97 s | 52 % | 27 % |

"Visual changes" means scene score ≥ 0.10.

### What the numbers say

- **Your C++ video is the densest of the five, by a wide margin.** It is about 2× Fireship's change rate. Your Linux video is closer to Fireship's rhythm. These two are your own range, and the system should support both a *dense* and a *standard* pacing profile instead of a single "every 1–2 s" rule. (After review you chose the Linux video from 9:19 as the baseline; it is measured separately in §1.6.)
- **Fireship does not cut fast.** A hard cut comes every ~3 s, but something changes every ~1.6 s. The extra changes are additions inside a held composition.
- **bog's chess video is slow by these measures** (median 4.3 s between visual changes, half of all gaps above 5 s). Most of it is a chess board where pieces move: lots of meaningful change, little pixel change. The lesson is that the engagement in that kind of video comes from **the content moving** (gameplay, a board, a UI), so the editor must not pile overlays on top of footage that is already carrying the story.

These figures become the first **pacing targets** in the Quality Assurance stage (Section 5): for each pacing profile, the median gap between changes and the share of gaps over 5 s, measured on the render and compared with the target.

## 1.3 What the contact sheets show

### Your C++ video (from 1:35)

- **Base layer is a screen recording** of VS Code and a terminal.
- **Section titles**: large, bold, white, sans-serif words ("User Input") sliding in with a strong motion blur, placed in the lower-middle of the frame, over the footage, with no box behind them.
- **Tilted labels**: "Operators" is rotated about −30°, white with a dark outline, laid over a different clip (a YouTube course page). Tilt plus outline reads as energetic and handmade.
- **Perspective camera move**: the last frame shows the terminal rotated in 3D, i.e. a camera tilt, not just a scale.
- **Hard cuts between sources** (your editor → YouTube page → editor), on the beat of the narration.

### Your Linux video (from 4:00)

- Long holds on browser screen recordings (the Broadcom download flow), ~4–6 s each, where the narration carries the joke.
- A **full-screen meme card** ("A Few Moments Later") as the punchline: a recognisable cultural reference used as a time-skip transition.
- This is the *standard* pacing profile: the footage is the story, and memes are punctuation.

### Fireship (from 1:00)

- **A strict, limited palette**: black background, off-white document cards, one red and one orange accent. Condensed bold uppercase type for labels.
- **Document cards as evidence**: a screenshot of a source document, scaled into a white card, with **logos popping in at the corners** to say who is involved.
- **Progressive annotation**: a meme illustration where red bracket labels ("LEGITIMATE TRAINING PURPOSES", "EVIL CHINESE CORPORATE ESPIONAGE", "real stolen data") appear one at a time, each on a narration beat.
- **A diagram built from primitives**: red squares ("FAKE USER SWARM") appear in a scattered pattern, then an arrow labelled "PROMPTS" draws towards an orange "CLAUDE" box, while the source paragraph sits below with the key sentence **highlighted in orange**.
- The composition holds for 6–8 s, but it changes every 0.5–1.5 s because something is added.

### colsto

- A tool walkthrough (satellite map, then a spectrogram in a desktop app), with the cursor and selection boxes doing the work.

## 1.4 Principles to build into the system

These are the principles behind the techniques, as I read them. They drive the design of the motion system in Section 5.

1. **Accumulate, don't replace.** A beat is a canvas that collects layers on narration cues. A hard cut is a deliberate decision, for a topic change or a punchline.
2. **Every addition is tied to a word.** The label appears when its word is spoken, the highlight lands on the quoted sentence, the logo pops when the company is named. That is why word-level timestamps are a hard requirement.
3. **Evidence over decoration.** Screenshots of real sources, real logos, real UIs. Generated decoration is the exception.
4. **One accent colour per idea.** Fireship's red/orange, your white-on-footage. Restraint is what keeps it from looking AI-made.
5. **Motion has a grammar.** Titles slide with motion blur, labels pop, evidence cards scale in, diagrams draw on, memes hard-cut. The same element type keeps the same verb within a video, while the direction, timing and placement vary.
6. **The footage can be the story.** When the base layer already moves meaningfully (gameplay, a board, a terminal being typed into), overlays should get rarer, not denser.
7. **Jokes have timing.** The meme card, the "A Few Moments Later" skip, the zoom on a face: these land on a pause or on the end of a sentence, and they are short.

## 1.5 What should be measured next (Phase 2 task)

The study above is a first pass. To turn your style into data the planner can learn from:

1. Run the same analysis on **10–15 of your own videos**, plus their project files if you still have them (Premiere, DaVinci, CapCut). The project files tell us the *intent* behind each layer (zoom vs. overlay vs. text), which the pixels can't.
2. Add **audio-aligned measurement**: transcribe your narration, then measure how long after a keyword its visual appears. This gives us your real "lead/lag" timing.
3. Classify the change events (cut, overlay in, zoom, text, meme) with a small local VLM, and count your mix per minute.
4. Save the result as `style-profile.json`. It becomes a direct input to the planner (Section 5.3).

## 1.6 Baseline: Linux video from 9:19

You chose the second half of *I Tried Linux… It Tried to Steal My Soul* (9:19 to 17:15, 7 min 56 s) as the best-paced part and the baseline. I watched all of it at one frame per second (16 contact sheets, 476 frames) alongside YouTube's word-timed auto-captions **[Measured]**.

### Pacing compared with the opening

| Part | Hard cuts / min | Median gap between cuts | Visual changes / min | Median gap between changes | Gaps ≤ 2 s | Gaps > 5 s | Longest gap |
|---|---|---|---|---|---|---|---|
| 0:00–9:19 (opening) | 13.3 | 2.3 s | 35.6 | 1.03 s | 66 % | 10 % | 54 s |
| **9:19–17:15 (baseline)** | **1.4** | 16.4 s | **12.2** | **2.57 s** | 47 % | 33 % | 40 s |

Visual changes per minute through the baseline:

```
 9:19-10:19  14  ##############   recap of the install, rapid word illustrations
10:19-11:19  18  ##################  customisation tour: logos, colour chips, layout labels
11:19-12:19  15  ###############  GIMP + VS Code install
12:19-13:19  16  ################ drawing in GIMP, VS Code first run
13:19-14:19   7  #######          "what is a script": one long meme clip carries it
14:19-15:19   7  #######          nano / chmod walkthrough, the screen carries it
15:19-16:19   6  ######           running the script in VS Code and terminal
16:19-17:15  14  ##############   conclusion on a static desktop, then the outro clip
```

So the baseline is **not uniformly fast**: it runs at 14–18 changes/min when you're explaining or joking, and drops to 6–7/min when the screen recording itself is the content (typing commands, running a script). This matches principle 6 above, and the planner should copy that behaviour rather than hold a constant rate.

### What the visual changes are

| Device | Examples in the baseline | How it's done |
|---|---|---|
| **Literal word illustration** (the most frequent) | VMware logo on "VMware", Sisyphus on "stuck in the installer again", a RESTART button on "restarted", a no-Wi-Fi icon on "network issue", a haggling stock photo on "TCP and UDP haggling", thumbs-up on "resolved", Tux on "Linux", Zorin logo, GIMP's mascot, Photoshop logo, VS Code logo, a jelly on "jelly mode", a Rubik's cube on "desktop cube" | Centred, ~35–45 % of frame width, plain rectangle or transparent cut-out, no frame or shadow; on black or straight over the footage; on screen ~1–3 s |
| **Visual puns** | A Tata Nano car when the `nano` command appears | Same placement; the joke is in the choice of image |
| **Single-word kinetic captions** | "So / Was / First / Zorin / Installed" on black; "Ok / Now / trying / already" over the desktop | Big, bold, white, centred, no box; one word per beat of speech |
| **Zoom-and-hold into the UI** | The "Install Zorin OS" icon, a to-do item, the accent-colour row, the layout tiles, the font picker, a command in the terminal | Fast punch-in to the element being discussed, held for the whole explanation, sometimes with a slight perspective tilt |
| **Labels placed inside the UI** | "Windows 10", "Windows 11" and "This" written into Zorin's layout thumbnails; a blue/purple colour chip appearing as you say "blue", "purple" | The overlay is positioned on the UI element it explains, not in a generic spot |
| **Section header** | Yellow text "1. Install an app from the software center", top-left | Small, persistent while the step lasts |
| **Meme clip** | "Roll Safe"-style "thinking guy" clip with a nerd-emoji sticker while explaining what a script is (~15 s), with a red tint at its end | Full-frame video, tilted slightly; mood effect layered on top |
| **Outro clip** | Anime "bye-bye" clip, framed small on black | Ending gag |

### Timing relative to the words

Matching 12 keywords to the nearest visual change, the visual arrives a median **0.58 s *before*** its word (middle half of cases: 0.78 s before to 0.38 s after) **[Measured; small sample, and auto-caption times are only accurate to ~0.2 s]**. In practice: your visuals anticipate the word slightly, so the viewer sees the VMware logo just as they hear "VMware". The planner's default anchor becomes **word start − 0.5 s**, clamped so it never precedes the previous sentence.

### Where the baseline could be better (for the AI to improve on, not copy)

- **16:33–17:08**: the conclusion ("after all the failed installs, virtual machine issues, driver problems and way too much Googling…") plays over a static desktop for ~35 s. A quick recap montage of earlier moments (the failed installer, the no-Wi-Fi icon, the RESTART button) would fit your style and remove the longest dead stretch.
- **14:19–16:19**: the command walkthrough is fine at 6–7 changes/min, but the to-do list text is often small. A zoom on the exact command line, as you do elsewhere, would keep it readable at phone size.

### Profiles derived from this

| Profile | Use | Visual changes / min | Median gap | Gaps > 5 s | Source |
|---|---|---|---|---|---|
| `dense` | Intros, recaps, comedy runs | 35–60 | 0.3–1.0 s | ≤ 10 % | C++ video; Linux 0:00–9:19 |
| **`standard` (default)** | Explanation | **12–18** | **~2.5 s** | ≤ 35 % | Linux 9:19–end |
| `screen-carries` | Live typing, demos, gameplay | 5–8 | 5–8 s | allowed | Linux 13:19–16:19 |

The planner picks a profile per **beat**, not per video, using the beat's intent and how much the base footage is already moving.
