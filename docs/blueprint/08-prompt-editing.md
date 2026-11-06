# 8. Prompt-based editing (design)

Status: **M1-M5 built** (6 Nov 2026), in the new editor: see `app/README.md`. Done: command layer (M1), resolution of anchors, on-screen text, scroll/cut times (M2, in `server/assistant.ts`), assistant panel with draft preview, apply/discard, undo (M3), typed shortcuts + fast model (M4), fix tools: retarget by drawing, retime presets and inspector, review list with "Fix with AI" (M5). Not done: style rules / density / local fallback model (M6), swap gallery with alternatives, seeing the frame. Nothing here changes the EDD except `audio.sfx`.

**Goal.** You say what you want at a moment ("at 1:04 zoom into Test Condition and add a whoosh", "this zoom
comes out too late"), the AI does it, you see it before it lands, and you can undo it. The same mechanism
fixes mistakes in a video the AI already edited. It should feel faster than dragging clips, not like arguing
with a chatbot.

## 1. Principles

1. **Pointing beats describing.** Most of the effort in a prompt is saying *where*. Let the user point (click a
   clip, scrub to a time, draw a box on the preview) and have those become part of the prompt.
2. **The model chooses *what* and *which*; code computes *when* and *where*.** The model never writes seconds,
   coordinates or EDD JSON. It names items by id, words by text, targets by on-screen text. The compiler's
   existing rules (settle after a scroll, zoom out at the clause end, stay off text, fact guards, sound
   placement) do the rest. That keeps edits by prompt as good as edits by the planner.
3. **Preview before commit, undo as one step.** Because the preview is the Remotion Player running in the page,
   a proposed change can be shown **instantly, with no render**.
4. **A prompt is a decision, and decisions survive.** Items created or changed by a prompt are `origin: user`,
   so a later AI re-plan keeps them (`merge.py` already does this).
5. **Ask when unsure, with buttons.** A wrong guess costs more than a question.

## 2. What the probe showed

Four realistic requests, sent with a context pack (items near the time, words with timestamps, on-screen
text) to the fast vision model (`nemotron-3.5-super-vl:free`, reasoning off). Script: `evidence/ops_probe2.py`.

| | First schema (one flat op type, free-form fields) | Second schema (op per type, ids from a list, word anchors) |
|---|---|---|
| Latency | 3–12 s | **1–3 s** |
| "zoom into Test Condition + whoosh" | cut-off JSON | **correct** (zoom + whoosh, anchored on the word) |
| "remove the siren sticker, add a rimshot" | right ids garbled, junk in unused fields | **correct** remove + add (then asked an unnecessary question) |
| "make this part less boring" | invented an edit | **asked, with 3 clickable options** |
| "zoom comes out too late, end it at 'once'" | wrong | **wrong again** (added a zoom instead of retiming the existing one) |

Conclusions: (a) the fast model is quick enough for chat; the free planner (`ultra`, 1–10 min per call, 50
requests/day) is not, so it stays for batch work; (b) a **discriminated op schema with enumerated ids** is
what makes it reliable; (c) it still errs, so every op is validated and the user sees a preview; (d) the
"retime" failure shows we need the resolver (§4) to put the *existing zoom's id* in front of the model when a
request mentions "this/that zoom".

## 3. The loop

```
 you point + type ──► RESOLVE ──► PARSE ──► VALIDATE + COMPILE ──► DRAFT PREVIEW ──► ACCEPT ──► history
 (chips, @time, @item,   context   fast path   ops → EDD patch      Player shows the   one entry,   author=user
  @region, @word)        pack      or model    using the compiler    draft instantly    undo = 1 step  origin=user
```

- **Resolve** (code, no model): turn references into a *context pack*: items alive within ±6 s (with ids and
  reasons), words with timestamps, on-screen text at that time (OCR), footage motion (scroll/cut times), the
  current frame, which clips are selected. Ambiguity is detected here ("two zooms near 0:20") and becomes a
  question with buttons, not a guess.
- **Parse**: tiers in §6. Output is a list of typed ops (§5) plus a one-line reason each.
- **Validate + compile**: Zod/Pydantic check; intent ops go through the compiler (so placement rules apply);
  anything that can't be done says why ("'Test Condition' isn't readable on screen at 1:04; closest: 1:06").
- **Draft preview**: the proposed EDD is held in memory; the Player and timeline show it with the new clips
  tinted. Nothing is saved yet.
- **Accept**: one history entry (author = you, note = your prompt), per-op checkboxes beforehand, `Ctrl+Z` undoes the
  whole change.

## 4. How you point (ease of use is mostly here)

| You do | Becomes |
|---|---|
| Type `at 1:04` / `between 0:30 and 0:40` | a time or range |
| Playhead is somewhere | `@now` is implicit: "add a title here" |
| Click a clip, then type | `@item b4cam1`: "end this when I finish the sentence" |
| Select several clips | "make these quieter", "lock all of these" |
| Say a word: "when I say *infinite*" | `@word`, resolved to the nearest occurrence in the transcript |
| Draw a box on the preview | `@region` → target for a zoom or label (OCR finds the text under it; if none, the box itself) |
| Say what's on screen: "the Test Condition bullet" | resolved to an OCR element at that time |
| Press `/` | focus the prompt; `Enter` previews, `Ctrl+Enter` accepts |

Typed shortcuts for the common cases need no model at all (§6): `zoom 1:04 "Test Condition"`,
`sfx 0:20 whoosh`, `remove b9v7`, `nudge b4cam1 end +0.3`.

## 5. Operations (the contract)

Two kinds. **Intent ops** say what to achieve and go through the compiler; **raw ops** touch one property.
Times are anchors (`{word, near}`, `clause_end`, `seconds`), never numbers the model invents.

| Op | Example | Notes |
|---|---|---|
| `add_zoom` | zoom into "Test Condition" from the word *Test* to the end of the clause | uses motion settle, OCR relocate, clause-end zoom-out |
| `add_label` / `add_title` / `add_header` / `add_kinetic` | label the `i <= 5` line | same placement and duplicate rules as the planner |
| `add_logo` / `add_sticker` | skull sticker on "cooked" | only from the licensed libraries |
| `add_sfx` / `set_sfx` / `remove_sfx` | whoosh on the zoom, rimshot after the joke | by role; "swap" offers alternatives |
| `retime` | end this zoom at the end of the clause / `+0.3 s` | anchors or relative nudges |
| `move` / `resize` | put the label above the line; smaller | position presets (corners, above/below target) or a dragged box |
| `restyle` | slide instead of pop; hold longer; quieter | entrance preset, duration, colour, volume |
| `remove` | delete this | |
| `retarget` | zoom on the other bullet | click or `@region` |
| `density` | "less busy here" / "more energy here" over a range | bulk ops under a budget (events/min), listed for approval |
| `lock` / `unlock` | | |
| `ask` | "which zoom?" + 2–4 options | never applied |

Later: `set_transcript` (fix a misheard word, re-anchor what hangs on it), `set_voice_line` (re-voice a line).

## 6. Parsing tiers (speed and cost)

1. **Grammar fast path** (no model, instant, free): timestamp/word + verb + target for the ~15 most common
   requests. Expect this to cover well over half of real use.
2. **Fast vision model** (`super-vl`, 1–3 s, free): natural language → ops, given the context pack and, if you
   drew a region or ask about looks, the frame. Reasoning off, discriminated schema, ids from a list.
3. **Local fallback** (`qwen3:8b` via Ollama, already installed; fits the 8 GB GPU): works offline and when the
   free quota is gone. To be measured against tier 2 before we trust it.
4. **Big planner** (`ultra`, minutes): only for batch asks: "re-edit 0:30–1:10 with more energy". Runs in the
   background; the result arrives as a change set like any other.

Every tier outputs the same ops, so the rest of the system doesn't care which produced them. A validation
failure is sent back to the model once with the error text (repair loop) before asking you.

## 7. Fixing mistakes in an edited video

What goes wrong, and the fastest fix for each:

| Mistake | Quick fix |
|---|---|
| Effect at the wrong time | click it → `retime` presets: "snap to word / clause end / next cut", ±0.1 s nudges; or just say it |
| Zoom on the wrong thing | `retarget`: click the right thing on the preview |
| Overlay covers something | "avoid the text" re-runs placement; or drag; or "move to top-right" |
| Wrong logo, meme or sound | "swap": a small gallery of the next-best matches, audition before choosing |
| Too busy / too sparse | `density` over a range |
| Misheard word → wrong logo | fix the transcript word; dependents re-anchor |
| Anything else | select it, say what's wrong; "why is this here?" answers from `meta.reason` |

**Review mode.** The QA findings we already produce (geometry checks, Super VL notes with a suggested fix) become
a list on the right. Each is clickable (jumps to the frame) and has **"Apply suggested fix"** as a preview-then-
accept change. "Scan 0:30–1:10 for problems" runs the checks on a range.

**Videos not made here.** A rendered video from elsewhere has overlays baked into the pixels, so edits to
*those* aren't non-destructive. Two honest options: re-ingest the raw recording (everything stays editable;
their overlays are recognised and kept out of the way), or add layers on top (cover patches, labels), clearly
marked as such. Edits to videos made in this studio are always fully non-destructive.

