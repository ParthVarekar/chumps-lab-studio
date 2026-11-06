"""When does the footage move? (scrolls, window switches, cuts)

Zooms, labels and other effects that point at a spot on screen only make sense while that spot holds
still. Raw screen recordings are full of scrolls and jump cuts that a scene-change threshold of 0.3
misses (the C++ loop clip has ~20 of them and 2 were detected), so this measures the footage at 10 Hz:
the share of pixels that changed since the previous sample, and the global shift (phase correlation,
which catches a slow scroll of thin text that changes few pixels).

    Motion(project).next_start(t)   → when the footage next starts moving after t
    Motion(project).moving_at(t)    → the (start, end) of the movement t falls in, or None
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

STEP = 3            # frames between samples (10 Hz at 30 fps)
CHANGED = 0.04      # share of pixels that changed → moving
SHIFT = 1.5         # px (at 320 wide) of global shift with a clear correlation → scrolling
MERGE_GAP = 0.35    # movements closer than this are one
MAJOR = 0.10        # peak changed-share of a cut / window switch (vs a scroll or a menu)


def analyse(video: Path) -> list[list[float]]:
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    prev, rows = None, []
    for f in range(0, n, STEP):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, frame = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY)
        if prev is not None:
            chg = float((np.abs(g.astype(np.int16) - prev.astype(np.int16)) > 25).mean())
            (dx, dy), resp = cv2.phaseCorrelate(prev.astype(np.float32), g.astype(np.float32))
            rows.append([round(f / fps, 2), round(chg, 3), round(float(np.hypot(dx, dy)), 1), round(float(resp), 2)])
        prev = g
    cap.release()
    return rows


def segments(rows: list[list[float]]) -> list[list[float]]:
    """[[start, end, peak_changed_share], …]; a sample's change happened in the 0.1 s before its timestamp."""
    dt = STEP / 30
    out: list[list[float]] = []
    for t, chg, shift, resp in rows:
        if chg > CHANGED or (shift >= SHIFT and resp > 0.1):
            if out and t - dt - out[-1][1] <= MERGE_GAP:
                out[-1][1] = t
                out[-1][2] = max(out[-1][2], chg)
            else:
                out.append([round(t - dt, 2), t, chg])
    return out


class Motion:
    def __init__(self, project: Path):
        cache = project / "analysis" / "motion.json"
        if cache.exists():
            rows = json.loads(cache.read_text(encoding="utf-8"))
        else:
            rows = analyse(project / "media" / "footage.mp4")
            cache.parent.mkdir(exist_ok=True)
            cache.write_text(json.dumps(rows), encoding="utf-8")
        self.segs = segments(rows)

    def moving_at(self, t: float, pad: float = 0.0) -> tuple[float, float] | None:
        for a, b, _ in self.segs:
            if a - pad <= t <= b + pad:
                return a, b
        return None

    def next_start(self, t: float, min_peak: float = 0.0) -> float | None:
        """Start of the first movement after t (a movement already under way at t doesn't count)."""
        for a, _, peak in self.segs:
            if a > t and peak >= min_peak:
                return a
        return None

    def next_cut(self, t: float) -> float | None:
        return self.next_start(t, MAJOR)
