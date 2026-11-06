"""Quality assurance (blueprint §5.4).

Tier 1 — exact checks computed from the EDD itself (free): overlaps, safe area, clutter,
repetition, pacing. Tier 2 — Nemotron 3.5 Super VL reviews settled frames of the render, told
what each tile is supposed to show.
"""

from __future__ import annotations

import json
import statistics
import subprocess
from pathlib import Path
from typing import Literal

from PIL import Image
from pydantic import BaseModel

from cls_sidecar.gateway import SUPER_VL_FREE, OpenRouterGateway, image_part

SAFE = 5.0
FULL_FRAME = {"MemeCut"}


def _visible(edd: dict, t: float):
    for b in edd["beats"]:
        if not (b["start"] <= t < b["end"]):
            continue
        for l in b["layers"]:
            s = b["start"] + l["enter"]["at"]
            e = b["start"] + l["exit"]["at"] if "exit" in l else b["end"]
            if s <= t < e:
                yield b, l


def _inter(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
    return ix * iy


def geometry(edd: dict, reference_changes: list[float] | None = None) -> dict:
    issues: list[dict] = []
    seen: set = set()
    end = edd["beats"][-1]["end"]
    t = 0.0
    while t < end:
        vis = [(b, l) for b, l in _visible(edd, t) if l["space"] == "screen"]
        boxes = [l for _, l in vis if l["component"] not in FULL_FRAME]
        # Labels on the UI (stage space) can collide with each other too (C++ test: two pills at once).
        stage = [l for _, l in _visible(edd, t) if l["space"] == "stage"]
        for i in range(len(stage)):
            for j in range(i + 1, len(stage)):
                a, c = stage[i]["box"], stage[j]["box"]
                near = abs((a["y"] + a["h"] / 2) - (c["y"] + c["h"] / 2)) < max(a["h"], c["h"]) * 1.6
                if near and _inter({**a, "y": 0, "h": 1}, {**c, "y": 0, "h": 1}) > 0:
                    key = ("label_crowding", stage[i]["id"], stage[j]["id"])
                    if key not in seen:
                        seen.add(key)
                        issues.append({"type": "label_crowding", "t": round(t, 2), "layers": [stage[i]["id"], stage[j]["id"]], "severity": 2})
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, c = boxes[i]["box"], boxes[j]["box"]
                small = min(a["w"] * a["h"], c["w"] * c["h"])
                if small and _inter(a, c) / small > 0.15:
                    key = ("overlap", boxes[i]["id"], boxes[j]["id"])
                    if key not in seen:
                        seen.add(key)
                        issues.append({"type": "overlap", "t": round(t, 2), "layers": [boxes[i]["id"], boxes[j]["id"]], "severity": 2})
        if len(boxes) > 3 and ("clutter", round(t)) not in seen:
            seen.add(("clutter", round(t)))
            issues.append({"type": "clutter", "t": round(t, 2), "layers": [l["id"] for l in boxes], "severity": 1})
        for l in boxes:
            bx = l["box"]
            if (bx["x"] < SAFE or bx["y"] < SAFE - 2 or bx["x"] + bx["w"] > 100 - SAFE or bx["y"] + bx["h"] > 100 - SAFE + 2) and ("safe", l["id"]) not in seen:
                seen.add(("safe", l["id"]))
                issues.append({"type": "safe_area", "t": round(t, 2), "layers": [l["id"]], "severity": 1})
        t += 0.25

    # Repetition: three identical entrances in a row. Headers carried over from an earlier beat are the
    # same visual continuing, not new events, so they don't count for repetition or pacing.
    entrances = sorted(((b["start"] + l["enter"]["at"], l["enter"]["preset"], l["enter"]["direction"], l["id"])
                        for b in edd["beats"] for l in b["layers"]
                        if not str(l.get("meta", {}).get("reason", "")).startswith("continues header")))
    for k in range(2, len(entrances)):
        if entrances[k][1:3] == entrances[k - 1][1:3] == entrances[k - 2][1:3]:
            issues.append({"type": "repetition", "t": round(entrances[k][0], 2), "layers": [e[3] for e in entrances[k - 2:k + 1]], "severity": 1})

    # Pacing: our visual events (layer entrances + camera moves) vs the original edit.
    events = sorted([e[0] for e in entrances] + [b["start"] + c["at"] for b in edd["beats"] for c in b["camera"]])
    gaps = [b - a for a, b in zip([0.0] + events, events + [end]) if b - a > 0.05]
    pacing = {
        "events": len(events), "per_min": round(len(events) / end * 60, 1),
        "median_gap": round(statistics.median(gaps), 2) if gaps else None,
        "pct_gaps_gt_5s": round(100 * sum(g > 5 for g in gaps) / len(gaps), 1) if gaps else None,
    }
    if reference_changes is not None:
        rg = [b - a for a, b in zip([0.0] + reference_changes, reference_changes + [end]) if b - a > 0.05]
        pacing["reference"] = {"events": len(reference_changes), "per_min": round(len(reference_changes) / end * 60, 1),
                               "median_gap": round(statistics.median(rg), 2) if rg else None}
    return {"issues": issues, "pacing": pacing}


# ----------------------------------------------------------------------------- VL review

class TileIssue(BaseModel):
    tile: int
    element: str
    type: Literal["relevance", "readability", "composition", "clash_with_footage", "style", "other"]
    severity: Literal[1, 2, 3]
    observation: str
    suggestion: str


class TileVerdict(BaseModel):
    tile: int
    looks_good: bool


class SheetReview(BaseModel):
    tiles: list[TileVerdict]
    issues: list[TileIssue]
    overall: str


def settled_times(edd: dict, max_frames: int = 18) -> list[tuple[float, str]]:
    """One moment per layer, just after it finishes entering; plus each camera hold."""
    out = []
    for b in edd["beats"]:
        for l in b["layers"]:
            if str(l.get("meta", {}).get("reason", "")).startswith("continues header"):
                continue
            t = b["start"] + l["enter"]["at"] + l["enter"]["durationFrames"] / 30 + 0.3
            limit = b["start"] + l["exit"]["at"] if "exit" in l else b["end"]
            out.append((min(t, limit - 0.1), l["id"]))
        for i, c in enumerate(b["camera"]):
            out.append((b["start"] + c["at"] + c["inFrames"] / 30 + 0.3, f"{b['id']}cam{i + 1}"))
    out.sort()
    dedup = []
    for t, i in out:
        if not dedup or t - dedup[-1][0] > 0.4:
            dedup.append((t, i))
    return dedup[:max_frames]


def describe(edd: dict, t: float) -> str:
    parts = []
    for b in edd["beats"]:
        if b["start"] <= t < b["end"]:
            for c in b["camera"]:
                s = b["start"] + c["at"]
                if s <= t < s + c["inFrames"] / 30 + c["hold"]:
                    parts.append("camera zoomed in on a UI region")
    for _, l in _visible(edd, t):
        p = l["props"]
        what = p.get("text") or Path(str(p.get("src", ""))).stem or p.get("color")
        parts.append(f"{l['id']} {l['component']} '{what}'")
    return "; ".join(parts) or "no overlay"


TILE_W, TILE_H, COLS, PER_SHEET = 640, 360, 3, 6  # run 2 showed 480 px tiles are too small for reliable judgement


def contact_sheets(render: Path, times: list[tuple[float, str]], out_dir: Path, per_sheet: int = PER_SHEET) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tiles = []
    for k, (t, _) in enumerate(times):
        p = out_dir / f"tile_{k:02d}.png"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.3f}", "-i", str(render),
                        "-frames:v", "1", "-vf", f"scale={TILE_W}:{TILE_H}", str(p)], check=True)
        tiles.append(p)
    sheets = []
    rows = -(-per_sheet // COLS)
    for s in range(0, len(tiles), per_sheet):
        group = tiles[s:s + per_sheet]
        sheet = Image.new("RGB", (COLS * TILE_W + (COLS + 1) * 6, rows * TILE_H + (rows + 1) * 6), (255, 255, 255))
        for k, p in enumerate(group):
            sheet.paste(Image.open(p), (6 + (k % COLS) * (TILE_W + 6), 6 + (k // COLS) * (TILE_H + 6)))
        path = out_dir / f"sheet_{s // per_sheet + 1}.png"
        sheet.save(path)
        sheets.append(path)
    return sheets


def vl_review(gw: OpenRouterGateway, edd: dict, render: Path, out_dir: Path) -> tuple[list[dict], list[dict]]:
    from cls_sidecar.openrouter_check import strict_schema

    times = settled_times(edd)
    sheets = contact_sheets(render, times, out_dir)
    reviews, usage = [], []
    for si, sheet in enumerate(sheets):
        chunk = times[si * PER_SHEET:(si + 1) * PER_SHEET]
        listing = "\n".join(f"tile {k + 1} @ {t:.1f}s: {describe(edd, t)}" for k, (t, _) in enumerate(chunk))
        prompt = (
            f"You review motion graphics added to a tech YouTube video. This contact sheet has up to {PER_SHEET} frames "
            f"({COLS} columns, read row by row, tile 1 top-left). The base footage is a screen recording that ALREADY "
            "contains the creator's own overlays (logos, big words, a yellow step header).\n\n"
            "GROUND TRUTH: the renderer placed exactly these overlays in each tile. They ARE present; logos are "
            "white single-colour marks (e.g. GIMP's mascot, Tux, the Zorin 'Z'); never report them as missing:\n"
            f"{listing}\n\n"
            "Judge only HOW these overlays look: readability, composition, whether they cover the UI the narration "
            "is about, whether they clash with or duplicate the creator's own overlays, and relevance. For each tile "
            "say whether it looks good. List only concrete, visible issues with the tile, the element id, severity "
            "1-3 and a specific fix. If a tile is fine, list nothing for it."
        )
        msgs = [{"role": "user", "content": [{"type": "text", "text": prompt}, image_part(sheet, max_side=2000)]}]
        kw = dict(name="sheet_review", schema=strict_schema(SheetReview), max_tokens=6000, temperature=0.6)
        try:  # describing visible layout needs no long reasoning (run 2 spent ~4,300 reasoning tokens per sheet)
            data, raw = gw.json_schema_chat(SUPER_VL_FREE, msgs, reasoning={"enabled": False}, **kw)
        except Exception:  # noqa: BLE001 - endpoint may not accept disabling reasoning
            data, raw = gw.json_schema_chat(SUPER_VL_FREE, msgs, reasoning={"effort": "low"}, **kw)
        review = SheetReview.model_validate(data)
        for iss in review.issues:
            k = iss.tile - 1
            reviews.append({**iss.model_dump(), "sheet": si + 1, "t": round(chunk[k][0], 2) if 0 <= k < len(chunk) else None})
        usage.append({"sheet": si + 1, "tiles": len(chunk), "verdicts": [v.model_dump() for v in review.tiles], "overall": review.overall,
                      "usage": raw.get("usage", {})})
    return reviews, usage


def load_reference_changes(events_json: Path, offset: float, duration: float, threshold: float = 0.10) -> list[float]:
    ev = json.loads(events_json.read_text())
    return [t - offset for t, s in ev if s >= threshold and offset <= t < offset + duration]
