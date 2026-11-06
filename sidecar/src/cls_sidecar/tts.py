r"""Placeholder narration for footage that has no voice-over yet.

Takes a script of timed lines and builds one narration track. Each line starts at its `at` time, or right
after the previous line if that one runs long, so the voice stays in step with what is on screen.

Engines: **Kokoro** (default; Kokoro-82M, Apache-2.0, runs locally on the CPU, ~3x real time; model files in
D:\ChumpsLabStudio\models\kokoro) and the Windows built-in voices (`--engine sapi`, robotic, no download).

    uv run python -m cls_sidecar.tts script.json out_dir [--engine kokoro] [--voice am_michael] [--rate 1.05]

script.json: [{"at": 0.8, "text": "Loops. The reason your computer never gets bored."}, ...]
Writes out_dir/narration.wav (48 kHz mono) and out_dir/timing.json (where each line really landed).
It is a stand-in: swap in your own recording later, the rest of the pipeline doesn't change.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

KOKORO_DIR = Path("D:/ChumpsLabStudio/models/kokoro")
SR = 48000
GAP = 0.35  # minimum silence between two lines when one overruns


_KOKORO = None


def _kokoro_speak(text: str, out: Path, voice: str, speed: float) -> None:
    global _KOKORO
    if _KOKORO is None:
        os.environ.setdefault("ONNX_PROVIDER", "CPUExecutionProvider")  # the GPU build can't find cuDNN here, and the CPU is fast enough
        from kokoro_onnx import Kokoro
        _KOKORO = Kokoro(str(KOKORO_DIR / "kokoro-v1.0.onnx"), str(KOKORO_DIR / "voices-v1.0.bin"))
    audio, sr = _KOKORO.create(text, voice=voice, speed=speed, lang="en-us")
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def _speak(text: str, out: Path, voice: str, rate: float, engine: str = "kokoro") -> None:
    if engine == "kokoro":
        return _kokoro_speak(text, out, voice, rate)
    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.SelectVoice('Microsoft {voice} Desktop'); $s.Rate = {int(rate)}; "
        f"$s.SetOutputToWaveFile('{out}'); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], input=text, text=True, encoding="utf-8", check=True)


def _load(path: Path) -> np.ndarray:
    """Any WAV the voice wrote → float32 mono at SR (ffmpeg resamples; no extra Python deps)."""
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def build(script: list[dict], out_dir: Path, voice: str = "am_michael", rate: float = 1.05, engine: str = "kokoro") -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    placed, clips = [], []
    cursor = 0.0
    with tempfile.TemporaryDirectory() as tmp:
        for i, line in enumerate(script):
            wav = Path(tmp) / f"l{i}.wav"
            _speak(line["text"], wav, voice, rate, engine)
            audio = _load(wav)
            start = max(float(line["at"]), cursor + (GAP if i else 0.0))
            end = start + len(audio) / SR
            placed.append({"text": line["text"], "wanted": float(line["at"]), "start": round(start, 2), "end": round(end, 2),
                           "late_by": round(max(0.0, start - float(line["at"])), 2)})
            clips.append((start, audio))
            cursor = end
    total = int((cursor + 1.0) * SR)
    track = np.zeros(total, dtype=np.float32)
    for start, audio in clips:
        a = int(start * SR)
        track[a:a + len(audio)] += audio
    peak = float(np.abs(track).max()) or 1.0
    track *= 0.89 / peak
    pcm = (track * 32767).astype(np.int16)
    with wave.open(str(out_dir / "narration.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    (out_dir / "timing.json").write_text(json.dumps(placed, indent=1, ensure_ascii=False), encoding="utf-8")
    return placed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("script", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--engine", default="kokoro", choices=["kokoro", "sapi"])
    ap.add_argument("--voice", default="am_michael", help="Kokoro: am_michael, am_adam, am_onyx, bm_george … ; SAPI: David or Zira")
    ap.add_argument("--rate", type=float, default=1.05, help="Kokoro speed (1.0 = normal); SAPI -10 … 10")
    args = ap.parse_args()
    placed = build(json.loads(args.script.read_text(encoding="utf-8")), args.out_dir, args.voice, args.rate, args.engine)
    late = [p for p in placed if p["late_by"] > 0.5]
    print(f"{len(placed)} lines, {placed[-1]['end']:.1f} s; {len(late)} started more than 0.5 s late: {[p['text'][:30] for p in late]}")


if __name__ == "__main__":
    main()
