"""Feasibility probe: can the fast vision model turn a plain-English edit request + a resolved context pack into typed ops?"""
import json
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from cls_sidecar.gateway import SUPER_VL_FREE, OpenRouterGateway
from cls_sidecar.openrouter_check import strict_schema

P = Path("D:/ChumpsLabStudio/projects/raw-loop-kokoro")
edd = json.loads((P / "edd.json").read_text(encoding="utf-8"))
words = json.loads((P / "words.json").read_text(encoding="utf-8"))["words"]
ocr = json.loads((P / "ocr.json").read_text(encoding="utf-8"))


from typing import Annotated, Union


class WordAnchor(BaseModel):
    """A moment defined by speech or the clock: the code turns it into seconds."""
    kind: Literal["word", "clause_end", "seconds"]
    word: str | None = Field(description="the spoken word (for word / clause_end), exactly as in the transcript")
    near: float = Field(description="seconds; which occurrence of the word to use (the one closest to this time)")


class AddZoom(BaseModel):
    op: Literal["add_zoom"]
    start: WordAnchor
    target_text: str = Field(description="on-screen text to zoom into, copied from ON SCREEN")
    end: WordAnchor | None = Field(description="when to zoom back out; null = automatic")
    why: str


class AddSfx(BaseModel):
    op: Literal["add_sfx"]
    at: WordAnchor
    role: Literal["whoosh", "whoosh_short", "pop", "click", "key", "boom", "impact", "rimshot", "ding", "sad_trombone", "laugh"]
    why: str


class Remove(BaseModel):
    op: Literal["remove"]
    item_id: str = Field(description="exactly one id from ITEM IDS")
    why: str


class Retime(BaseModel):
    op: Literal["retime"]
    item_id: str = Field(description="exactly one id from ITEM IDS")
    edge: Literal["start", "end"]
    to: WordAnchor
    why: str


class Ask(BaseModel):
    op: Literal["ask"]
    question: str
    options: list[str] = Field(description="2-4 short choices the user can click")


Op = Annotated[Union[AddZoom, AddSfx, Remove, Retime, Ask], Field(discriminator="op")]


class OpList(BaseModel):
    ops: list[Op]


def items_near(t, span=6):
    out = []
    for b in edd["beats"]:
        for l in b["layers"]:
            s = b["start"] + l["enter"]["at"]
            e = b["start"] + l["exit"]["at"] if "exit" in l else b["end"]
            if s - span <= t <= e + span and not str(l["meta"].get("reason", "")).startswith("continues"):
                out.append(f"{l['id']}: {l['component']} '{l['props'].get('text') or l['props'].get('credit') or ''}' {s:.1f}-{e:.1f}s")
        for i, c in enumerate(b["camera"]):
            s = b["start"] + c["at"]
            e = s + c["inFrames"] / 30 + c["hold"]
            if s - span <= t <= e + span:
                out.append(f"{b['id']}cam{i + 1}: zoom {s:.1f}-{e:.1f}s")
    return out


def pack(t, span=6):
    w = " ".join(f"{x['text']}@{x['start']:.1f}" for x in words if t - span <= x["start"] <= t + span)
    o = [f"{e['text'][:50]!r}" for e in ocr["elements"] if e["from"] <= t <= e["to"] and e["rect"]["h"] < 6][:14]
    return f"TIME {t:.1f}s\nITEMS NEARBY: {items_near(t)}\nWORDS (word@seconds): {w}\nON SCREEN: {o}"


SYSTEM = ("You translate a video editor's plain-English requests into typed edit operations. The video is a screen "
          "recording; you never write code or edit raw JSON. Use only the items and on-screen text in the context pack. "
          "Say WHEN with anchors (a spoken word and roughly where it is), never as invented seconds. If the request is vague, ambiguous "
          "or refers to something not in the pack, return a single `ask` op with clickable options.")

cases = [
    (64.0, "At 1:04 zoom into the Test Condition bullet and add a whoosh."),
    (20.0, "The zoom around 20 seconds comes out too late. Make it end when I finish saying 'once'."),
    (119.7, "Remove the siren sticker, it's too much, and put a rimshot where it was."),
    (50.0, "Make this part less boring."),
]
gw = OpenRouterGateway(timeout_s=120, max_retries=1)
for t, ask in cases:
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"{pack(t)}\n\nREQUEST: {ask}"}]
    t0 = time.time()
    try:
        data, raw = gw.json_schema_chat(SUPER_VL_FREE, msgs, reasoning={"enabled": False}, name="ops", schema=strict_schema(OpList), max_tokens=1500, temperature=0.2)
        print(f"\n[{time.time() - t0:4.1f}s] {ask}")
        for o in data["ops"]:
            print("   ", json.dumps(o)[:300])
    except Exception as e:  # noqa: BLE001
        print(f"\n[{time.time() - t0:4.1f}s] {ask}\n    ERROR {str(e)[:150]}")
