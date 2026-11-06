"""Phase 0 check: both free Nemotron endpoints answer with valid structured output.

Uses 2 of the day's free-tier requests (plus one GET /key, which is not a model request).

Run:  uv run python -m cls_sidecar.openrouter_check --sheet path\\to\\contact_sheet.png [--transcript words.json]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

import cls_sidecar  # noqa: F401
from cls_sidecar.gateway import SUPER_VL_FREE, ULTRA_FREE, OpenRouterGateway, image_part

# A fallback narration snippet (Linux video, ~10:01) if no transcript is passed.
FALLBACK_TEXT = (
    "So, now we will be trying to explore Linux as we have already completed the installation part. "
    "First one was to install an app from the software center. Zorin has this software store and you can "
    "basically install all the Linux certified programs. What I'm going to try to install is GIMP, it is like "
    "the Photoshop for open source."
)

Device = Literal["word_illustration", "zoom_hold", "ui_label", "kinetic_caption", "visual_pun", "meme_clip", "none"]


class Visual(BaseModel):
    device: Device
    anchor_word: str
    description: str


class Beat(BaseModel):
    first_word: str
    last_word: str
    point: str
    visual: Visual


class BeatPlan(BaseModel):
    beats: list[Beat]


OverlayKind = Literal["logo", "photo", "text", "icon", "none", "other"]
Position = Literal["center", "left", "right", "top", "bottom", "full", "none"]


class Tile(BaseModel):
    tile: int
    overlay: str
    overlay_kind: OverlayKind
    position: Position


class SheetReview(BaseModel):
    tiles: list[Tile]
    summary: str


def strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic schema made 'strict-compatible': inline refs, no extra props, every prop required."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def fix(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return fix(defs[node["$ref"].split("/")[-1]])
            node = {k: fix(v) for k, v in node.items() if k != "title"}
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            return node
        if isinstance(node, list):
            return [fix(n) for n in node]
        return node

    return fix(schema)


def check_ultra(gw: OpenRouterGateway, text: str) -> dict:
    messages = [
        {"role": "system", "content": (
            "You plan edits for a faceless tech YouTube channel. The editor illustrates the exact word being "
            "spoken (logos, photos, icons), zooms into the UI element being discussed, places labels on that "
            "UI element, uses single-word kinetic captions and the occasional visual pun or meme. "
            "Split the narration into beats of one idea each and give each beat one visual decision.")},
        {"role": "user", "content": f"Narration:\n{text}"},
    ]
    args, raw = gw.call_tool_json(
        ULTRA_FREE, messages, name="submit_beat_plan", schema=strict_schema(BeatPlan),
        description="Submit the beat plan for this narration.",
        reasoning={"effort": "low"}, max_tokens=6000, temperature=0.6,
    )
    plan = BeatPlan.model_validate(args)
    return {"model": raw.get("model"), "provider": raw.get("provider"), "usage": raw.get("usage"),
            "valid": True, "beats": [b.model_dump() for b in plan.beats]}


def check_super_vl(gw: OpenRouterGateway, sheet: Path) -> dict:
    prompt = (
        "This image is a contact sheet from a YouTube video: 6 columns x 5 rows, one frame per second, "
        "read row by row, tile 1 is top-left. The base footage is a screen recording of the Zorin OS desktop. "
        "For tiles 1 to 12 only, report any overlay the video editor added on top of the screen recording "
        "(a logo, photo, icon or text). Do not describe the operating system's own UI. "
        "Use overlay_kind 'none' and position 'none' when a tile has no added overlay."
    )
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}, image_part(sheet)]}]
    data, raw = gw.json_schema_chat(
        SUPER_VL_FREE, messages, name="sheet_review", schema=strict_schema(SheetReview),
        reasoning={"effort": "low"}, max_tokens=6000, temperature=0.6,
    )
    review = SheetReview.model_validate(data)
    return {"model": raw.get("model"), "provider": raw.get("provider"), "usage": raw.get("usage"),
            "valid": True, "review": review.model_dump()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", type=Path, required=True, help="contact sheet PNG/JPG for the VL check")
    ap.add_argument("--transcript", type=Path, help="words.json from cls_sidecar.asr (uses its text)")
    args = ap.parse_args()

    text = FALLBACK_TEXT
    if args.transcript and args.transcript.exists():
        text = json.loads(args.transcript.read_text(encoding="utf-8"))["text"]

    gw = OpenRouterGateway()
    info = gw.key_info()
    limits = {k: info.get(k) for k in ("is_free_tier", "limit", "limit_remaining", "usage_daily")}
    limits["free_model_daily_requests"] = info.get("free_model_daily_requests")
    print("KEY LIMITS:", json.dumps(limits, indent=1))

    results = {}
    for name, fn in (("ultra", lambda: check_ultra(gw, text)), ("super_vl", lambda: check_super_vl(gw, args.sheet))):
        try:
            results[name] = fn()
        except Exception as exc:  # noqa: BLE001 - report each check separately
            results[name] = {"valid": False, "error": f"{type(exc).__name__}: {exc}"}
        print(f"\n=== {name}\n" + json.dumps(results[name], indent=1, ensure_ascii=False))

    passed = all(r.get("valid") for r in results.values())
    print("\nPHASE 0 OPENROUTER CHECK:", "PASS" if passed else "FAIL")


if __name__ == "__main__":
    main()
