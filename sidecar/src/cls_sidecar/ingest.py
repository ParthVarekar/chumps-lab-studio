"""Project ingest (blueprint §5.2 stage 1): raw footage + narration → a ready project folder.

  uv run python -m cls_sidecar.ingest <project_name> --footage rec1.mp4 [rec2.mp4 …] --narration voice.wav
        [--script script.md] [--start 0] [--duration 78] [--no-asr] [--no-ocr]

Creates D:\\ChumpsLabStudio\\projects\\<project_name>\\ with:
  media/footage.mp4        1080p 30 fps proxy (several recordings are joined in order)
  media/narration.m4a      AAC for rendering;  media/narration_16k.wav  for speech-to-text
  analysis/media.json      ffprobe metadata of every source
  analysis/shots.json      shot boundaries in the proxy (scene changes ≥ 0.3)
  analysis/loudness.json   integrated loudness (LUFS) and true peak of the narration
  words.json, ocr.json     transcription and on-screen text (unless disabled)
  project.json             manifest
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import cls_sidecar  # noqa: F401
from cls_sidecar.paths import PROJECTS_DIR, ensure_free_space


def _run(args: list[str]) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {r.stderr[-1500:]}")
    return r


def probe(path: Path) -> dict:
    r = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    d = json.loads(r.stdout)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    num, den = (v["r_frame_rate"].split("/") if v else ("0", "1"))
    return {
        "path": str(path), "duration": round(float(d["format"].get("duration", 0)), 3),
        "video": {"codec": v["codec_name"], "width": v["width"], "height": v["height"], "fps": round(int(num) / max(1, int(den)), 3)} if v else None,
        "audio": {"codec": a["codec_name"], "sample_rate": int(a["sample_rate"]), "channels": a["channels"]} if a else None,
    }


def make_proxy(sources: list[Path], out: Path, start: float | None, duration: float | None) -> None:
    """Join recordings and transcode to 1080p 30 fps H.264 (NVENC), keyframe every second for fast seeking."""
    trim = (["-ss", str(start)] if start else []) + (["-t", str(duration)] if duration else [])
    vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
    enc = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-g", "30"]
    if len(sources) == 1:
        _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *trim, "-i", str(sources[0]), "-an", "-vf", vf, *enc, str(out)])
        return
    inputs = sum((["-i", str(s)] for s in sources), [])
    chains = "".join(f"[{i}:v]{vf}[v{i}];" for i in range(len(sources)))
    concat = "".join(f"[v{i}]" for i in range(len(sources))) + f"concat=n={len(sources)}:v=1:a=0[cat]"
    last = "[cat]" + (f"trim=start={start or 0}" + (f":duration={duration}" if duration else "") + ",setpts=PTS-STARTPTS[out]" if (start or duration) else "null[out]")
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", chains + concat + ";" + last,
          "-map", "[out]", "-an", *enc, str(out)])


def detect_shots(video: Path, threshold: float = 0.3) -> list[dict]:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vf",
                        f"select='gt(scene,{threshold})',metadata=print:file=-", "-an", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    cuts, t = [], None
    for line in r.stdout.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
        m = re.search(r"scene_score=([\d.]+)", line)
        if m and t is not None:
            cuts.append({"t": round(t, 3), "score": round(float(m.group(1)), 3)})
    return cuts


def loudness(audio: Path) -> dict:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio), "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        return {}
    d = json.loads(m.group(0))
    return {"integrated_lufs": float(d["input_i"]), "true_peak_db": float(d["input_tp"]), "lra": float(d["input_lra"]),
            "youtube_target_lufs": -14.0, "gain_to_target_db": round(-14.0 - float(d["input_i"]), 2)}


def ingest(name: str, footage: list[Path], narration: Path, script: Path | None = None, start: float | None = None,
           duration: float | None = None, asr_on: bool = True, ocr_on: bool = True) -> Path:
    ensure_free_space()
    project = PROJECTS_DIR / name
    (project / "media").mkdir(parents=True, exist_ok=True)
    (project / "analysis").mkdir(exist_ok=True)
    timings: dict[str, float] = {}

    t = time.perf_counter()
    sources = [probe(p) for p in footage] + [probe(narration)]
    (project / "analysis" / "media.json").write_text(json.dumps(sources, indent=1), encoding="utf-8")
    timings["probe"] = time.perf_counter() - t

    t = time.perf_counter()
    make_proxy(footage, project / "media" / "footage.mp4", start, duration)
    timings["proxy"] = time.perf_counter() - t

    t = time.perf_counter()
    trim = (["-ss", str(start)] if start else []) + (["-t", str(duration)] if duration else [])
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *trim, "-i", str(narration), "-vn", "-c:a", "aac", "-b:a", "192k",
          str(project / "media" / "narration.m4a")])
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(project / "media" / "narration.m4a"), "-ac", "1", "-ar", "16000",
          "-c:a", "pcm_s16le", str(project / "media" / "narration_16k.wav")])
    (project / "analysis" / "loudness.json").write_text(json.dumps(loudness(project / "media" / "narration.m4a"), indent=1), encoding="utf-8")
    timings["audio"] = time.perf_counter() - t

    t = time.perf_counter()
    shots = detect_shots(project / "media" / "footage.mp4")
    (project / "analysis" / "shots.json").write_text(json.dumps(shots, indent=1), encoding="utf-8")
    timings["shots"] = time.perf_counter() - t

    if script:
        shutil.copyfile(script, project / "script.md")
    if asr_on:
        from cls_sidecar import asr

        t = time.perf_counter()
        (project / "words.json").write_text(json.dumps(asr.transcribe(project / "media" / "narration_16k.wav"), indent=1, ensure_ascii=False), encoding="utf-8")
        timings["asr"] = time.perf_counter() - t
    if ocr_on:
        from cls_sidecar import ocr

        t = time.perf_counter()
        (project / "ocr.json").write_text(json.dumps(ocr.scan(project / "media" / "footage.mp4"), indent=1, ensure_ascii=False), encoding="utf-8")
        timings["ocr"] = time.perf_counter() - t

    manifest = {"name": name, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "sources": [str(p) for p in footage],
                "narration": str(narration), "script": str(script) if script else None, "trim": {"start": start, "duration": duration},
                "shots": len(shots), "timings_s": {k: round(v, 1) for k, v in timings.items()}}
    (project / "project.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return project


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest raw footage + narration into a studio project")
    ap.add_argument("name")
    ap.add_argument("--footage", type=Path, nargs="+", required=True)
    ap.add_argument("--narration", type=Path, required=True)
    ap.add_argument("--script", type=Path)
    ap.add_argument("--start", type=float)
    ap.add_argument("--duration", type=float)
    ap.add_argument("--no-asr", action="store_true")
    ap.add_argument("--no-ocr", action="store_true")
    a = ap.parse_args()
    project = ingest(a.name, a.footage, a.narration, a.script, a.start, a.duration, not a.no_asr, not a.no_ocr)
    print(json.dumps(json.loads((project / "project.json").read_text()), indent=1))


if __name__ == "__main__":
    main()
