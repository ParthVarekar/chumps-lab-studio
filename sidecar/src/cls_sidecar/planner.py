"""Semantic planning (blueprint §5.2 stage 3) with Nemotron 3 Ultra.

Pass 1 — beat sheet: split the narration into beats of one idea each.
Pass 2 — visual plan: per beat, which words get which visual device.

Both passes answer through one forced tool call (Ultra's free endpoint has no response_format).
Anchors are word indices and OCR element ids; the compiler turns them into times and rectangles.
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, Field

from cls_sidecar.gateway import ULTRA_FREE, OpenRouterGateway
from cls_sidecar.ocr import elements_between

# ----------------------------------------------------------------------------- schemas

Tone = Literal["neutral", "excited", "frustrated", "sad", "happy", "humorous"]
Pacing = Literal["dense", "standard", "screen-carries"]
Device = Literal[
    "word_illustration", "kinetic_caption", "title", "section_header", "zoom_hold", "ui_label",
    "color_chip", "meme", "mood", "terminal", "code", "neural_net", "stat_chart", "gauge",
]
MoodKind = Literal["anger", "sad", "happy", "shock", "confusion"]


class Stat(BaseModel):
    label: str
    value: float


class PlannedBeat(BaseModel):
    first_word: int = Field(description="index of the first word of this beat")
    intent: str = Field(description="what the viewer should understand, one sentence")
    pacing: Pacing
    tone: Tone


class BeatSheet(BaseModel):
    beats: list[PlannedBeat]


class PlannedVisual(BaseModel):
    beat: int = Field(description="index into the beat sheet")
    device: Device
    anchor_word: int = Field(description="index of the word this visual belongs to")
    end_word: int | None = Field(description="zoom_hold only: index of the last word to hold the zoom for")
    text: str | None = Field(description="kinetic_caption / title / section_header / ui_label / color_chip label / meme description")
    brand: str | None = Field(description="word_illustration: brand, product or software name whose logo to show")
    ocr_target: str | None = Field(description="zoom_hold / ui_label: id of the on-screen text element to target, e.g. 'o70'")
    color: str | None = Field(description="color_chip: CSS hex colour")
    mood: MoodKind | None = Field(description="mood only")
    code: str | None = Field(default=None, description="terminal: the command; code: the code snippet (newlines allowed)")
    stats: list[Stat] | None = Field(default=None, description="stat_chart: bars (only numbers SPOKEN in the narration); gauge: one item")
    max_value: float | None = Field(default=None, description="gauge: the scale maximum, e.g. 100 for a percentage")
    reason: str = Field(description="one sentence: why this visual, naming the word it illustrates")


class VisualPlan(BaseModel):
    visuals: list[PlannedVisual]


# ----------------------------------------------------------------------------- prompts

STYLE = """You plan edits for "Chumps Lab", a faceless tech YouTube channel. The base footage is a screen
recording. Your decisions become motion graphics placed on top of it.

How this editor works (measured from his best-paced footage):
- The most frequent device is a LITERAL WORD ILLUSTRATION: when a product, brand or concept is spoken,
  its logo pops in (VMware logo on "VMware", GIMP's logo on "GIMP"). Only real brands/software have logos.
- ZOOM-AND-HOLD into the exact UI element being talked about, held for the explanation.
- UI LABEL: a short label placed on the UI element it explains, with an outline around it.
- KINETIC CAPTION: a single key word as big type. Use sparingly (max ~1 per 10 s), only for emphasis.
- SECTION HEADER: small persistent step header, e.g. "1. Install an app", when a new step starts.
- TITLE: big title when a new topic starts (max 1 per 30 s).
- COLOR CHIP when a colour is named. MEME (max 1 per 45 s) on a punchline or a strong emotion: set text
  to exactly ONE id from the MEME LIBRARY at the end of this prompt. MOOD effects
  (anger/sad/happy/shock/confusion) at most once per 45 s, only when the tone clearly calls for it.
- Pacing "standard": 12-18 visual changes per minute. "screen-carries": 5-8 per minute when the
  screen recording itself is the content (typing, demos). "dense": 35+ per minute (intros, jokes).
- Every visual is tied to one spoken word. Never repeat the same device three times in a row.
- The footage is the FINISHED edit: it already contains the creator's own overlays (big single words,
  logos). Those are filtered out of the on-screen text lists; never illustrate what is already shown.
- The transcript comes from speech recognition and MISHEARS NAMES. If a spoken name looks odd or
  out of place, prefer the matching name in "names seen on screen" (e.g. transcript "Zoom" while the
  screen says "Zorin" means Zorin). Never put up a logo for a misheard word.
