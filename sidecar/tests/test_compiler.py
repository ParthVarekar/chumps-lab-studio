"""Offline tests for the compiler's rules (no footage, no AI requests).

Run:  uv run --with pytest pytest tests -q   (from sidecar/)

Without a footage file the edge detector sees nothing (busyness 0), so these tests isolate the
OCR-based rules: fact guards, text coverage, duplicate-of-footage checks and label placement.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cls_sidecar.compiler import CAPTION_PREFER, CAPTION_SLOTS, Composer, compile_plan
from cls_sidecar.planner import BeatSheet, PlannedBeat, PlannedVisual, VisualPlan


def words_from(text: str, start: float = 0.0, step: float = 0.4) -> list[dict]:
    return [{"text": w, "start": round(start + i * step, 3), "end": round(start + i * step + 0.3, 3)}
            for i, w in enumerate(text.split())]


def el(i: str, text: str, x: float, y: float, w: float, h: float, t0: float = 0.0, t1: float = 60.0) -> dict:
    return {"id": i, "text": text, "rect": {"x": x, "y": y, "w": w, "h": h}, "from": t0, "to": t1}


def visual(**kw) -> PlannedVisual:
    base = dict(beat=0, device="kinetic_caption", anchor_word=0, end_word=None, text=None, brand=None,
                ocr_target=None, color=None, mood=None, reason="test")
    return PlannedVisual(**{**base, **kw})


def composer(tmp_path: Path, words: list[dict], elements: list[dict]) -> Composer:
    sheet = BeatSheet(beats=[PlannedBeat(first_word=0, intent="t", pacing="standard", tone="neutral")])
    return Composer(words, sheet, VisualPlan(visuals=[]), {"elements": elements, "step": 1.5, "duration": 30.0}, 30.0, tmp_path)


def compile_one(tmp_path: Path, words: list[dict], elements: list[dict], visuals: list[PlannedVisual]):
    sheet = BeatSheet(beats=[PlannedBeat(first_word=0, intent="t", pacing="standard", tone="neutral")])
    return compile_plan(words, sheet, VisualPlan(visuals=visuals), {"elements": elements, "step": 1.5, "duration": 30.0}, 30.0, tmp_path)


# ------------------------------------------------------------------ fact guards

def test_numbers_must_be_spoken_as_digits_or_words(tmp_path):
    c = composer(tmp_path, words_from("it scored ninety three percent on the test"), [])
    assert c.number_spoken(93, 0, 10)
    assert not c.number_spoken(95, 0, 10)


def test_code_must_be_on_screen_or_heard(tmp_path):
    c = composer(tmp_path, words_from("now run the update command"), [el("o1", "sudo apt update", 10, 40, 30, 3)])
    assert c.seen_or_heard("sudo apt update", 1.0, 0, 5)
    assert not c.seen_or_heard("pacman -Syu --noconfirm", 1.0, 0, 5)


# ------------------------------------------------------------------ placement

def test_text_cover_measures_hidden_text(tmp_path):
    c = composer(tmp_path, words_from("hello"), [el("o1", "int main()", 10, 10, 20, 10)])
    assert c.text_cover((10, 10, 20, 10), 1.0) == pytest.approx(1.0)
    assert c.text_cover((10, 10, 40, 10), 1.0) == pytest.approx(0.5)
    assert c.text_cover((60, 60, 10, 10), 1.0) == 0.0
    assert c.text_cover((10, 10, 20, 10), 1.0, exclude="o1") == 0.0


def test_caption_avoids_code_and_falls_back_to_a_clear_corner(tmp_path):
    # Code fills the left half of the frame: the big middle/lower/upper spots are all covered.
    code = [el(f"o{k}", "std::cout << x;", 4, 8 + k * 6, 46, 4) for k in range(14)]
    c = composer(tmp_path, words_from("this is a nightmare"), code)
    slot = c.clear_slot(CAPTION_SLOTS, CAPTION_PREFER, 1.0, 2.2)
    assert slot is not None and slot.startswith("corner")
    x, y, w, h = CAPTION_SLOTS[slot]
    assert c.text_cover((x, y, w, h), 1.3) <= 0.08


def test_blocked_big_word_becomes_quick_zoom_on_matching_text(tmp_path):
    # Full-screen code and nowhere clear: the word "loop" should become a punch-in on the matching line.
    code = [el(f"o{k}", f"line {k} value", 2, 6 + k * 6, 96, 5) for k in range(15)]
    code.append(el("oL", "for loop counter", 20, 50, 30, 4))
    words = words_from("this loop never ends at all")
    out = compile_one(tmp_path, words, code, [visual(anchor_word=1, text="LOOP")])
    beat = out.edd["beats"][0]
    assert not [l for l in beat["layers"] if l["component"] == "KineticWord"]
    assert len(beat["camera"]) == 1 and out.converted and out.converted[0]["zoom_on"] == "oL"


def test_duplicate_of_creators_big_text_is_dropped(tmp_path):
    card = el("oC", "What's Past If-else", 20, 35, 60, 12)  # the creator's own title card
    out = compile_one(tmp_path, words_from("you will never escape if else"), [card],
                      [visual(anchor_word=4, text="IF ELSE")])
    assert not out.edd["beats"][0]["layers"]
    assert "already shows" in out.dropped[0]["why"]


def test_small_ui_text_is_not_treated_as_a_duplicate(tmp_path):
    ui = el("oU", "else", 20, 35, 5, 2.5)  # 'else' in the code editor, normal UI size
    out = compile_one(tmp_path, words_from("you will never escape if else"), [ui], [visual(anchor_word=4, text="IF ELSE")])
    assert [l for l in out.edd["beats"][0]["layers"] if l["component"] == "KineticWord"]


# ------------------------------------------------------------------ labels

def test_label_stays_inside_the_zoomed_view(tmp_path):
    words = words_from("open the settings and pick the theme then apply it now please")
    target = el("oT", "Theme", 30, 30, 8, 3)
    out = compile_one(tmp_path, words, [target], [
        visual(device="zoom_hold", anchor_word=1, end_word=10, ocr_target="oT"),
        visual(device="ui_label", anchor_word=6, text="Theme", ocr_target="oT"),
    ])
    beat = out.edd["beats"][0]
    cam = beat["camera"][0]["to"]
    label = next(l for l in beat["layers"] if l["component"] == "UILabel")
    z = 100 / cam["w"]
    b = label["box"]
    cx, ew, eh = b["x"] + b["w"] / 2, b["w"] / z, b["h"] / z  # on-screen pill = box / zoom, anchored top-centre
    assert cam["x"] <= cx - ew / 2 and cx + ew / 2 <= cam["x"] + cam["w"]
    assert cam["y"] <= b["y"] and b["y"] + eh <= cam["y"] + cam["h"]


def test_only_one_label_at_a_time(tmp_path):
    words = words_from("first look at this button and then this other menu over here today")
    els = [el("oA", "Button", 20, 40, 8, 3), el("oB", "Menu", 60, 60, 8, 3)]
    out = compile_one(tmp_path, words, els, [
        visual(device="ui_label", anchor_word=2, text="Button", ocr_target="oA"),
        visual(device="ui_label", anchor_word=6, text="Menu", ocr_target="oB"),
    ])
    beat = out.edd["beats"][0]
    a, b = [l for l in beat["layers"] if l["component"] == "UILabel"]
    assert a["exit"]["at"] <= b["enter"]["at"]


def test_label_ends_when_the_page_scrolls(tmp_path):
    # A 3 s synthetic 'screen recording': a text block that jumps 60 px up at 1.6 s (a scroll).
    import cv2
    import numpy as np
    (tmp_path / "media").mkdir()
    out = cv2.VideoWriter(str(tmp_path / "media" / "footage.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (480, 270))
    for f in range(90):
        img = np.zeros((270, 480, 3), np.uint8)
        y = 150 if f < 48 else 90
        for k in range(6):
            cv2.rectangle(img, (60, y + k * 14), (300, y + k * 14 + 6), (255, 255, 255), -1)
        out.write(img)
    out.release()
    c = composer(tmp_path, words_from("hello"), [])
    rect = {"x": 12.5, "y": 55.5, "w": 50, "h": 3}  # the first line before the scroll
    around = {"x": max(0, rect["x"] - 15), "y": rect["y"] - 12, "w": rect["w"] + 30, "h": rect["h"] + 24}
    assert c.stable_until(around, 0.2, 2.8, changed_share=0.4) == pytest.approx(1.5, abs=0.25)
    assert c.stable_until(around, 1.8, 2.8, changed_share=0.4) == 2.8  # nothing moves after the scroll


def test_target_text_is_reread_on_the_exact_frame(tmp_path):
    # 1 s of 1080p: "Accent Color" for the first half, then the menu 'closes' (blank frame).
    pytest.importorskip("rapidocr")
    import cv2
    import numpy as np
    (tmp_path / "media").mkdir()
    out = cv2.VideoWriter(str(tmp_path / "media" / "footage.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), 30, (1920, 1080))
    for f in range(30):
        img = np.full((1080, 1920, 3), 40, np.uint8)
        if f < 15:
            cv2.putText(img, "Accent Color", (600, 520), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (235, 235, 235), 3, cv2.LINE_AA)
        out.write(img)
    out.release()
    target = el("oA", "Accent Color", 30.5, 45.0, 14.5, 4.5)
    c = composer(tmp_path, words_from("hello"), [target])
    assert c.text_visible(target, 0.2)
    assert not c.text_visible(target, 0.8)
    assert c.first_visible(target, 0.1) == pytest.approx(0.1)


# ------------------------------------------------------------------ raw-footage findings (raw-loop run)

def test_new_step_header_replaces_the_previous_one(tmp_path):
    words = words_from("first part one then part two and finally part three right now ok")
    out = compile_one(tmp_path, words, [], [
        visual(device="section_header", anchor_word=1, text="Part One"),
        visual(device="section_header", anchor_word=5, text="Part Two"),
        visual(device="section_header", anchor_word=9, text="Part Three"),
    ])
    hs = [l for l in out.edd["beats"][0]["layers"] if l["component"] == "Header"]
    assert len(hs) == 3
    assert hs[0]["exit"]["at"] <= hs[1]["enter"]["at"] and hs[1]["exit"]["at"] <= hs[2]["enter"]["at"]


def test_cpp_tutorial_gets_the_cpp_logo_once(tmp_path):
    words = words_from("in c plus plus you tell c how many times and c does it")
    out = compile_one(tmp_path, words, [], [
        visual(device="word_illustration", anchor_word=1, brand="c"),
        visual(device="word_illustration", anchor_word=5, brand="c"),
    ])
    logos = [l for l in out.edd["beats"][0]["layers"] if l["component"] == "PopImage"]
    assert len(logos) == 1 and logos[0]["props"]["src"].endswith("cplusplus.svg")
    assert any(("just shown" in d["why"]) or ("duplicate" in d["why"]) for d in out.dropped)


def test_title_and_header_at_the_same_moment_keep_only_the_title(tmp_path):
    words = words_from("loops fix this problem for good now and forever okay then")
    for order in ((0, 1), (1, 0)):  # either arrival order
        vis = [visual(device="section_header", anchor_word=1, text="Loops Fix This"), visual(device="title", anchor_word=1, text="Loops fix this")]
        out = compile_one(tmp_path, words, [], [vis[i] for i in order])
        comps = [l["component"] for l in out.edd["beats"][0]["layers"]]
        assert comps == ["Title"], (order, comps)


# ------------------------------------------------------------------ sound effects and memes

LIB = Path("D:/ChumpsLabStudio/library")


@pytest.mark.skipif(not (LIB / "sfx" / "catalog.json").exists() or not (LIB / "memes" / "catalog.json").exists(), reason="sfx/meme libraries not built")
def test_zoom_gets_whooshes_and_title_gets_a_whoosh(tmp_path):
    words = words_from("open the settings and pick the theme then apply it now please ok")
    out = compile_one(tmp_path, words, [el("oT", "Theme", 30, 30, 8, 3)], [
        visual(device="zoom_hold", anchor_word=1, end_word=6, ocr_target="oT"),
        visual(device="title", anchor_word=8, text="Apply It"),
    ])
    sfx = out.edd["audio"]["sfx"]
    roles = [c["role"] for c in sfx]
    assert "whoosh_short" in roles and "whoosh" in roles
    assert all((tmp_path / c["src"]).exists() for c in sfx)          # files are copied into the project
    assert sfx == sorted(sfx, key=lambda c: c["at"])
    cam = out.edd["beats"][0]["camera"][0]
    zoom_in = next(c for c in sfx if c["role"] == "whoosh_short")
    assert zoom_in["at"] == pytest.approx(out.edd["beats"][0]["start"] + cam["at"], abs=0.01)


@pytest.mark.skipif(not (LIB / "memes" / "catalog.json").exists(), reason="meme library not built")
def test_meme_uses_a_licensed_sticker_with_its_sound_and_unmatched_ones_are_dropped(tmp_path):
    words = words_from("and that is why it is a complete nightmare honestly the whole thing is cooked")
    out = compile_one(tmp_path, words, [], [
        visual(device="meme", anchor_word=6, text="skull", reason="dying joke"),
        visual(device="meme", anchor_word=12, text="zzz-nothing-like-this"),
    ])
    layers = out.edd["beats"][0]["layers"]
    stickers = [l for l in layers if l["component"] == "MemeSticker"]
    assert len(stickers) == 1 and "CC BY 4.0" in stickers[0]["props"]["credit"]
    assert (tmp_path / stickers[0]["props"]["src"]).exists()
    t0 = out.edd["beats"][0]["start"] + stickers[0]["enter"]["at"]
    assert any(abs(c["at"] - t0) < 0.2 for c in out.edd["audio"]["sfx"])  # a sound lands with the sticker
    assert len(out.memes_missed) == 1


def test_duplicate_visuals_from_planner_and_topup_are_collapsed(tmp_path):
    words = words_from("now do it a hundred times that is a lot of copy paste right here today ok")
    out = compile_one(tmp_path, words, [], [
        visual(device="kinetic_caption", anchor_word=5, text="HUNDRED"),
        visual(device="kinetic_caption", anchor_word=5, text="Hundred"),
    ])
    assert len([l for l in out.edd["beats"][0]["layers"] if l["component"] == "KineticWord"]) == 1
    assert any("duplicate" in d["why"] for d in out.dropped)


def test_cpp_logo_also_chosen_when_the_screen_says_cpp(tmp_path):
    words = words_from("you write the code once and tell c how many times to run it")  # no "plus plus" in the transcript
    shown = [el(f"o{k}", "main.cpp", 10, 10 + k, 8, 2) for k in range(4)]
    out = compile_one(tmp_path, words, shown, [visual(device="word_illustration", anchor_word=7, brand="c")])
    logos = [l for l in out.edd["beats"][0]["layers"] if l["component"] == "PopImage"]
    assert logos and logos[0]["props"]["src"].endswith("cplusplus.svg")
