r"""Sound-effect library: CC0 packs → one normalised, role-tagged catalogue.

Sources (all CC0, from OpenGameArt.org, a long-running open collection; Kenney's packs are the best known):
see PACKS below and the ledger this writes next to the catalogue (LICENSES.md). Raw downloads live in
D:\ChumpsLabStudio\library\sfx\<pack>\ ; `build()` turns them into
D:\ChumpsLabStudio\library\sfx\lib\<role>\<id>.wav (48 kHz mono, silence trimmed, peak-normalised, short fade
out) and catalog.json. The compiler asks the catalogue for a role ("whoosh", "key", "pop", …); a pick is
deterministic for a given event id, so re-planning doesn't reshuffle the sounds.

    uv run python -m cls_sidecar.sfxlib            # (re)build the library from the downloaded packs
    uv run python -m cls_sidecar.sfxlib --list     # roles and counts
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

SFX_DIR = Path("D:/ChumpsLabStudio/library/sfx")
SR = 48000

# pack folder → (title, author as stated on the page, page URL)
PACKS = {
    "kenney_interfaceSounds": ("Interface Sounds", "Kenney", "https://opengameart.org/content/interface-sounds"),
    "swishes": ("Swishes Sound Pack", "qubodup", "https://opengameart.org/content/swishes-sound-pack"),
    "qubodup-timehitwind": ("Wind, hit, time morph", "qubodup", "https://opengameart.org/content/wind-hit-time-morph"),
    "sound_effects": ("18 random video game sound effects", "HaelDB", "https://opengameart.org/content/18-random-video-game-sound-effects"),
    "rpg_sound_pack": ("RPG Sound Pack", "artisticdude", "https://opengameart.org/content/rpg-sound-pack"),
    "sci-fi_sounds": ("Sci-Fi Sounds (Kenney's pack)", "Kenney", "https://opengameart.org/content/sci-fi-sounds"),
    "unicae_games_keyboard_soundpack_1_0": ("Keyboard Soundpack #1", "Unicae Games", "https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes"),
    "_single": ("Air whoosh", "see page", "https://opengameart.org/content/air-whoosh"),
}

# (pack, glob relative to the pack folder, role). The first matching rule wins; a pack's files can feed several roles.
RULES: list[tuple[str, str, str]] = [
    ("swishes", "swishes/swish-*.wav", "whoosh"),
    ("sound_effects", "sound_effects/whoosh*.wav", "whoosh"),
    ("_single", "whoosh2_0.wav", "whoosh"),
    ("qubodup-timehitwind", "*megaswosh*.wav", "whoosh_long"),
    ("kenney_interfaceSounds", "**/click_*.ogg", "click"),
    ("kenney_interfaceSounds", "**/tick_*.ogg", "tick"),
    ("kenney_interfaceSounds", "**/select_*.ogg", "select"),
    ("kenney_interfaceSounds", "**/toggle_*.ogg", "toggle"),
    ("kenney_interfaceSounds", "**/switch_*.ogg", "switch"),
    ("kenney_interfaceSounds", "**/pluck_*.ogg", "pop"),
    ("kenney_interfaceSounds", "**/drop_*.ogg", "drop"),
    ("kenney_interfaceSounds", "**/confirmation_*.ogg", "confirm"),
    ("kenney_interfaceSounds", "**/question_*.ogg", "question"),
    ("kenney_interfaceSounds", "**/error_*.ogg", "error"),
    ("kenney_interfaceSounds", "**/glitch_*.ogg", "glitch"),
    ("kenney_interfaceSounds", "**/scratch_*.ogg", "scratch"),
    ("kenney_interfaceSounds", "**/scroll_*.ogg", "scroll"),
    ("kenney_interfaceSounds", "**/maximize_*.ogg", "ui_open"),
    ("kenney_interfaceSounds", "**/open_*.ogg", "ui_open"),
    ("kenney_interfaceSounds", "**/minimize_*.ogg", "ui_close"),
    ("kenney_interfaceSounds", "**/close_*.ogg", "ui_close"),
    ("kenney_interfaceSounds", "**/glass_*.ogg", "glass"),
    ("kenney_interfaceSounds", "**/bong_*.ogg", "bong"),
    ("sound_effects", "sound_effects/thump.wav", "thud"),
    ("sound_effects", "sound_effects/boing.wav", "boing"),
    ("sound_effects", "sound_effects/invalid.wav", "error"),
    ("sound_effects", "sound_effects/bloops.wav", "bloop"),
    ("rpg_sound_pack", "**/bubble*.wav", "pop"),
    ("rpg_sound_pack", "**/coin*.wav", "coin"),
    ("rpg_sound_pack", "**/magic1.wav", "sparkle"),
    ("sci-fi_sounds", "**/impactMetal_*.ogg", "impact"),
    ("sci-fi_sounds", "**/explosionCrunch_*.ogg", "boom"),
    ("sci-fi_sounds", "**/forceField_*.ogg", "force"),
    ("sci-fi_sounds", "**/laserSmall_*.ogg", "zap"),
    ("unicae_games_keyboard_soundpack_1_0", "**/Single Keys/*.wav", "key"),
    ("unicae_games_keyboard_soundpack_1_0", "**/Human Typing/*.wav", "typing"),
    ("unicae_games_keyboard_soundpack_1_0", "**/Generated Typing/*.wav", "typing_fast"),
]
# Longest a clip of this role may be (longer files are cut with a short fade) and the loudest it may peak.
MAX_LEN = {"whoosh": 1.2, "whoosh_long": 1.6, "typing": 3.0, "typing_fast": 3.0, "boom": 1.8, "force": 1.2, "glitch": 0.6,
           "key": 0.25, "click": 0.3, "tick": 0.3, "scroll": 0.8, "thud": 0.8}
DEFAULT_MAX = 1.5


def _decode(path: Path) -> np.ndarray | None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return np.frombuffer(r.stdout, dtype=np.float32).copy()


def _clean(a: np.ndarray, max_len: float) -> np.ndarray | None:
    """Trim silence at both ends, cap the length, fade out, peak-normalise to -2 dBFS."""
    loud = np.flatnonzero(np.abs(a) > 0.01)
    if loud.size == 0:
        return None
    a = a[max(0, loud[0] - int(0.005 * SR)): loud[-1] + int(0.02 * SR)]
    a = a[: int(max_len * SR)]
    fade = min(len(a), int(0.03 * SR))
    a[-fade:] *= np.linspace(1, 0, fade)
    a *= 0.8 / (float(np.abs(a).max()) or 1.0)
    return a if len(a) > int(0.03 * SR) else None


def _write(path: Path, a: np.ndarray) -> None:
    import wave
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())


def build() -> list[dict]:
    catalog, seen = [], set()
    for pack, pattern, role in RULES:
        base = SFX_DIR if pack == "_single" else SFX_DIR / pack
        for f in sorted(base.glob(pattern)):
            if "__MACOSX" in f.parts or f.name.startswith("._") or f in seen:
                continue
            seen.add(f)
            a = _decode(f)
            a = _clean(a, MAX_LEN.get(role, DEFAULT_MAX)) if a is not None else None
            if a is None:
                continue
            clip_role = "whoosh_short" if role == "whoosh" and len(a) / SR < 0.25 else role  # quick swipes vs real whooshes
            uid = f"{clip_role}-{hashlib.sha1(f.name.encode()).hexdigest()[:6]}-{f.stem}".replace(" ", "_")
            out = SFX_DIR / "lib" / clip_role / f"{uid}.wav"
            _write(out, a)
            title, author, url = PACKS[pack]
            catalog.append({"id": uid, "role": clip_role, "file": f"lib/{clip_role}/{uid}.wav", "duration": round(len(a) / SR, 3),
                            "source": {"pack": title, "author": author, "url": url, "licence": "CC0-1.0"}})
    (SFX_DIR / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False), encoding="utf-8")
    ledger = ["# Sound-effect licence ledger", "",
              "Every effect in this library is **CC0-1.0** (public domain dedication), taken from OpenGameArt.org packs. Credit is not required;",
              "the packs and authors are listed for the record (author as shown on each page; verify on the page before a commercial release).", ""]
    for pack, (title, author, url) in PACKS.items():
        n = sum(1 for c in catalog if c["source"]["url"] == url)
        ledger.append(f"- **{title}** by {author}: {n} clips used. {url}")
    (SFX_DIR / "LICENSES.md").write_text("\n".join(ledger) + "\n", encoding="utf-8")
    return catalog


class Sfx:
    """Picks effects by role. Deterministic: the same (role, key) always gives the same clip."""

    def __init__(self) -> None:
        path = SFX_DIR / "catalog.json"
        self.items = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        self.by_role: dict[str, list[dict]] = {}
        for c in self.items:
            self.by_role.setdefault(c["role"], []).append(c)

    def has(self, role: str) -> bool:
        return bool(self.by_role.get(role))

    def pick(self, role: str, key: str, avoid: set[str] | None = None) -> dict | None:
        pool = self.by_role.get(role) or []
        if not pool:
            return None
        start = int(hashlib.sha1(f"{role}:{key}".encode()).hexdigest(), 16) % len(pool)
        for k in range(len(pool)):  # first one not used recently, starting at the keyed position
            c = pool[(start + k) % len(pool)]
            if not avoid or c["id"] not in avoid:
                return c
        return pool[start]

    def path(self, clip: dict) -> Path:
        return SFX_DIR / clip["file"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    cat = Sfx().items if args.list else build()
    roles: dict[str, int] = {}
    for c in cat:
        roles[c["role"]] = roles.get(c["role"], 0) + 1
    print(f"{len(cat)} clips; roles: {json.dumps(roles)}")


if __name__ == "__main__":
    main()