- ui_label and zoom_hold targets must be on screen AT the anchor word's time: check each element's
  [from-to] time span against the word's timestamp.
- TECHNICAL VISUALS (use when they explain better than a logo):
  terminal  - a command typed in a terminal, when a command is spoken or shown (put it in `code`).
  code      - a short code snippet (max ~10 lines) that is on screen or read out (put it in `code`).
  neural_net- an animated neural network, only when the narration is about AI models/networks/layers.
  stat_chart- animated bars comparing numbers, gauge - a speedometer for one value. NEVER invent numbers:
              every value must be spoken in the narration of that beat, or don't use these devices.
- Section headers name the step in a few words. Only number them ("1. ...") when the narration itself
  numbers the step ("first one", "step two"). Never zoom into window chrome (title bars, tabs, menus).
"""

RATE = {"standard": 15, "screen-carries": 7, "dense": 35}  # visual events per minute



def _meme_menu() -> str:
    """The reaction stickers that actually exist (licensed library), so a planned meme is always one we can show."""
    from cls_sidecar.memelib import MemeLib
    ms = MemeLib().catalog["memes"]
    if not ms:
        return "\n\nMEME LIBRARY: empty. Do not plan meme visuals."
    lines = [f"- {m['id']}: {' '.join(m['tags'][:6])}" for m in ms]
    header = "\n\nMEME LIBRARY (animated reaction stickers; for the meme device, text = one id below):\n"
    return header + "\n".join(lines)


STYLE = STYLE + _meme_menu()

def _names_on_screen(ocr: dict, start: float, end: float) -> str:
    names = set()
    for e in elements_between(ocr, start, end, limit=80):
        for tok in re.findall(r"\b[A-Z][A-Za-z0-9+#.-]{2,}\b", e["text"]):
            names.add(tok.strip(".-"))
    return ", ".join(sorted(names)[:40]) or "(none)"


def _words_block(words: list[dict]) -> str:
    return "\n".join(f"{i} {w['text']} @{w['start']:.2f}" for i, w in enumerate(words))


def _ocr_block(ocr: dict, start: float, end: float, limit: int = 30) -> str:
    rows = []
    for e in elements_between(ocr, start, end, limit):
        r = e["rect"]
        rows.append(f"  {e['id']} [{e['from']:.1f}-{e['to']:.1f}s] at ({r['x']:.0f},{r['y']:.0f}) size {r['w']:.0f}x{r['h']:.0f}%: {e['text'][:60]!r}")
    return "\n".join(rows) or "  (no readable text)"


def _ultra_tool(gw: OpenRouterGateway, messages: list[dict], name: str, model_cls: type[BaseModel], description: str,
                reasoning_budget: int, max_tokens: int) -> tuple[BaseModel, dict]:
    """One forced tool call to Ultra with a hard reasoning budget.

    Even at effort "low", Ultra once spent 19,878 of 20,000 output tokens reasoning and never produced the
    plan (C++ test). So reasoning gets an explicit token budget, and if the answer still runs out without a
    tool call, one retry runs with reasoning off.
    """
    from cls_sidecar.gateway import GatewayError
    from cls_sidecar.openrouter_check import strict_schema

    schema = strict_schema(model_cls)
    try:
        args, raw = gw.call_tool_json(ULTRA_FREE, messages, name=name, schema=schema, description=description,
                                      reasoning={"max_tokens": reasoning_budget}, max_tokens=max_tokens, temperature=0.6)
    except GatewayError as exc:
        if "no tool call" not in str(exc):
            raise
        args, raw = gw.call_tool_json(ULTRA_FREE, messages, name=name, schema=schema, description=description,
                                      reasoning={"enabled": False}, max_tokens=max_tokens, temperature=0.6)
    return model_cls.model_validate(args), raw


def plan_beats(gw: OpenRouterGateway, words: list[dict]) -> tuple[BeatSheet, dict]:
    messages = [
        {"role": "system", "content": STYLE},
        {"role": "user", "content": (
            "Narration, one word per line as `index word @start_seconds`:\n" + _words_block(words) +
            "\n\nSplit it into beats of one idea each (typically 5-15 s). Beat 0 starts at word 0. "
            "Give each beat's first word index, intent, pacing and tone.")},
    ]
    parsed, raw = _ultra_tool(gw, messages, "submit_beat_sheet", BeatSheet, "Submit the beat sheet.", reasoning_budget=6000, max_tokens=16000)
    sheet = parsed
    sheet.beats.sort(key=lambda b: b.first_word)
    sheet.beats[0].first_word = 0
    return sheet, raw


def plan_visuals(gw: OpenRouterGateway, words: list[dict], sheet: BeatSheet, ocr: dict) -> tuple[VisualPlan, dict]:
    parts = []
    for i, b in enumerate(sheet.beats):
        last = sheet.beats[i + 1].first_word - 1 if i + 1 < len(sheet.beats) else len(words) - 1
        start, end = words[b.first_word]["start"], words[last]["start"] + 0.5
        text = " ".join(w["text"] for w in words[b.first_word:last + 1])
        target = beat_target(end - start, b.pacing)
        parts.append(
            f"BEAT {i}: words {b.first_word}-{last} ({start:.1f}-{end:.1f}s), pacing {b.pacing}, tone {b.tone}\n"
            f"  plan AT LEAST {target} visuals for this beat (moods don't count)\n"
            f"  intent: {b.intent}\n  narration: {text}\n  names seen on screen: {_names_on_screen(ocr, start, end)}\n"
            f"  on-screen UI text elements visible during this beat:\n{_ocr_block(ocr, start, end)}"
        )
    messages = [
        {"role": "system", "content": STYLE},
        {"role": "user", "content": (
            "Narration words (`index word @start_seconds`):\n" + _words_block(words) + "\n\n" + "\n\n".join(parts) +
            "\n\nPlan the visuals for every beat. Hit each beat's pacing target. Use ocr_target only with an id "
            "listed for that beat. For word_illustration give the brand/software name (it is matched to a logo "
            "library). Give every visual a one-sentence reason naming its word.")},
    ]
    parsed, raw = _ultra_tool(gw, messages, "submit_visual_plan", VisualPlan, "Submit the visual plan.", reasoning_budget=8000, max_tokens=32000)
    return parsed, raw


def beat_target(duration_s: float, pacing: str) -> int:
    return max(1, round(duration_s * RATE[pacing] / 60))


def _room_line(room: float | None) -> str:
    """How much of the beat has free space for big words, as the compiler measured it on the footage."""
    if room is None:
        return ""
    if room < 0.25:
        return (f"  free space for big words/titles: {room:.0%} of the beat (the screen is full of code/text): do NOT add "
                "kinetic_caption or title here; use zoom_hold or ui_label on the on-screen text below, a logo, or a mood\n")
    return f"  free space for big words/titles: {room:.0%} of the beat\n"


def plan_topup(gw: OpenRouterGateway, words: list[dict], sheet: BeatSheet, ocr: dict,
               shortfalls: list[dict]) -> tuple[VisualPlan, dict]:
    """One extra request: more visuals for beats that came out short after compiling.

    `shortfalls` items: {beat, start, end, have, need, planned: [str], dropped: [str], room: float | None}.
    """
    parts = []
    for s in shortfalls:
        b = sheet.beats[s["beat"]]
        idx = [i for i, w in enumerate(words) if s["start"] <= w["start"] < s["end"]]
        text = " ".join(f"{i}:{words[i]['text']}" for i in idx)
        parts.append(
            f"BEAT {s['beat']} ({s['start']:.1f}-{s['end']:.1f}s, pacing {b.pacing}): has {s['have']} visuals, needs {s['need']}. "
            f"Add {s['need'] - s['have']}.\n  narration (index:word): {text}\n"
            f"  already planned: {'; '.join(s['planned']) or 'nothing'}\n"
            f"  rejected by the layout engine (don't repeat these): {'; '.join(s['dropped']) or 'none'}\n"
            f"{_room_line(s.get('room'))}"
            f"  names seen on screen: {_names_on_screen(ocr, s['start'], s['end'])}\n"
            f"  on-screen UI text elements:\n{_ocr_block(ocr, s['start'], s['end'])}"
        )
    messages = [
        {"role": "system", "content": STYLE},
        {"role": "user", "content": (
            "After layout, these beats have fewer visuals than their pacing needs. Plan ONLY the additional visuals "
            "(do not repeat existing ones; anchor them to different words than the planned ones; prefer word "
            "illustrations of real software/brands and zooms/labels on UI that is on screen at that word).\n\n"
            + "\n\n".join(parts))},
    ]
    parsed, raw = _ultra_tool(gw, messages, "submit_visual_plan", VisualPlan, "Submit the additional visuals.", reasoning_budget=8000, max_tokens=32000)
    return parsed, raw


def usage_of(raw: dict) -> dict:
    u = raw.get("usage", {})
    return {
        "prompt_tokens": u.get("prompt_tokens"), "completion_tokens": u.get("completion_tokens"),
        "reasoning_tokens": (u.get("completion_tokens_details") or {}).get("reasoning_tokens"),
    }


def dump(model: BaseModel) -> str:
    return json.dumps(model.model_dump(), indent=1, ensure_ascii=False)
