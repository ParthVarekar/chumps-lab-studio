"""Plan → EDD (blueprint §5.2 stage 5). Deterministic: same plan, same document.

The LLM chose *what* and *when* (devices anchored to word indices, OCR targets by id); this module
decides *where* and *how*: boxes, slots, entrance presets, camera rectangles, exits.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from cls_sidecar.footage import Motion
from cls_sidecar.memelib import MemeLib
from cls_sidecar.ocr import is_overlay, locate, read_region
from cls_sidecar.planner import BeatSheet, PlannedVisual, VisualPlan
from cls_sidecar.sfxlib import Sfx

SAFE_PCT = 5.5  # keep graphics this far from the frame edge (qa.SAFE is 5)
LEAD = 0.5  # measured: visuals land ~0.5 s before their word
COMPONENT_LIBRARY = "cls-motion@0.2.0"
ICONS_JSON = Path(__file__).resolve().parents[3] / "node_modules" / "@iconify-json" / "simple-icons" / "icons.json"

# Slots for logos/photos (x, y, w, h in frame %). 16% × 28.44% is square at 16:9.
LOGO_SLOTS = {
    "center": (42, 30, 16, 28.44), "left": (8, 34, 16, 28.44), "right": (76, 34, 16, 28.44),
    "top-left": (6, 8, 14, 24.9), "top-right": (80, 8, 14, 24.9),
    "bottom-left": (6, 64, 14, 24.9), "bottom-right": (80, 64, 14, 24.9),
}
SLOT_DIRECTION = {"center": "center", "left": "left", "right": "right", "top-left": "left", "top-right": "right",
                  "bottom-left": "left", "bottom-right": "right"}
SMALL_LOGO_SLOTS = {
    "top-right": (85, 8, 9, 16), "top-left": (6, 14, 9, 16), "bottom-right": (85, 74, 9, 16), "bottom-left": (6, 74, 9, 16),
}
CAPTION_SLOTS = {"middle": (12, 38, 76, 24), "lower": (12, 64, 76, 20), "upper": (12, 12, 76, 20),
                 # Smaller fallbacks for frames full of code/text (C++ test: big words kept covering the editor).
                 "lower-band": (16, 78, 68, 12), "corner-br": (56, 74, 38, 14), "corner-bl": (6, 74, 38, 14),
                 "corner-tr": (56, 10, 38, 14)}
CAPTION_PREFER = ["middle", "lower", "upper", "lower-band", "corner-br", "corner-bl", "corner-tr"]
TITLE_SLOTS = {"middle": (8, 38, 84, 22), "upper": (8, 10, 84, 18), "lower": (8, 70, 84, 18), "compact": (22, 42, 56, 13)}
# A box may cover at most this share of on-screen text, and this much edge density (UI graphics OCR can't read).
MAX_TEXT_COVER, MAX_BUSY = 0.08, 0.10

BRAND_ALIASES = {"photoshop": "adobephotoshop", "vscode": "visualstudiocode", "visualstudio": "visualstudiocode",
                 "chatgpt": "openai", "gpt": "openai", "zorinos": "zorin", "windows11": "windows", "windows10": "windows",
                 "premiere": "adobepremierepro", "aftereffects": "adobeaftereffects", "illustrator": "adobeillustrator"}


_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _number_words(n: int) -> str:
    """0–999 as words, the way the speech-to-text writes them ("ninety three", "two hundred ten")."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    rest = n % 100
    return _ONES[n // 100] + " hundred" + ("" if rest == 0 else " " + _number_words(rest))


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


@dataclass
class Compiled:
    edd: dict
    asset_hits: list[dict] = field(default_factory=list)
    asset_misses: list[dict] = field(default_factory=list)
    dropped: list[dict] = field(default_factory=list)
    retargeted: list[dict] = field(default_factory=list)
    converted: list[dict] = field(default_factory=list)  # big words turned into quick zooms
    memes_missed: list[dict] = field(default_factory=list)  # planned memes with nothing licensed to show
    sfx_count: dict[str, int] = field(default_factory=dict)  # role → how many placed
    room: dict[int, float] = field(default_factory=dict)  # beat index → share of the beat with a clear spot for big words


class IconLibrary:
    """Simple Icons (CC0) as the prototype's local logo library."""

    def __init__(self) -> None:
        data = json.loads(ICONS_JSON.read_text(encoding="utf-8"))
        self.icons = data["icons"]
        self.default_w = data.get("width", 24)
        self.default_h = data.get("height", 24)

    def match(self, brand: str) -> str | None:
        key = BRAND_ALIASES.get(_norm(brand), _norm(brand))
        if key in self.icons:
            return key
        close = difflib.get_close_matches(key, self.icons.keys(), n=1, cutoff=0.86)
        return close[0] if close else None

    def write_svg(self, slug: str, out_dir: Path, color: str = "#FFFFFF") -> str:
        icon = self.icons[slug]
        w, h = icon.get("width", self.default_w), icon.get("height", self.default_h)
        body = icon["body"].replace("currentColor", color)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{slug}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="512" height="512">{body}</svg>', encoding="utf-8")
        return f"media/icons/{slug}.svg"


_STOP = set("the and you are was this that with have from your will what when they then just like into about there "
             "can but not all get got one out now how why let see our its has had his her it's".split())


def _tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9_+#]{3,}", s.lower()) if t not in _STOP}


def _overlap(a: tuple, b: tuple) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy


def _ocr_at(ocr: dict, t: float) -> list[tuple]:
    return [(e["rect"]["x"], e["rect"]["y"], e["rect"]["w"], e["rect"]["h"]) for e in ocr["elements"] if e["from"] <= t < e["to"]]


class Composer:
    def __init__(self, words: list[dict], sheet: BeatSheet, plan: VisualPlan, ocr: dict, duration: float, project: Path):
        self.words, self.sheet, self.plan, self.ocr, self.duration, self.project = words, sheet, plan, ocr, duration, project
        self.icons = IconLibrary()
        self.recent_entrances: list[tuple[str, str]] = []
        self.active: list[tuple[float, float, tuple]] = []  # (start, end, box) of placed screen layers, global time
        self.ocr_by_id = {e["id"]: e for e in ocr["elements"]}
        self.result = Compiled(edd={})
        self._cap = cv2.VideoCapture(str(project / "media" / "footage.mp4"))
        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 30
        self._edges: dict[float, np.ndarray] = {}
        self._gray: dict[float, np.ndarray] = {}
        self.sfxlib, self.memes = Sfx(), MemeLib()
        self.sfx: list[dict] = []
        self._meme_sound: dict[str, str] = {}  # sticker layer id → the sound file paired with it
        self._used_memes: set[str] = set()
        self._seen: list[tuple[str, str, float]] = []  # (device, normalised text, time) of visuals placed, for duplicate checks
        self.motion = Motion(project)  # scrolls and cuts in the footage: effects that point at a spot must sit between them
        self._last_header: tuple[dict, float] | None = None  # (layer, beat start) of the latest step header
        self._logos: list[tuple[str, float]] = []  # (icon slug, time) of placed logos
        # A C++ tutorial's "C" is the C++ logo, not Simple Icons' plain letter C.
        said = " ".join(w["text"].lower() for w in words)
        shown = sum(1 for e in ocr["elements"] if re.search(r"c\+\+|\.cpp\b", e["text"].lower()))  # the speech model may write "C<unk>"
        self._cpp = bool(re.search(r"\bc plus plus\b|c\+\+|\bcpp\b", said)) or shown >= 3
        self._punches: list[tuple[str, PlannedVisual, float, str]] = []  # (id, visual, time, why the original failed)
        self._last_label: tuple[dict, dict, float] | None = None  # (beat, layer, beat start) of the latest UI label

    # -------------------------------------------------------------- footage analysis
    def gray_at(self, t: float) -> np.ndarray | None:
        """The base frame at t as 480×270 greyscale (cached per 0.1 s)."""
        key = round(t, 1)
        if key not in self._gray:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, int(key * self._fps))
            ok, frame = self._cap.read()
            if not ok:
                return None
            self._gray[key] = cv2.cvtColor(cv2.resize(frame, (480, 270)), cv2.COLOR_BGR2GRAY)
        return self._gray[key]

    def edges_at(self, t: float) -> np.ndarray | None:
        """Edge map of the base frame at t (cached per 0.1 s): how visually busy each region is."""
        key = round(t, 1)
        if key not in self._edges:
            gray = self.gray_at(key)
            if gray is None:
                return None
            self._edges[key] = cv2.Canny(gray, 60, 160) > 0
        return self._edges[key]

    def text_visible(self, el: dict, t: float) -> bool:
        """Re-read the target's text on the exact frame: OCR's 1.5 s samples can't tell that a menu has
        just closed, a page scrolled, or the creator's own clip covers the row (Linux run 6). True when
        the footage can't be read (tests, missing proxy)."""
        self._cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * self._fps))
        ok, frame = self._cap.read()
        if not ok:
            return True
        try:
            seen = read_region(frame, el["rect"]).lower()
        except Exception:  # noqa: BLE001 - OCR unavailable: don't block the edit
            return True
        want = el["text"].lower()
        words = re.findall(r"[a-z0-9]{2,}", want)
        hit = sum(1 for w in words if w in seen) / len(words) if words else 0.0
        return hit >= 0.5 or difflib.SequenceMatcher(None, seen, want).ratio() >= 0.6

    def first_visible(self, el: dict, t: float) -> float | None:
        """First of t, t+0.4, t+0.8 at which the target text is really on screen."""
        for dt in (0.0, 0.4, 0.8):
            if self.text_visible(el, t + dt):
                return t + dt
        return None

    def stable_until(self, rect: dict, t0: float, t_max: float, changed_share: float) -> float:
        """Last moment (checked every 0.2 s) before the footage under `rect` changes a lot: a scroll, a cut,
        a window switch or a transition. OCR samples every 1.5 s and misses these (C++ run 5: the page
        scrolled under a label; zooms landed inside the creator's 3D transition)."""
        def region(t):
            g = self.gray_at(t)
            if g is None:
                return None
            x0, y0 = int(max(0, rect["x"] - 1) / 100 * 480), int(max(0, rect["y"] - 1) / 100 * 270)
            x1, y1 = int(min(100, rect["x"] + rect["w"] + 1) / 100 * 480), int(min(100, rect["y"] + rect["h"] + 1) / 100 * 270)
            return g[y0:max(y0 + 2, y1), x0:max(x0 + 2, x1)].astype(np.float32)
        ref = region(t0 + 0.1)
        if ref is None:
            return t_max
        t = t0 + 0.3
        while t <= t_max:
            cur = region(t)
            if cur is None:
                return t_max
            # A cut or window switch changes most pixels; a scroll of thin text may not, but it shifts the
            # whole region, which phase correlation measures directly (hover/typing leave the shift at 0).
            (dx, dy), response = cv2.phaseCorrelate(ref, cur)
            if (np.abs(cur - ref) > 30).mean() > changed_share or (response > 0.05 and max(abs(dx), abs(dy)) >= 2):
                return t - 0.1
            t += 0.2
        return t_max

    def busyness(self, box: tuple, t: float) -> float:
        """Fraction of edge pixels under a box (0 = flat background, ~0.15+ = dense UI)."""
        e = self.edges_at(t)
        if e is None:
            return 0.0
        x0, y0 = int(box[0] / 100 * 480), int(box[1] / 100 * 270)
        x1, y1 = int((box[0] + box[2]) / 100 * 480), int((box[1] + box[3]) / 100 * 270)
        region = e[max(0, y0):max(y0 + 1, y1), max(0, x0):max(x0 + 1, x1)]
        return float(region.mean()) if region.size else 0.0

    def text_cover(self, box: tuple, t: float, exclude: str | None = None) -> float:
        """Share of the box covered by text OCR saw on screen around t (code, page text, the creator's
        own overlays). Edge density alone misses dark-theme code: thin glyphs at 480 px barely register."""
        step = self.ocr.get("step", 1.5)
        area = box[2] * box[3]
        if area <= 0:
            return 0.0
        cover = sum(_overlap(box, (e["rect"]["x"], e["rect"]["y"], e["rect"]["w"], e["rect"]["h"]))
                    for e in self.ocr["elements"] if e["id"] != exclude and e["from"] - step <= t <= e["to"])
        return min(1.0, cover / area)

    def clear_slot(self, slots: dict, prefer: list[str], start: float, end: float) -> str | None:
        """Best slot (by pick_slot's cost) that covers neither on-screen text nor busy UI; None if every slot does."""
        ok = {k: v for k, v in slots.items()
              if self.text_cover(v, start + 0.3) <= MAX_TEXT_COVER and self.busyness(v, start + 0.3) <= MAX_BUSY}
        return self.pick_slot(ok, start, end, prefer) if ok else None

    # -------------------------------------------------------------- fact guards
    def beat_text(self, b0: float, b1: float) -> str:
        return " ".join(w["text"].lower() for w in self.words if b0 <= w["start"] < b1)

    def number_spoken(self, value: float, b0: float, b1: float) -> bool:
        """True if the number is in the beat's narration, as digits or as words (Parakeet spells numbers out)."""
        text = self.beat_text(b0, b1)
        whole = int(abs(value))
        candidates = {str(whole), f"{value:g}", _number_words(whole)} if whole < 1000 else {str(whole), f"{value:g}"}
        flat = re.sub(r"[-,]", " ", text)
        return any(c and re.search(rf"\b{re.escape(c)}\b", flat) for c in candidates)

    def seen_or_heard(self, snippet: str, at: float, b0: float, b1: float) -> bool:
        """≥ 60 % of the snippet's words appear on screen (±5 s) or in the narration."""
        tokens = {t.lower() for t in re.findall(r"[A-Za-z0-9_]{3,}", snippet)}
        if not tokens:
            return False
        screen = " ".join(e["text"].lower() for e in self.ocr["elements"] if e["from"] - 5 <= at <= e["to"] + 5)
        heard = self.beat_text(b0 - 3, b1 + 3)
        found = sum(1 for t in tokens if t in screen or t in heard)
        return found / len(tokens) >= 0.6

    def target_at(self, ocr_id: str | None, t: float) -> dict | None:
        """The OCR element if it is UI text on screen at t; else the same text on screen at t; else None."""
        step = self.ocr.get("step", 1.5)  # OCR only samples every `step` s: allow for text appearing between samples
        def on_screen(e):
            return e["from"] - step <= t <= e["to"] and not is_overlay(e)
        el = self.ocr_by_id.get(ocr_id or "")
        if el and on_screen(el):
            return el
        if not el:
            return None
        same = [e for e in self.ocr["elements"] if on_screen(e) and difflib.SequenceMatcher(None, e["text"].lower(), el["text"].lower()).ratio() >= 0.8]
        return min(same, key=lambda e: abs(e["rect"]["y"] - el["rect"]["y"])) if same else None

    # -------------------------------------------------------------- helpers
    def t(self, i: int) -> float:
        i = max(0, min(i, len(self.words) - 1))
        return self.words[i]["start"]

    def _copy_asset(self, src: Path, rel_dir: str) -> str:
        """Copy a library file into the project (projects stay self-contained) and return its project-relative path."""
        import shutil
        dst = self.project / rel_dir / src.name
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        return f"{rel_dir}/{src.name}"

    def _add_sfx(self, role: str, at: float, volume: float, key: str, meta_reason: str, file: str | None = None) -> None:
        recent = {c["_clip"] for c in self.sfx[-6:]}
        clip = None
        if file is None:
            clip = self.sfxlib.pick(role, key, recent)
            if clip is None:
                return
            file = self._copy_asset(self.sfxlib.path(clip), "media/sfx")
        # Don't stack the same kind of sound on top of itself (two whooshes 80 ms apart read as one smeared sound).
        if any(c["role"] == role and abs(c["at"] - at) < 0.25 for c in self.sfx):
            return
        self.sfx.append({"id": f"sfx{len(self.sfx) + 1}", "src": file, "at": round(max(0.0, at), 3), "volume": volume, "role": role,
                         "meta": {"origin": "ai", "locked": False, "reason": meta_reason}, "_clip": clip["id"] if clip else file})
        self.result.sfx_count[role] = self.result.sfx_count.get(role, 0) + 1

    # component → (role, volume, delay after the layer starts). Volumes are relative to the narration (-14 LUFS).
    LAYER_SFX = {"Title": ("whoosh", 0.30, 0.0), "KineticWord": ("pop", 0.38, 0.05), "PopImage": ("pop", 0.38, 0.05),
                 "Header": ("whoosh_short", 0.22, 0.0), "UILabel": ("select", 0.30, 0.05), "ColorChip": ("drop", 0.32, 0.05),
                 "Terminal": ("typing_fast", 0.26, 0.2), "CodeBlock": ("typing", 0.24, 0.2), "BarChart": ("ui_open", 0.3, 0.1),
                 "Gauge": ("sparkle", 0.3, 0.1), "NeuralNet": ("force", 0.22, 0.0)}
    MOOD_SFX = {"anger": "impact", "shock": "boom", "sad": "thud", "happy": "sparkle", "confusion": "question"}

    def add_sfx(self, beats: list[dict]) -> None:
        """Sound for what's on screen, at the moment it appears: quick swipe on a zoom in, a softer whoosh on the zoom
        out, pops and whooshes on graphics, a paired sound on a meme."""
        for b in beats:
            for z in b["camera"]:
                zs = b["start"] + z["at"]
                self._add_sfx("whoosh_short", zs, 0.34, f"{b['id']}in{z['at']}", "zoom in")
                self._add_sfx("whoosh", zs + z["inFrames"] / 30 + z["hold"], 0.26, f"{b['id']}out{z['at']}", "zoom out")
            for l in b["layers"]:
                if str(l.get("meta", {}).get("reason", "")).startswith("continues header"):
                    continue
                t = b["start"] + l["enter"]["at"]
                if l["component"] == "MemeSticker":
                    if l["id"] in self._meme_sound:
                        self._add_sfx("meme", t + 0.05, 0.55, l["id"], f"meme sound for {l['props'].get('credit', '')[:30]}", file=self._meme_sound[l["id"]])
                    else:
                        self._add_sfx(getattr(self, "_meme_role", {}).get(l["id"], "pop"), t + 0.05, 0.5, l["id"], "meme sound")
                    continue
                spec = self.LAYER_SFX.get(l["component"])
                if spec:
                    role, vol, delay = spec
                    self._add_sfx(role, t + delay, vol, l["id"], f"{l['component']} appears")
            for m in b["moods"]:
                role = self.MOOD_SFX.get(m["kind"])
                if role:
                    self._add_sfx(role, b["start"] + m["at"], 0.4, f"{b['id']}mood{m['at']}", f"{m['kind']} mood")
        self.sfx.sort(key=lambda c: c["at"])
        for c in self.sfx:
            c.pop("_clip", None)

    def word_end(self, i: int) -> float:
        return self.words[max(0, min(i, len(self.words) - 1))]["end"]

    def clause_end(self, i: int, cap: int = 14) -> float:
        """End of the spoken clause that word i is in: the next word ending in punctuation, or before a pause."""
        last = len(self.words) - 1
        for j in range(max(0, i), min(i + cap, last) + 1):
            w = self.words[j]
            gap = (self.words[j + 1]["start"] - w["end"]) if j < last else 1.0
            if re.search(r"[.,;:!?]$", w["text"]) or gap > 0.35:
                return w["end"]
        return self.word_end(min(i + cap, last))

    @staticmethod
    def span(at: float, until: float, lo: float, hi: float) -> float:
        """How long an effect that starts at `at` stays up so that it leaves at `until` (clamped to a sane range)."""
        return round(min(max(until - at, lo), hi), 3)

    def locate_at(self, el: dict, t: float) -> dict | None:
        """The target's real rect on the frame at t (the page may have scrolled since OCR sampled it)."""
        self._cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * self._fps))
        ok, frame = self._cap.read()
        if not ok:
            return el["rect"]  # no footage to check against (tests): trust the OCR sample
        try:
            return locate(frame, el["text"])
        except Exception:  # noqa: BLE001 - OCR unavailable: don't block the edit
            return el["rect"]

    def sentence_end(self, i: int) -> float:
        for j in range(i, min(i + 25, len(self.words))):
            if re.search(r"[.!?]$", self.words[j]["text"]):
                return self.words[j]["end"]
        return self.t(min(i + 8, len(self.words) - 1))

    def pick_slot(self, slots: dict, start: float, end: float, prefer: list[str]) -> str:
        """Slot with the least overlap with on-screen text and other overlays during [start, end)."""
        busy = [b for (s, e, b) in self.active if s < end and e > start]
        text = _ocr_at(self.ocr, start + 0.3)
        def cost(name: str) -> float:
            box = slots[name]
            c = sum(_overlap(box, b) for b in busy) * 4 + sum(_overlap(box, b) for b in text)
            c += self.busyness(box, start + 0.3) * 2500  # UI graphics OCR can't see
            return c + prefer.index(name) * 2 if name in prefer else c + 50
        return min(slots, key=cost)

    def entrance(self, preferred: list[tuple[str, str]]) -> tuple[str, str]:
        """First preferred (preset, direction) that wouldn't make three identical entrances in a row."""
        for p in preferred:
            if self.recent_entrances[-2:] != [p, p]:
                self.recent_entrances.append(p)
                return p
        self.recent_entrances.append(preferred[-1])
        return preferred[-1]

    # -------------------------------------------------------------- compile
    def compile(self) -> Compiled:
        beats_out = []
        starts = [0.0] + [max(0.0, self.t(b.first_word) - 0.15) for b in self.sheet.beats[1:]]
        for k in range(1, len(starts)):
            starts[k] = max(starts[k], starts[k - 1] + 0.5)
        ends = starts[1:] + [self.duration]
        by_beat: dict[int, list[PlannedVisual]] = {}
        for v in self.plan.visuals:
            # A visual belongs to the beat its anchor word is in. The model's own `beat` number can't be trusted:
            # a top-up answered with beat numbers one off from its word indices (raw-loop run: 16 visuals lost).
            firsts = [b.first_word for b in self.sheet.beats]
            anchor_beat = max(0, sum(1 for f in firsts if f <= v.anchor_word) - 1)
            by_beat.setdefault(min(anchor_beat, len(self.sheet.beats) - 1), []).append(v)

        for bi, b in enumerate(self.sheet.beats):
            b0, b1 = round(starts[bi], 3), round(ends[bi], 3)
            beat = {"id": f"b{bi + 1}", "start": b0, "end": b1, "intent": b.intent, "pacing": b.pacing,
                    "base": {"kind": "video", "src": "media/footage.mp4", "from": b0, "fit": "cover"},
                    "camera": [], "layers": [], "moods": [],
                    "meta": {"origin": "ai", "locked": False, "reason": f"tone: {b.tone}"}}
            ordered = sorted(by_beat.get(bi, []), key=lambda v: v.anchor_word)
            ids = {id(v): f"b{bi + 1}v{n + 1}" for n, v in enumerate(ordered)}
            # Zooms first, so labels know where the camera will be looking (ids stay in word order).
            for v in sorted(ordered, key=lambda v: (v.device != "zoom_hold", v.anchor_word)):
                self.add_visual(beat, v, ids[id(v)], b0, b1)
            beat["camera"].sort(key=lambda c: c["at"])
            samples = [b0 + 0.5 + k for k in range(max(1, int(b1 - b0 - 0.5)))]
            self.result.room[bi] = round(sum(
                any(self.text_cover(box, t) <= MAX_TEXT_COVER and self.busyness(box, t) <= MAX_BUSY for box in CAPTION_SLOTS.values())
                for t in samples) / len(samples), 2)
            self.place_punches(beat, b0, b1)
            beats_out.append(beat)

        self.carry_headers(beats_out)
        self.add_sfx(beats_out)
        self._cap.release()
        self.result.edd = {
            "version": 1, "componentLibrary": COMPONENT_LIBRARY,
            "format": {"width": 1920, "height": 1080, "fps": 30}, "look": "footage-first",
            "audio": {"voice": {"src": "media/narration.m4a", "start": 0, "from": 0, "volume": 1}, "music": [], "sfx": self.sfx},
            "beats": beats_out,
        }
        return self.result

    def shown_big(self, text: str, t: float) -> dict | None:
        """Big on-screen text (the creator's overlays, title cards) already saying `text` around t: adding it
        again would duplicate it (C++ test: our 'IF ELSE' under the creator's 'What's Past If-else' card)."""
        toks = _tokens(text)
        if not toks:
            return None
        step = self.ocr.get("step", 1.5)
        for e in self.ocr["elements"]:
            if e["from"] - step <= t + 1.0 and e["to"] >= t - 0.5 and (is_overlay(e) or e["rect"]["h"] >= 4.5) and toks <= _tokens(e["text"]):
                return e
        return None

    def visible_span(self, el: dict) -> tuple[float, float]:
        """(from, to) of an OCR element, chained through neighbours with near-identical text at the same
        place: OCR splits one piece of UI text whenever a character is misread or the page nudges."""
        step = self.ocr.get("step", 1.5)
        r = el["rect"]
        def same(e):
            q = e["rect"]
            return (abs(q["x"] - r["x"]) < 3 and abs(q["y"] - r["y"]) < 3
                    and difflib.SequenceMatcher(None, e["text"].lower(), el["text"].lower()).ratio() >= 0.8)
        near = sorted((e for e in self.ocr["elements"] if same(e)), key=lambda e: e["from"])
        t0, t1 = el["from"], el["to"]
        for e in near:  # forward
            if e["from"] <= t1 + step * 0.01 and e["to"] > t1:
                t1 = e["to"]
        for e in reversed(near):  # backward
            if e["to"] >= t0 - step * 0.01 and e["from"] < t0:
                t0 = e["from"]
        return t0, t1

    def camera_view(self, beat: dict, b0: float, t0: float, t1: float) -> tuple[tuple, float, float] | None:
        """(view rect, scale, start time) of the first camera move in this beat overlapping [t0, t1], else None."""
        for c in beat["camera"]:
            s = b0 + c["at"]
            if s < t1 and s + c["inFrames"] / 30 + c["hold"] + c["outFrames"] / 30 > t0:
                v = c["to"]
                z = max(1.0, min(100 / v["w"], 100 / v["h"]))
                w, h = 100 / z, 100 / z
                cx = min(max(v["x"] + v["w"] / 2, w / 2), 100 - w / 2)
                cy = min(max(v["y"] + v["h"] / 2, h / 2), 100 - h / 2)
                return (cx - w / 2, cy - h / 2, w, h), z, s
        return None

    def spoken_targets(self, at: float) -> list[dict]:
        """On-screen UI text (not window chrome, not the creator's overlays) sharing words with the
        narration around `at`, best match first."""
        heard = _tokens(" ".join(w["text"] for w in self.words if at - 2.0 <= w["start"] <= at + 2.5))
        step, t = self.ocr.get("step", 1.5), at + LEAD
        scored = []
        for e in self.ocr["elements"]:
            if not (e["from"] - step <= t <= e["to"]) or is_overlay(e) or e["rect"]["y"] < 7:
                continue
            s = len(_tokens(e["text"]) & heard)
            if s:
                scored.append((-s, e["from"], e["id"], e))
        return [e for *_, e in sorted(scored, key=lambda x: x[:3])]

    def place_punches(self, beat: dict, b0: float, b1: float) -> None:
        """Visuals that couldn't be placed (a big word with no clear spot; a zoom or label whose target is
        covered, gone or scrolled at that moment) become a quick punch-in on on-screen text the narration
        is about, verified on the frame: the cut still lands on the word, your contextual quick zoom."""
        def span(c):
            s = b0 + c["at"]
            return s, s + c["inFrames"] / 30 + c["hold"] + c["outFrames"] / 30
        for lid, v, at, failed in self._punches:
            word = (v.text or self.words[v.anchor_word]["text"]).strip()
            zat = max(b0, at + LEAD - 0.2)
            mv = self.motion.moving_at(zat + 0.2, pad=0.1)
            if mv:  # land after the scroll / switch settles
                zat = mv[1] + 0.1 - 0.2
            nxt = self.motion.next_start(zat + 0.4)
            hold = 0.9 if nxt is None else min(0.9, nxt - 0.12 - zat - 0.17)
            z0, z1 = zat, zat + 5 / 30 + max(hold, 0) + 8 / 30
            busy = z1 > b1 - 0.1 or hold < 0.6 or zat > at + LEAD + 1.2 or any(s < z1 + 0.2 and e > z0 - 0.2 for s, e in map(span, beat["camera"]))
            el, loc = None, None
            if not busy:
                for cand in self.spoken_targets(at)[:4]:
                    loc = self.locate_at(cand, zat + 0.2)
                    if loc:
                        el = cand
                        break
            if busy:
                why = f"{failed}, and the camera is already moving then"
            elif not el:
                why = f"{failed}, and no readable on-screen text matches the narration for a quick zoom"
            else:
                r = loc
                size = min(75.0, max(50.0, max(r["w"], r["h"] * 16 / 9) * 1.6))
                cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
                x, y = min(max(cx - size / 2, 0), 100 - size), min(max(cy - size / 2, 0), 100 - size)
                beat["camera"].append({"at": round(zat - b0, 3), "to": {"x": round(x, 2), "y": round(y, 2), "w": round(size, 2), "h": round(size, 2)},
                                       "inFrames": 5, "hold": round(hold, 3), "outFrames": 8, "tiltDeg": 0,
                                       "meta": {"origin": "ai", "locked": False,
                                                "reason": f"quick zoom on '{el['text'][:30]}' for '{word}' ({failed})"}})
                self.result.converted.append({"id": lid, "device": v.device, "word": word, "zoom_on": el["id"],
                                              "text": el["text"][:40], "because": failed})
                continue
            self.result.dropped.append({"id": lid, "device": v.device, "why": why})
        self._punches = []
        beat["camera"].sort(key=lambda c: c["at"])

    def carry_headers(self, beats: list[dict]) -> None:
        """A step header stays on screen across beats until the next header or title (Super VL finding),
        and ends where the footage shows the creator's own step header."""
        current, current_t = None, 0.0
        for b in beats:
            if any(is_overlay(e) and e["rect"]["y"] < 8 and e["from"] < b["end"] and e["to"] > b["start"] for e in self.ocr["elements"]):
                current = None
                continue
            own = [l for l in b["layers"] if l["component"] in ("Header", "Title")]
            if own:
                headers = [l for l in own if l["component"] == "Header"]
                current = headers[-1] if headers else None
                current_t = b["start"] + current["enter"]["at"] if current else 0.0
                continue
            if current and b["start"] - current_t > 15.0:
                current = None  # a step rarely lasts longer; a header left up for a minute reads as stale
            if current:
                base = {k: v for k, v in current.items() if k != "exit"}
                b["layers"].append({**base, "id": f"{current['id']}-{b['id']}",
                                    "enter": {**current["enter"], "at": 0, "preset": "cut", "durationFrames": 0},
                                    "meta": {**current["meta"], "reason": f"continues header '{current['props']['text']}'"}})

    def add_visual(self, beat: dict, v: PlannedVisual, lid: str, b0: float, b1: float) -> None:
        at = max(b0, self.t(v.anchor_word) - LEAD)
        local = round(at - b0, 3)
        if b1 - at < 0.4:
            self.result.dropped.append({"id": lid, "device": v.device, "why": "too close to beat end"})
            return
        meta = {"origin": "ai", "locked": False, "reason": v.reason}

        def layer(component, props, box, preset, direction, dur, exit_after, space="screen", z=10, exit_preset="fade"):
            end = min(b1 - 0.05, at + exit_after)
            item = {"id": lid, "component": component, "props": props,
                    "box": {"x": box[0], "y": box[1], "w": box[2], "h": box[3], "rotation": 0},
                    "space": space, "z": z,
                    "enter": {"at": local, "preset": preset, "direction": direction, "durationFrames": dur},
                    "meta": meta}
            if end < b1 - 0.1:
                item["exit"] = {"at": round(end - b0, 3), "preset": exit_preset, "durationFrames": 5}
            beat["layers"].append(item)
            if space == "screen":
                self.active.append((at, end, box))

        d = v.device
        # The planner and the top-up both ask for the obvious thing ("HUNDRED" twice, an "i <= 5" label twice, two
        # zooms on the same code): keep the first. Same device and same words within 2.5 s is one visual.
        said = re.sub(r"[^a-z0-9]+", " ", (v.text or v.brand or (self.words[v.anchor_word]["text"] if d == "kinetic_caption" else "")).lower()).strip()
        if said and d != "zoom_hold" and any(pd == d and ps == said and abs(pt - at) < 2.5 for pd, ps, pt in self._seen):
            self.result.dropped.append({"id": lid, "device": d, "why": f"duplicate of an earlier {d} ({said!r}) a moment ago"})
            return
        if said and d != "zoom_hold":
            self._seen.append((d, said, at))
        if d == "word_illustration":
            slug = self.icons.match(v.brand or "") if v.brand else None
            if slug == "c" and self._cpp and "cplusplus" in self.icons.icons:
                slug = "cplusplus"
            if slug and any(s == slug and abs(t - at) < 4.0 for s, t in self._logos):
                self.result.dropped.append({"id": lid, "device": d, "why": f"the {slug} logo was just shown"})
                return
            if not slug:
                self.result.asset_misses.append({"id": lid, "brand": v.brand, "word": self.words[v.anchor_word]["text"]})
                if v.brand:  # fall back to the word as type, so the beat still gets its visual
                    d, v = "kinetic_caption", v.model_copy(update={"text": v.brand})
                else:
                    return
            else:
                src = self.icons.write_svg(slug, self.project / "media" / "icons")
                self.result.asset_hits.append({"id": lid, "brand": v.brand, "icon": slug, "licence": "CC0-1.0 (Simple Icons)"})
                slot = self.pick_slot(LOGO_SLOTS, at, at + 2.2, ["center", "right", "left", "top-right", "top-left"])
                box = LOGO_SLOTS[slot]
                if self.busyness(box, at + 0.3) > 0.12 or self.text_cover(box, at + 0.3) > MAX_TEXT_COVER:
                    # Every big slot covers dense content (e.g. a full-screen document): go small, into a corner.
                    slot = self.pick_slot(SMALL_LOGO_SLOTS, at, at + 2.2, ["top-right", "top-left", "bottom-right", "bottom-left"])
                    box = SMALL_LOGO_SLOTS[slot]
                preset, direction = self.entrance([("pop", SLOT_DIRECTION[slot]), ("slide", SLOT_DIRECTION[slot] if slot != "center" else "up"), ("drop", "up")])
                layer("PopImage", {"src": src}, box, preset, direction, 8,
                      self.span(at, self.word_end(v.anchor_word) + 0.6, 1.4, 2.6), exit_preset="scale-out")
                self._logos.append((slug, at))
                return
        if d in ("kinetic_caption", "title", "ui_label"):
            said = (v.text or "").strip() or self.words[v.anchor_word]["text"]
            dup = self.shown_big(said, at + LEAD)
            if dup:
                self.result.dropped.append({"id": lid, "device": d, "why": f"footage already shows {dup['text'][:30]!r} in big text"})
                return
        if d == "kinetic_caption":
            slot = self.clear_slot(CAPTION_SLOTS, CAPTION_PREFER, at, at + 1.2)
            if slot is None:
                self._punches.append((lid, v, at, "every caption spot covers on-screen text"))  # decided after the beat's zooms
                return
            preset, direction = self.entrance([("pop", "center"), ("scale-in", "center"), ("slide-blur", "left")])
            layer("KineticWord", {"text": (v.text or self.words[v.anchor_word]["text"]).strip(), "uppercase": True, "variant": "word"},
                  CAPTION_SLOTS[slot], preset, direction, 7, self.span(at, self.word_end(v.anchor_word) + 0.2, 0.9, 1.6), z=15, exit_preset="scale-out")
        elif d == "title":
            direction = "left" if len([e for e in self.recent_entrances if e[0] == "slide-blur"]) % 2 == 0 else "right"
            self.entrance([("slide-blur", direction)])
            # A title marks structure, so it is never dropped: it goes where it covers the least text, and
            # shrinks to a compact card when every full-width band would sit on the page or code.
            # The title wins over a header that arrived first in the same moment.
            for l in [l for l in beat["layers"] if l["component"] == "Header" and abs(b0 + l["enter"]["at"] - at) < 2.0]:
                beat["layers"].remove(l)
                self.result.dropped.append({"id": l["id"], "device": "section_header", "why": "a title in the same moment already says it"})
                if self._last_header and self._last_header[0] is l:
                    self._last_header = None
            slot = self.clear_slot(TITLE_SLOTS, ["middle", "upper", "lower", "compact"], at, at + 1.6) or "compact"
            layer("Title", {"text": (v.text or "").strip() or self.words[v.anchor_word]["text"], "uppercase": True},
                  TITLE_SLOTS[slot], "slide-blur", direction, 9, self.span(at, self.clause_end(v.anchor_word) + 0.2, 1.4, 2.8), z=20, exit_preset="slide")
        elif d == "section_header":
            # The footage already shows the creator's own step header → don't stack a second one.
            if any(is_overlay(e) and e["rect"]["y"] < 8 and e["from"] < b1 and e["to"] > b0 for e in self.ocr["elements"]):
                self.result.dropped.append({"id": lid, "device": d, "why": "footage already shows a step header"})
                return
            text = (v.text or "").strip()
            narration = " ".join(w["text"].lower() for w in self.words if b0 <= w["start"] < b1)
            if not re.search(r"\b(first|second|third|fourth|fifth|step (one|two|three|four|five|\d))\b", narration):
                text = re.sub(r"^\s*\d+[.)]\s*", "", text)  # numbering only when the narration numbers the step
            if self._last_header:  # a new step header replaces the previous one (three stacked at 64-67 s in the raw-loop run)
                pl, pb0 = self._last_header
                if pb0 + pl["enter"]["at"] < at:
                    pl["exit"] = {"at": round(at - pb0 - 0.05, 3), "preset": "fade", "durationFrames": 5}
            # A title in the same beat within 2 s already says it (C++ raw run: "Loops Fix This" header under a
            # "Loops fix this" title; "For Loop Basics" under "The for Loop").
            if any(l["component"] == "Title" and abs(b0 + l["enter"]["at"] - at) < 2.0 for l in beat["layers"]):
                self.result.dropped.append({"id": lid, "device": d, "why": "a title in the same moment already says it"})
                return
            # Below the window chrome: in a screen recording the top ~8 % is tabs, address bar and menus.
            preset, direction = self.entrance([("slide", "left"), ("slide-blur", "left"), ("fade", "center")])
            layer("Header", {"text": text, "variant": "header", "align": "left", "color": "accent"},
                  (5, 9.5, 40, 6), preset, direction, 7, b1 - at, z=25)
            self._last_header = (beat["layers"][-1], b0)
        elif d == "color_chip":
            color = v.color if v.color and re.fullmatch(r"#[0-9a-fA-F]{6}", v.color) else "#0A84FF"
            # Label with the spoken colour word, never a hex code (run 3 showed "#0066CC").
            label = v.text if v.text and not re.fullmatch(r"#?[0-9a-fA-F]{3,8}", v.text.strip()) else self.words[v.anchor_word]["text"].strip(".,!?")
            props = {"color": color, "label": label[:14]}
            layer("ColorChip", props,
                  (85, 8, 9, 16), *self.entrance([("pop", "center"), ("drop", "up")]), 7, self.span(at, self.word_end(v.anchor_word) + 0.9, 1.4, 2.4), z=20)
        elif d == "meme":
            around = " ".join(w["text"] for w in self.words if at - 2.5 <= w["start"] <= at + 3.0)
            m = self.memes.match(" ".join(filter(None, [v.text, v.reason])), around, self._used_memes)
            if not m:
                self.result.memes_missed.append({"id": lid, "meme": v.text, "word": self.words[v.anchor_word]["text"]})
                self.result.dropped.append({"id": lid, "device": d, "why": f"no licensed meme matches {v.text!r} (add one to library/memes/mine)"})
                return
            self._used_memes.add(m["id"])
            src = self._copy_asset(self.memes.asset(m["file"]), "media/memes")
            slot = self.pick_slot(LOGO_SLOTS, at, at + 2.0, ["center", "right", "left", "top-right", "top-left"])
            x, y, w, h = LOGO_SLOTS[slot]
            big = (round(x + w / 2 - w * 0.65, 2), round(y + h / 2 - h * 0.65, 2), round(w * 1.3, 2), round(h * 1.3, 2))
            big = (min(max(big[0], SAFE_PCT), 100 - SAFE_PCT - big[2]), min(max(big[1], SAFE_PCT), 100 - SAFE_PCT - big[3]), big[2], big[3])
            preset, direction = self.entrance([("pop", SLOT_DIRECTION[slot]), ("scale-in", "center"), ("drop", "up")])
            layer("MemeSticker", {"src": src, "credit": m["credit"]}, big, preset, direction, 8,
                  self.span(at, self.word_end(v.anchor_word) + 1.0, 1.6, 2.4), z=30, exit_preset="scale-out")
            snd = self.memes.catalog["sounds"].get(m.get("sound", ""))
            if snd:
                self._meme_sound[beat["layers"][-1]["id"]] = self._copy_asset(self.memes.asset(snd["file"]), "media/sfx")
            else:  # the sticker names a role from the generic library
                self._meme_role = getattr(self, "_meme_role", {})
                self._meme_role[beat["layers"][-1]["id"]] = m.get("sound", "pop")
        elif d in ("terminal", "code"):
            snippet = (v.code or "").strip()
            if not snippet or not self.seen_or_heard(snippet, at, b0, b1):
                self.result.dropped.append({"id": lid, "device": d, "why": "command/code is neither on screen nor in the narration"})
                return
            if d == "terminal":
                cmd = snippet.splitlines()[0][:70]
                layer("Terminal", {"prompt": "$", "command": cmd, "output": [], "title": "Terminal"},
                      (14, 62, 72, 24), *self.entrance([("slide", "up"), ("pop", "center")]), 8, max(2.5, len(cmd) / 28 + 1.2), z=22)
            else:
                lines = snippet.splitlines()[:10]
                h = min(70.0, 14 + 5.2 * len(lines))
                layer("CodeBlock", {"code": "\n".join(lines), "reveal": "lines", "language": "text"},
                      (16, round(50 - h / 2, 2), 68, round(h, 2)), *self.entrance([("scale-in", "center"), ("slide", "up")]), 10, 3.5, z=22)
        elif d == "neural_net":
            narration = self.beat_text(b0, b1)
            if not re.search(r"\b(neural|network|networks|model|models|layer|layers|ai|deep learning|machine learning|llm|gpt)\b", narration):
                self.result.dropped.append({"id": lid, "device": d, "why": "narration isn't about neural networks/models"})
                return
            layer("NeuralNet", {"layers": [4, 6, 6, 3], "pulses": 2}, (20, 14, 60, 72), "fade", "center", 6, 3.5, z=22)
        elif d in ("stat_chart", "gauge"):
            stats = [s for s in (v.stats or []) if self.number_spoken(s.value, b0, b1)]
            if (d == "stat_chart" and len(stats) < 2) or (d == "gauge" and not stats):
                self.result.dropped.append({"id": lid, "device": d, "why": "numbers not spoken in the narration (never invent data)"})
                return
            if d == "stat_chart":
                bars = [{"label": s.label[:18], "value": s.value} for s in stats[:8]]
                layer("BarChart", {"bars": bars, "decimals": 0 if all(float(b["value"]).is_integer() for b in bars) else 1},
                      (18, 16, 64, 68), "slide", "up", 8, 3.5, z=22)
            else:
                s = stats[0]
                mx = v.max_value if v.max_value and v.max_value > s.value else (100.0 if s.value <= 100 else s.value * 1.25)
                layer("Gauge", {"value": s.value, "max": mx, "label": s.label[:24]}, (36, 14, 28, 72), "pop", "center", 8, 3.0, z=22)
        elif d == "mood" and v.mood:
            beat["moods"].append({"kind": v.mood, "at": local, "duration": round(min(1.6, b1 - at - 0.05), 3), "intensity": 0.6, "meta": meta})
        elif d in ("zoom_hold", "ui_label"):
            el = self.target_at(v.ocr_target, at + LEAD)
            if not el:
                self.result.dropped.append({"id": lid, "device": d, "why": f"target {v.ocr_target!r} not on screen at {at + LEAD:.1f}s"})
                return
            if el["id"] != v.ocr_target:
                self.result.retargeted.append({"id": lid, "from": v.ocr_target, "to": el["id"], "text": el["text"][:40]})
            r = el["rect"]
            # OCR samples every `step` s: the text appeared somewhere in (from - step, from] and vanished in
            # (to - step, to]. Take the midpoints as its visible window (Linux run 4: a label stayed up 0.6 s
            # after its menu had closed).
            step = self.ocr.get("step", 1.5)
            span0, span1 = self.visible_span(el)
            seen0, seen1 = span0 - step / 2, span1 - step / 2
            if d == "zoom_hold" and r["y"] < 7:
                # Top 7 % of a screen recording is window chrome (title bar, tabs, menu): never a story subject.
                self.result.dropped.append({"id": lid, "device": d, "why": f"target {el['text'][:30]!r} is window chrome"})
                return
            if d == "zoom_hold":
                end_i = v.end_word if v.end_word is not None else v.anchor_word
                zat = max(b0, at + LEAD - 0.3)
                # 1. Don't land while the footage is scrolling or switching: wait for it to settle.
                mv = self.motion.moving_at(zat + 0.2, pad=0.1)
                if mv:
                    zat = mv[1] + 0.1 - 0.2
                    if zat > at + LEAD + 1.2:
                        self._punches.append((lid, v, at, "the footage is still moving when the zoom would land"))
                        return
                # 2. Find the target where it really is on that frame (a scroll moves it between OCR samples).
                loc = None
                for dt in (0.0, 0.3, 0.6):
                    loc = self.locate_at(el, zat + 0.2 + dt)
                    if loc:
                        zat += dt
                        break
                if loc is None:
                    self._punches.append((lid, v, at, f"{el['text'][:30]!r} isn't readable when the zoom would land"))
                    return
                r = loc
                size = min(80.0, max(32.0, max(r["w"], r["h"] * 16 / 9) * 2.0))
                cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
                x = min(max(cx - size / 2, 0), 100 - size)
                y = min(max(cy - size / 2, 0), 100 - size)
                # 3. Zoom out when the narrated phrase ends, or just before the footage moves again.
                nxt = self.motion.next_start(zat + 0.4)
                stop = min(self.clause_end(end_i) + 0.15, (nxt - 0.12) if nxt else 1e9, b1 - 0.4, zat + 6.0)
                if stop - zat < 1.0:
                    self._punches.append((lid, v, at, "the footage moves again right after the zoom would land"))
                    return
                for c in beat["camera"]:
                    cs, ce = b0 + c["at"], b0 + c["at"] + c["inFrames"] / 30 + c["hold"] + 0.3
                    v0 = c["to"]
                    ix = max(0.0, min(x + size, v0["x"] + v0["w"]) - max(x, v0["x"]))
                    iy = max(0.0, min(y + size, v0["y"] + v0["h"]) - max(y, v0["y"]))
                    if cs <= zat <= ce and ix * iy / (size * size) >= 0.6:
                        self.result.dropped.append({"id": lid, "device": d, "why": "same area as a zoom that is still up"})
                        return
                # No pixel-change check inside the zoomed region: in a screen recording it usually changes *because*
                # of what the zoom is about (a menu opening, a search filling in); Linux run 4 lost its best zooms.
                beat["camera"].append({"at": round(zat - b0, 3), "to": {"x": round(x, 2), "y": round(y, 2), "w": round(size, 2), "h": round(size, 2)},
                                       "inFrames": 6, "hold": round(stop - zat - 0.2, 3), "outFrames": 10,
                                       "tiltDeg": 0, "meta": meta})
            else:
                # Start once the target is surely there, end before it leaves.
                at0 = at = max(at, seen0)
                mv = self.motion.moving_at(at + 0.3, pad=0.1)
                if mv:  # wait for the scroll / switch to settle
                    at = mv[1] + 0.1 - 0.3
                    if at - at0 > 1.2:
                        self._punches.append((lid, v, at0, "the footage is still moving when the label would appear"))
                        return
                loc = None
                for dt in (0.0, 0.3, 0.6):
                    loc = self.locate_at(el, at + 0.3 + dt)
                    if loc:
                        at += dt
                        break
                if loc is None:
                    self._punches.append((lid, v, at0, f"{el['text'][:30]!r} isn't readable when the label would appear"))
                    return
                r = loc
                local = round(at - b0, 3)
                pad = 1.0
                target = {"x": max(0, r["x"] - pad), "y": max(0, r["y"] - pad), "w": r["w"] + 2 * pad, "h": r["h"] + 2 * pad}
                text = (v.text or el["text"])[:32]
                w, h = min(40.0, max(14.0, len(text) * 1.35 + 6)), 6.0
                hold = round(min(2.6, seen1 - at, b1 - 0.05 - at), 3)
                if hold < 1.0:
                    self._punches.append((lid, v, at, f"label target {el['text'][:30]!r} leaves the screen too soon"))
                    return
                # A wide area around the target: hovering/clicking the item itself changes only a little of it,
                # a scroll or a cut changes most of it.
                nxt = self.motion.next_start(at + 0.4)
                if nxt is not None:
                    if nxt - 0.08 - at < 1.0:
                        self._punches.append((lid, v, at, f"the footage moves again right after label target {el['text'][:30]!r} would show"))
                        return
                    hold = round(min(hold, nxt - 0.08 - at), 3)
                cam = self.camera_view(beat, b0, at, at + hold)
                if cam:
                    (vx, vy, vw, vh), z, cam_at = cam
                    tcx0, tcy0 = target["x"] + target["w"] / 2, target["y"] + target["h"] / 2
                    if not (vx <= tcx0 <= vx + vw and vy <= tcy0 <= vy + vh):
                        # The camera is about to look elsewhere: show the label on the full frame until it moves.
                        if cam_at - at < 1.0:
                            self.result.dropped.append({"id": lid, "device": d, "why": "the camera is zoomed on another region then"})
                            return
                        cam, hold = None, round(min(hold, cam_at - at - 0.05), 3)
                if not cam:
                    (vx, vy, vw, vh), z = (2.0, 4.0, 96.0, 91.0), 1.0
                # Inside a zoom the pill keeps its on-screen size (UILabel scales it by 1/zoom around its top
                # centre), so in stage % it is w/z × h/z, and it must sit inside the camera's view (C++ test: a
                # label placed outside the zoomed view never appeared).
                ew, eh, gap = w / z, h / z, 1.5 / z
                tcx, tcy = target["x"] + target["w"] / 2, target["y"] + target["h"] / 2
                spots = [(tcx, target["y"] + target["h"] + gap), (tcx, target["y"] - eh - gap),
                         (target["x"] + target["w"] + gap + ew / 2, tcy - eh / 2), (target["x"] - gap - ew / 2, tcy - eh / 2)]
                # Below / above / right / left of the target (pill top-centre points): whichever covers the least
                # other text (C++ test: pills landed on the next code line and on the creator's yellow header).
                def spot_cost(k: int) -> float:
                    px, py = spots[k]
                    ex = px - ew / 2
                    if ex < vx + 0.5 or py < vy + 0.5 or ex + ew > vx + vw - 0.5 or py + eh > vy + vh - 0.5:
                        return 1e9
                    return self.text_cover((ex, py, ew, eh), at + LEAD, exclude=el["id"]) + k * 0.02
                best = min(range(len(spots)), key=spot_cost)
                if spot_cost(best) >= 1e9:
                    self.result.dropped.append({"id": lid, "device": d, "why": "no room for the label inside the frame/zoomed view"})
                    return
                px, py = spots[best]
                x, y = px - w / 2, py  # the stored box is the unscaled pill; its top centre is the anchor
                # One label at a time: a new label ends the previous one (two pills at once read as clutter).
                if self._last_label:
                    pb, pl, pb0 = self._last_label
                    p_end = pb0 + (pl["exit"]["at"] if "exit" in pl else pb["end"] - pb0)
                    if p_end > at:
                        new_end = round(at - 0.05 - pb0, 3)
                        if new_end - pl["enter"]["at"] < 0.8:
                            self.result.dropped.append({"id": lid, "device": d, "why": "previous label is still settling"})
                            return
                        pl["exit"] = {"at": new_end, "preset": "fade", "durationFrames": 5}
                layer("UILabel", {"text": text, "target": target}, (round(x, 2), round(y, 2), round(w, 2), h),
                      *self.entrance([("pop", "center"), ("scale-in", "center")]), 7, hold, space="stage", z=18)
                self._last_label = (beat, beat["layers"][-1], b0)


def compile_plan(words, sheet, plan, ocr, duration, project: Path) -> Compiled:
    return Composer(words, sheet, plan, ocr, duration, project).compile()
