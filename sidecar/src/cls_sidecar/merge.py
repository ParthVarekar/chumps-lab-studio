"""Keep the creator's decisions when the AI re-plans (blueprint §3.4: "lock a manually edited scene so
AI iterations do not overwrite it").

Layers, camera moves and moods that are locked or were edited by the user (meta.origin == "user") are
carried from the previous document into the new one, re-homed into whichever new beat contains their
time. AI-made items that collide with a kept item (same space, overlapping time and box) are dropped.
"""

from __future__ import annotations

import copy


def _keep(node: dict) -> bool:
    m = node.get("meta", {})
    return bool(m.get("locked")) or m.get("origin") == "user"


def _span(beat: dict, layer: dict) -> tuple[float, float]:
    s = beat["start"] + layer["enter"]["at"]
    e = beat["start"] + layer["exit"]["at"] if "exit" in layer else beat["end"]
    return s, e


def _boxes_overlap(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def _beat_at(edd: dict, t: float) -> dict:
    for b in edd["beats"]:
        if b["start"] <= t < b["end"]:
            return b
    return edd["beats"][-1]


def preserve_user_edits(old: dict | None, new: dict) -> tuple[dict, dict]:
    """Return (merged document, report). `old` may be None (first run)."""
    report = {"kept_layers": [], "kept_camera": 0, "kept_moods": 0, "dropped_ai": []}
    if not old:
        return new, report
    merged = copy.deepcopy(new)

    for ob in old["beats"]:
        for layer in ob["layers"]:
            if not _keep(layer) or str(layer.get("meta", {}).get("reason", "")).startswith("continues header"):
                continue
            s, e = _span(ob, layer)
            nb = _beat_at(merged, s)
            # Drop AI items this kept layer collides with.
            for b in merged["beats"]:
                keep = []
                for l in b["layers"]:
                    ls, le = _span(b, l)
                    clash = (not _keep(l) and l["space"] == layer["space"] and ls < e and s < le
                             and (_boxes_overlap(l["box"], layer["box"]) or l["component"] == layer["component"]))
                    if clash:
                        report["dropped_ai"].append(l["id"])
                    else:
                        keep.append(l)
                b["layers"] = keep
            moved = copy.deepcopy(layer)
            moved["enter"]["at"] = round(s - nb["start"], 3)
            if "exit" in moved:
                ex = ob["start"] + layer["exit"]["at"]
                if ex < nb["end"] - 0.05:
                    moved["exit"]["at"] = round(ex - nb["start"], 3)
                else:
                    del moved["exit"]
            if any(l["id"] == moved["id"] for l in nb["layers"]):
                moved["id"] = f"{moved['id']}-kept"
            nb["layers"].append(moved)
            report["kept_layers"].append(moved["id"])

        for kind in ("camera", "moods"):
            for item in ob.get(kind, []):
                if not _keep(item):
                    continue
                t = ob["start"] + item["at"]
                nb = _beat_at(merged, t)
                moved = copy.deepcopy(item)
                moved["at"] = round(t - nb["start"], 3)
                if kind == "camera":
                    # A kept zoom replaces AI zooms that start within its hold.
                    end = t + item["inFrames"] / 30 + item["hold"]
                    nb["camera"] = [c for c in nb["camera"] if _keep(c) or not (t - 0.5 < nb["start"] + c["at"] < end)]
                nb[kind].append(moved)
                report["kept_camera" if kind == "camera" else "kept_moods"] += 1
    return merged, report
