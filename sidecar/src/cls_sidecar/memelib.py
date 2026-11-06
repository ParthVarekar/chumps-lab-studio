r"""Meme library: animated reaction stickers + comedic sounds, every item with a recorded licence.

What goes in is limited to material whose licence allows use in a monetised video:
  * Animated Noto Emoji by Google Fonts, **CC BY 4.0** (credit: "<name> emoji by Google Fonts, CC BY 4.0").
    These are the "💀 😭 🤯" reaction stickers that carry most edit-style memes. Transparent animated WebP.
  * Comedic sounds: Wikimedia Commons files under CC0 / CC BY (a Wilhelm-style scream, sad trombone, rimshot,
    laughter) and CC0 packs from OpenGameArt (level-up, win/lose jingles, alarm, applause).
Not included on purpose: famous meme clips (reaction screenshots, "vine boom", soundboard files). Almost all of
them are unlicensed copyrighted material, and a monetised channel can be claimed over one. Put your own into
D:\ChumpsLabStudio\library\memes\mine\ with a catalog entry (see catalog.json) and the planner will use them.

    uv run python -m cls_sidecar.memelib fetch     # download what's missing and (re)write catalog.json + CREDITS.md
    uv run python -m cls_sidecar.memelib list
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path("D:/ChumpsLabStudio/library/memes")
UA = {"User-Agent": "ChumpsLabStudio/0.1 (personal video editor; asset library)"}
NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/512.webp"

# name, codepoint, tags (what a narrator might be saying), sound role (from sfxlib) or a sound key from SOUNDS below
STICKERS = [
    ("skull", "1f480", "dead dying die died rip cooked killed brutal dies death", "thud"),
    ("loudly-crying", "1f62d", "cry crying sad pain painful tragic suffer suffering misery", "sad"),
    ("exploding-head", "1f92f", "mind blown insane crazy wow whoa unbelievable shocking", "boom"),
    ("fire", "1f525", "fire hot lit awesome amazing burning powerful", "sparkle"),
    ("clown", "1f921", "clown silly dumb joke ridiculous foolish idiot", "rimshot"),
    ("hundred", "1f4af", "perfect hundred 100 flawless nailed", "confirm"),
    ("rotating-light", "1f6a8", "warning alert danger careful beware emergency never infinite endless forever", "alarm"),
    ("rofl", "1f923", "funny laugh laughing hilarious lol joke", "laugh"),
    ("joy", "1f602", "laughing funny haha lol", "laugh"),
    ("thinking", "1f914", "think thinking hmm wonder question why curious", "question"),
    ("party-popper", "1f389", "win won congratulations celebrate success finally done achievement unlocked", "level_up"),
    ("eyes", "1f440", "look watch see notice eyes spot", "tick"),
    ("grimacing", "1f62c", "awkward oops yikes uh-oh careful cringe", "error"),
    ("scream", "1f631", "scream scary horror terrifying panic afraid nightmare", "scream"),
    ("melting", "1fae0", "melt melting overheating embarrassing awkward burning", "boing"),
    ("sunglasses", "1f60e", "cool easy boss pro smooth chill", "ui_open"),
    ("brain", "1f9e0", "brain smart genius clever think intelligent", "bong"),
    ("trophy", "1f3c6", "trophy champion winner achievement reward prize", "level_up"),
    ("rocket", "1f680", "fast speed launch rocket quick boost", "whoosh"),
    ("bomb", "1f4a3", "crash bomb explode blow boom destroy crashes", "boom"),
    ("hourglass", "23f3", "wait waiting time slow forever long hours", "tick"),
    ("zany", "1f92a", "crazy wild chaos chaotic random silly", "boing"),
    ("sweat-smile", "1f605", "nervous relieved phew close whew careful", "boing"),
    ("pleading", "1f97a", "please beg pleading sad puppy", "sad"),
    ("shushing", "1f92b", "quiet secret shh hidden silent", "tick"),
    ("partying-face", "1f973", "party celebrate yay hooray fun", "level_up"),
    ("heart-eyes", "1f60d", "love adore favourite favorite beautiful gorgeous", "sparkle"),
    ("angry", "1f620", "angry mad annoyed furious frustrating frustrated rage", "error"),
    ("handshake", "1f91d", "deal agree agreement together partner", "confirm"),
    ("thumbs-up", "1f44d", "good great ok yes approve nice like", "confirm"),
    ("clap", "1f44f", "applause clap bravo well done congrats", "applause"),
]

# key → (kind, where, url or page, licence, credit)
# kind "commons": title on commons.wikimedia.org; "oga": page on opengameart.org (first audio file taken)
SOUNDS = {
    "scream": ("commons", "File:Cri Wilhelm (Joseph SARDIN).wav", "CC0-1.0", "Joseph Sardin, via Wikimedia Commons"),
    "sad": ("commons", "File:Sad Trombone.wav", "CC-BY-4.0", "Sad Trombone, via Wikimedia Commons"),
    "rimshot": ("commons", "File:Kevin MacLeod assorted rimshots - Bah-dum.wav", "CC-BY-3.0", "Kevin MacLeod (incompetech.com), CC BY 3.0"),
    "laugh": ("commons", "File:72842 lonemonk approx-800-laugh-1.wav", "CC-BY-3.0", "lonemonk, via Freesound / Wikimedia Commons, CC BY 3.0"),
    "level_up": ("oga", "level-up-power-up-coin-get-13-sounds", "CC0-1.0", "OpenGameArt: Level up, power up, Coin get"),
    "alarm": ("oga", "alarm-2", "CC0-1.0", "OpenGameArt: Alarm"),
    "applause": ("oga", "applause-in-a-large-hall-or-church", "CC0-1.0", "OpenGameArt: Applause in a large hall or church"),
}


def _get(url: str, binary: bool = False, retries: int = 5):
    for k in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001 - 429s from Wikimedia: back off
            time.sleep(5 * (k + 1))
    return None


def _commons_url(title: str) -> str | None:
    q = urllib.parse.urlencode({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url", "format": "json"})
    d = _get("https://commons.wikimedia.org/w/api.php?" + q)
    time.sleep(3)
    if not d:
        return None
    pages = json.loads(d).get("query", {}).get("pages", {})
    for p in pages.values():
        ii = p.get("imageinfo")
        if ii:
            return ii[0]["url"]
    return None


def _oga_url(slug: str) -> str | None:
    html = _get(f"https://opengameart.org/content/{slug}")
    if not html:
        return None
    # direct sound files first (skip preview renditions), then a zip
    for ext in ("ogg", "wav", "mp3", "zip"):
        m = re.search(rf'https://opengameart\.org/sites/default/files/(?!styles|audio_preview)[^"\']+\.{ext}', html)
        if m:
            return m.group(0)
    return None


def _to_wav(src: Path, dst: Path, max_len: float = 3.0) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-t", str(max_len), "-ac", "1", "-ar", "48000",
                        "-af", "silenceremove=start_periods=1:start_threshold=-50dB,afade=t=out:st=" + str(max_len - 0.05) + ":d=0.05,alimiter=limit=0.8",
                        str(dst)], capture_output=True)
    return r.returncode == 0 and dst.exists() and dst.stat().st_size > 2000


def fetch() -> dict:
    (ROOT / "stickers").mkdir(parents=True, exist_ok=True)
    (ROOT / "sounds").mkdir(parents=True, exist_ok=True)
    raw = ROOT / "_raw"
    raw.mkdir(exist_ok=True)

    sounds: dict[str, dict] = {}
    for key, (kind, where, licence, credit) in SOUNDS.items():
        out = ROOT / "sounds" / f"{key}.wav"
        if not out.exists():
            url = _commons_url(where) if kind == "commons" else _oga_url(where)
            if not url:
                print(f"  sound {key}: couldn't resolve {where}")
                continue
            data = _get(url, binary=True)
            if not data:
                print(f"  sound {key}: download failed")
                continue
            src = raw / (key + Path(urllib.parse.urlparse(url).path).suffix)
            src.write_bytes(data)
            if src.suffix == ".zip":  # take the first audio file of the pack
                import zipfile
                with zipfile.ZipFile(src) as z:
                    names = [n for n in z.namelist() if n.lower().endswith((".ogg", ".wav", ".mp3")) and "__MACOSX" not in n]
                    if not names:
                        continue
                    z.extract(names[0], raw / key)
                    src = raw / key / names[0]
            if not _to_wav(src, out):
                print(f"  sound {key}: conversion failed")
                continue
        sounds[key] = {"file": f"sounds/{key}.wav", "licence": licence, "credit": credit,
                       "source": where if kind == "oga" else f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(where.replace(' ', '_'))}"}

    memes = []
    for name, cp, tags, sound in STICKERS:
        out = ROOT / "stickers" / f"{name}.webp"
        if not out.exists():
            data = _get(NOTO.format(cp=cp), binary=True)
            if not data:
                print(f"  sticker {name}: not available")
                continue
            out.write_bytes(data)
        memes.append({"id": name, "kind": "sticker", "file": f"stickers/{name}.webp", "tags": tags.split(), "sound": sound,
                      "licence": "CC-BY-4.0", "credit": f"{name.replace('-', ' ').title()} emoji by Google Fonts, CC BY 4.0",
                      "source": f"https://googlefonts.github.io/noto-emoji-animation/"})
    mine = ROOT / "mine" / "catalog.json"
    if mine.exists():  # the user's own memes, same shape
        memes += json.loads(mine.read_text(encoding="utf-8"))
    catalog = {"memes": memes, "sounds": sounds}
    (ROOT / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False), encoding="utf-8")
    credits = ["# Meme library credits", "", "Credit lines required by the CC BY licences (the library also uses CC0 items that need none).", ""]
    credits += sorted({f"- {m['credit']}" for m in memes if m["licence"].startswith("CC-BY")} |
                      {f"- {s['credit']}" for s in sounds.values() if s["licence"].startswith("CC-BY")})
    (ROOT / "CREDITS.md").write_text("\n".join(credits) + "\n", encoding="utf-8")
    return catalog


class MemeLib:
    def __init__(self) -> None:
        p = ROOT / "catalog.json"
        self.catalog = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"memes": [], "sounds": {}}

    def match(self, text: str, context: str = "", used: set[str] | None = None) -> dict | None:
        """Best sticker for a planned meme: overlap between its tags and the planner's text (weight 3) plus the narration (weight 1)."""
        key = re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")
        for m in self.catalog["memes"]:  # the planner is told to answer with a library id: take it at its word
            if m["id"] == key and not (used and m["id"] in used):
                return m
        want = set(re.findall(r"[a-z0-9]{3,}", text.lower()))
        heard = set(re.findall(r"[a-z0-9]{3,}", context.lower()))
        best, score = None, 0.0
        for m in self.catalog["memes"]:
            tags = set(m["tags"]) | {m["id"].replace("-", " ")}
            s = 3 * len(want & tags) + len(heard & tags) - (2 if used and m["id"] in used else 0)
            if s > score:
                best, score = m, s
        return best if score >= 4 else None  # one shared word is not enough ("like" matched thumbs-up)

    def asset(self, rel: str) -> Path:
        return ROOT / rel


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch", "list"])
    args = ap.parse_args()
    cat = fetch() if args.cmd == "fetch" else MemeLib().catalog
    print(f"{len(cat['memes'])} memes, {len(cat['sounds'])} sounds: {sorted(cat['sounds'])}")


if __name__ == "__main__":
    main()
