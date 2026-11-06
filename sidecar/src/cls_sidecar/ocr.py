"""On-screen text of the base footage, as zoom/label targets for the planner.

Samples the footage every `step` seconds, runs RapidOCR, and merges the same text at about the
same place across consecutive samples into one *element* with a time span. The planner refers to
elements by id; the compiler turns ids into rectangles (the LLM never invents coordinates).

Run:  uv run python -m cls_sidecar.ocr footage.mp4 --out ocr.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2

import cls_sidecar  # noqa: F401


def _rect_pct(box, w: int, h: int) -> dict:
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return {
        "x": round(100 * min(xs) / w, 2),
        "y": round(100 * min(ys) / h, 2),
        "w": round(100 * (max(xs) - min(xs)) / w, 2),
        "h": round(100 * (max(ys) - min(ys)) / h, 2),
    }


def _close(a: dict, b: dict, tol: float = 2.5) -> bool:
    return abs(a["x"] - b["x"]) < tol and abs(a["y"] - b["y"]) < tol and abs(a["w"] - b["w"]) < tol * 2


_ENGINE = None


def get_engine():
    """RapidOCR, created once per process. GPU is ~4x faster (0.64 vs 2.61 s per 1080p frame, measured);
    the CUDA DLLs must be preloaded first."""
    global _ENGINE
    if _ENGINE is None:
        import onnxruntime as ort
        from rapidocr import RapidOCR
        try:
            ort.preload_dlls()
            _ENGINE = RapidOCR(params={"EngineConfig.onnxruntime.use_cuda": True})
        except Exception:  # noqa: BLE001 - fall back to CPU
            _ENGINE = RapidOCR()
    return _ENGINE


def release_engine() -> None:
    """Free the engine (GPU + host memory) before a long render; this PC runs near its memory limit."""
    global _ENGINE
    _ENGINE = None
    import gc
    gc.collect()


def read_region(frame, rect: dict, margin: float = 1.5) -> str:
    """Text OCR reads inside `rect` (frame %, plus a margin) of one frame; small crops are upscaled."""
    h, w = frame.shape[:2]
    x0, y0 = int(max(0, rect["x"] - margin) / 100 * w), int(max(0, rect["y"] - margin) / 100 * h)
    x1, y1 = int(min(100, rect["x"] + rect["w"] + margin) / 100 * w), int(min(100, rect["y"] + rect["h"] + margin) / 100 * h)
    crop = frame[y0:max(y0 + 8, y1), x0:max(x0 + 8, x1)]
    if crop.shape[0] < 48:
        f = 48 / crop.shape[0]
        crop = cv2.resize(crop, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    r = get_engine()(crop)
    return " ".join(t.strip() for t in (r.txts or [])) if r.boxes is not None else ""


def locate(frame, text: str, min_ratio: float = 0.8) -> dict | None:
    """Where `text` really is on this exact frame (rect in frame %), or None if it isn't readable there.
    OCR samples every 1.5 s, and a scrolling page moves the text between samples."""
    import difflib
    h, w = frame.shape[:2]
    r = get_engine()(frame)
    if r.boxes is None:
        return None
    want = text.lower()
    best, score = None, 0.0
    for box, txt in zip(r.boxes, r.txts):
        t = txt.strip().lower()
        ratio = difflib.SequenceMatcher(None, t, want).ratio()
        if t in want or want in t:
            ratio = max(ratio, 0.85 if len(t) >= 4 else ratio)
        if ratio > score:
            best, score = box, ratio
    return _rect_pct(best, w, h) if best is not None and score >= min_ratio else None


def scan(video: Path, step: float = 1.5, min_score: float = 0.8, min_chars: int = 2) -> dict:
    engine = get_engine()
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = n_frames / fps
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    elements: list[dict] = []  # open and closed tracks
    t0 = time.perf_counter()
    samples = 0
    t = 0.0
    while t < duration:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, frame = cap.read()
        if not ok:
            break
        samples += 1
        r = engine(frame)
        found = []
        if r.boxes is not None:
            for box, txt, score in zip(r.boxes, r.txts, r.scores):
                txt = txt.strip()
                if score >= min_score and len(txt) >= min_chars:
                    found.append((txt, _rect_pct(box, w, h)))
        for txt, rect in found:
            match = next(
                (e for e in elements if e["text"] == txt and e["to"] >= t - step * 1.01 and _close(e["rect"], rect)),
                None,
            )
            if match:
                match["to"] = round(t, 2)
            else:
                elements.append({"id": f"o{len(elements)}", "text": txt, "rect": rect, "from": round(t, 2), "to": round(t, 2)})
        t += step
    cap.release()
    # An element seen at t is assumed visible until the next sample.
    for e in elements:
        e["to"] = round(min(duration, e["to"] + step), 2)
    return {
        "video": str(video), "width": w, "height": h, "duration": round(duration, 2), "step": step,
        "samples": samples, "seconds": round(time.perf_counter() - t0, 1), "elements": elements,
    }


def is_overlay(e: dict) -> bool:
    """Heuristic for text the *editor* added (kinetic words, logos, step headers) rather than the UI.

    UI text in a 1080p screen recording is 2-5 % of frame height; overlays are big and short, or
    pinned to the top edge like the yellow step headers.
    """
    r = e["rect"]
    return r["h"] >= 6.5 and (len(e["text"].split()) <= 3 or r["y"] < 8)


def elements_between(ocr: dict, start: float, end: float, limit: int = 40, include_overlays: bool = False) -> list[dict]:
    """UI text elements visible at some point in [start, end), largest first (likely titles/buttons)."""
    vis = [e for e in ocr["elements"] if e["from"] < end and e["to"] > start and (include_overlays or not is_overlay(e))]
    vis.sort(key=lambda e: -(e["rect"]["w"] * e["rect"]["h"]))
    return vis[:limit]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--step", type=float, default=1.5)
    args = ap.parse_args()
    result = scan(args.video, args.step)
    args.out.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{result['samples']} samples, {len(result['elements'])} text elements in {result['seconds']} s")


if __name__ == "__main__":
    main()