## 8. Architecture

- The placement logic is Python (compiler, OCR, motion, SFX/meme libraries). Don't port it: run the sidecar as a
  **long-lived local service** (loopback HTTP, started with the app). OCR stays warm, so locating a target on a
  frame takes ~0.1 s instead of 10 s of cold start.
- New sidecar endpoints: `POST /resolve` (references → context pack), `POST /parse` (prompt + pack → ops),
  `POST /compile` (ops → EDD patch with reasons and rejected-op explanations), `GET /alternatives` (swap gallery).
- The app (browser or Electron) already has `commit()`, history patches, undo and the Player. New: an Assistant
  panel (chat, chips, change-set card), draft-EDD state, ghost tinting on the timeline, issue list.
- Data: `meta.prompt` on items made by a prompt (what you said); `history/*.patch.json` already records author and
  note; `conversation.jsonl` per project; `style_rules.json` for standing preferences ("zoom out a bit earlier",
  "never use the clown sticker") that the compiler and planner read on every re-plan.

## 9. Milestones

| | What | Done when |
|---|---|---|
| M1 | Ops schema (Zod + Pydantic, one source), `compile` endpoint, sidecar as a service | the 10 sample ops in §5 turn into the same edits as the planner would make (golden tests); a bad op returns a reason |
| M2 | Resolver + context pack | on 20 hand-written references ("the zoom at 0:20", "when I say once") the right item/word is found ≥ 95 %; ambiguity is reported, not guessed |
| M3 | Assistant panel, draft preview, change-set card, unit undo | a typed op previews in < 300 ms, accept/undo round-trips through history; prompts survive a re-plan |
| M4 | Grammar fast path + fast-model parser (+ repair loop) | eval set of 40 prompts (incl. vague and ambiguous ones): ≥ 85 % correct ops or a sensible `ask`; median 2 s |
| M5 | Fix tools: retime presets, retarget by click, swap gallery, review list with apply-fix | the errors found in the C++ and Linux runs can each be fixed in ≤ 2 interactions |
| M6 | Style rules, density, region pointing, local fallback model | a standing preference changes a re-plan; offline parse works |

## 10. Decisions for you (my default first)

1. **Where it lives:** an Assistant panel next to the inspector with click-to-reference chips (default) vs a
   command bar only.
2. **Apply behaviour:** always preview and confirm (default; one key to accept) vs auto-apply small edits and
   rely on undo. Can be a setting.
3. **Models:** fast vision model for chat, big planner for batch, local model as fallback (default) vs local-only.
4. **Scope of "already edited videos":** videos made in this studio, fully editable (default); imported rendered
   videos only through the limited cover-patch route.
5. **Order:** M1→M3 first (ops, resolver, panel with typed shortcuts), then natural language (M4), so you can start
   using precise edits while the language layer is tuned (default) vs language first.

## 11. Risks

- **Wrong guess applied silently.** Mitigated by preview-before-commit, ids from lists, validation, and `ask`.
- **Free-tier limits.** Tier 1 costs nothing; tier 2 is ~1 request per chat turn (50/day shared with planning).
  Mitigation: grammar first, local fallback, a counter in the UI.
- **Anchors that don't resolve** (misheard words). The resolver shows candidates and lets you click the right
  word on a transcript strip.
- **Long conversations drifting.** Each turn gets a fresh context pack from the current EDD, not chat history;
  history is only used for "undo that" and "same but quieter".
