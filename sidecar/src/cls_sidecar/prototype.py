"""Prototype N: narration + footage → AI-planned, rendered edit, with QA report. One command.

  uv run python -m cls_sidecar.prototype D:\\ChumpsLabStudio\\projects\\proto-linux-1001 [--replan] [--no-vl]

Expects in the project folder: media/footage.mp4, media/narration.m4a, media/narration_16k.wav.
Optional: reference/changes.json (scene-change events of the original edit, for the pacing comparison).
Model requests: 2 (Nemotron 3 Ultra) + 1 per 12 reviewed frames (Nemotron 3.5 Super VL).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import cls_sidecar  # noqa: F401
from cls_sidecar import asr, ocr, qa
from cls_sidecar.compiler import compile_plan
from cls_sidecar.gateway import OpenRouterGateway
from cls_sidecar.merge import preserve_user_edits
from cls_sidecar.planner import BeatSheet, VisualPlan, beat_target, plan_beats, plan_topup, plan_visuals, usage_of

ENGINE = Path(__file__).resolve().parents[3] / "engine"


def find_shortfalls(compiled, sheet: BeatSheet, plan: VisualPlan) -> list[dict]:
    """Beats whose compiled visual events (new layers + camera moves) fall short of their pacing target."""
    out = []
    for bi, (b, pb) in enumerate(zip(compiled.edd["beats"], sheet.beats)):
        layers = [l for l in b["layers"] if not str(l["meta"].get("reason", "")).startswith("continues header")]
        have = len(layers) + len(b["camera"])
        need = beat_target(b["end"] - b["start"], pb.pacing)
        if have < need:
            planned = [f"{v.device} on word {v.anchor_word}" for v in plan.visuals if v.beat == bi]
            dropped = [f"{d['device']}: {d['why']}" for d in compiled.dropped if d["id"].startswith(f"b{bi + 1}v")]
            out.append({"beat": bi, "start": b["start"], "end": b["end"], "have": have, "need": need, "planned": planned, "dropped": dropped,
                        "room": getattr(compiled, "room", {}).get(bi)})
    return out


def _load_or(path: Path, build):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = build()
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    return data


def run(project: Path, replan: bool, use_vl: bool) -> Path:
    timings: dict[str, float] = {}
    requests: list[dict] = []
    t0 = time.perf_counter()

    words_doc = _load_or(project / "words.json", lambda: asr.transcribe(project / "media" / "narration_16k.wav"))
    timings["asr"] = time.perf_counter() - t0
    t1 = time.perf_counter()
    ocr_doc = _load_or(project / "ocr.json", lambda: ocr.scan(project / "media" / "footage.mp4"))
    timings["ocr"] = time.perf_counter() - t1
    # The speech model writes "<unk>" for sounds it can't spell (it heard "C++" as "C<unk>"): strip it, drop empty words.
    words = [{**w, "text": w["text"].replace("<unk>", "")} for w in words_doc["words"]]
    words = [w for w in words if w["text"].strip()]
    duration = round(ocr_doc["duration"], 3)

    gw = OpenRouterGateway()
    sheet_path, plan_path = project / "plan.beats.json", project / "plan.visuals.json"
    t2 = time.perf_counter()
    if replan or not sheet_path.exists():
        sheet, raw = plan_beats(gw, words)
        sheet_path.write_text(sheet.model_dump_json(indent=1), encoding="utf-8")
        requests.append({"call": "beat sheet (Ultra)", **usage_of(raw)})
    sheet = BeatSheet.model_validate_json(sheet_path.read_text(encoding="utf-8"))
    if replan or not plan_path.exists():
        plan, raw = plan_visuals(gw, words, sheet, ocr_doc)
        plan_path.write_text(plan.model_dump_json(indent=1), encoding="utf-8")
        requests.append({"call": "visual plan (Ultra)", **usage_of(raw)})
    plan = VisualPlan.model_validate_json(plan_path.read_text(encoding="utf-8"))

    compiled = compile_plan(words, sheet, plan, ocr_doc, duration, project)

    # Pacing top-up: one extra request for beats that came out short after layout rejected things.
    shortfalls = find_shortfalls(compiled, sheet, plan)
    first_shortfalls = shortfalls
    # Up to two top-up rounds. The first asks for every short beat; if the model skips some (raw-loop run:
    # it planned beats 0-6 and ignored 7-9), the second asks only for beats still under half their target.
    for round_no, name in enumerate(["plan.topup.json", "plan.topup2.json"], start=1):
        if round_no == 2:
            shortfalls = [s_ for s_ in find_shortfalls(compiled, sheet, plan) if s_["have"] < s_["need"] / 2]
        if not shortfalls:
            break
        topup_path = project / name
        if replan or not topup_path.exists():
            # Optional request: a short timeout and one retry; the run continues without it if the free
            # endpoint is overloaded. httpx timeouts only bound the gap between bytes (a "180 s" call took
            # 420 s), so the deadline is enforced from outside, on a daemon thread that can't block exit.
            box: dict = {}
            def _call(sf=shortfalls):
                try:
                    box["result"] = plan_topup(OpenRouterGateway(timeout_s=180, max_retries=1), words, sheet, ocr_doc, sf)
                except Exception as exc:  # noqa: BLE001
                    box["error"] = exc
            worker = threading.Thread(target=_call, daemon=True)
            worker.start()
            worker.join(timeout=240)
            if "result" in box:
                extra, raw = box["result"]
                topup_path.write_text(extra.model_dump_json(indent=1), encoding="utf-8")
                requests.append({"call": f"pacing top-up round {round_no} for {len(shortfalls)} beats (Ultra)", **usage_of(raw)})
            else:
                why = str(box.get("error", "no answer within 240 s"))[:120]
                requests.append({"call": f"pacing top-up round {round_no} for {len(shortfalls)} beats (Ultra) - skipped: {why}"})
        if topup_path.exists():
            extra = VisualPlan.model_validate_json(topup_path.read_text(encoding="utf-8"))
            plan = VisualPlan(visuals=plan.visuals + extra.visuals)
            compiled = compile_plan(words, sheet, plan, ocr_doc, duration, project)
    compiled.shortfalls_before_topup = first_shortfalls
    timings["planning"] = time.perf_counter() - t2
    edd_path = project / "edd.json"
    # Locked and user-edited items from the previous document survive the new AI plan.
    previous = json.loads(edd_path.read_text(encoding="utf-8")) if edd_path.exists() else None
    compiled.edd, merge_report = preserve_user_edits(previous, compiled.edd)
    compiled.merge_report = merge_report
    edd_path.write_text(json.dumps(compiled.edd, indent=1, ensure_ascii=False), encoding="utf-8")

    ocr.release_engine()  # the render needs the memory more
    t3 = time.perf_counter()
    r = subprocess.run(["npx.cmd", "tsx", "scripts/render.ts", str(edd_path), "--concurrency", "6"], cwd=ENGINE,
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"render failed:\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
    render = project / "renders" / "edd-1080p-x264-veryfast-crf18.mp4"
    render_report = json.loads((render.parent / (render.name + ".report.json")).read_text())
    timings["render"] = time.perf_counter() - t3

    ref = project / "reference" / "changes.json"
    reference = json.loads(ref.read_text()) if ref.exists() else None
    geo = qa.geometry(compiled.edd, reference)

    vl_issues, vl_meta = [], []
    if use_vl:
        t4 = time.perf_counter()
        vl_issues, vl_meta = qa.vl_review(gw, compiled.edd, render, project / "qa")
        timings["vl_review"] = time.perf_counter() - t4
        for m in vl_meta:
            u = m["usage"]
            requests.append({"call": f"frame review sheet {m['sheet']} (Super VL)", "prompt_tokens": u.get("prompt_tokens"),
                             "completion_tokens": u.get("completion_tokens"),
                             "reasoning_tokens": (u.get("completion_tokens_details") or {}).get("reasoning_tokens")})
    timings["total"] = time.perf_counter() - t0

    report = {
        "project": str(project), "render": str(render), "duration_s": duration,
        "beats": len(compiled.edd["beats"]), "layers": sum(len(b["layers"]) for b in compiled.edd["beats"]),
        "camera_moves": sum(len(b["camera"]) for b in compiled.edd["beats"]),
        "moods": sum(len(b["moods"]) for b in compiled.edd["beats"]),
        "planned_visuals": len(plan.visuals), "asset_hits": compiled.asset_hits, "asset_misses": compiled.asset_misses,
        "dropped": compiled.dropped, "retargeted": compiled.retargeted, "converted": compiled.converted,
        "shortfalls_before_topup": getattr(compiled, "shortfalls_before_topup", []),
        "kept_user_edits": getattr(compiled, "merge_report", {}), "geometry": geo, "vl_issues": vl_issues, "vl_sheets": vl_meta,
        "render_stats": {k: render_report[k] for k in ("totalFrames", "renderedFrames", "beatsSeconds", "renderFps", "totalSeconds")},
        "timings_s": {k: round(v, 1) for k, v in timings.items()}, "requests": requests,
    }
    (project / "prototype_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    write_markdown(project, report, compiled.edd, words)
    return project / "prototype_report.md"


def write_markdown(project: Path, rep: dict, edd: dict, words: list[dict]) -> None:
    L = [f"# Prototype run — {project.name}", "",
         f"Render: `{rep['render']}`  ", f"{rep['duration_s']} s · {rep['beats']} beats · {rep['layers']} layers · "
         f"{rep['camera_moves']} camera moves · {rep['moods']} moods (from {rep['planned_visuals']} planned visuals)", "",
         "## Decisions (every visual names its word)", "", "| Beat | Time | Component | What | Why |", "|---|---|---|---|---|"]
    for b in edd["beats"]:
        items = [(b["start"] + l["enter"]["at"], l["component"], l["props"].get("text") or Path(str(l["props"].get("src", ""))).stem or l["props"].get("color"), l["meta"].get("reason", ""))
                 for l in b["layers"]]
        items += [(b["start"] + c["at"], "Camera", f"zoom to ({c['to']['x']:.0f},{c['to']['y']:.0f}) {c['to']['w']:.0f}%", c["meta"].get("reason", "")) for c in b["camera"]]
        items += [(b["start"] + m["at"], "Mood", m["kind"], m["meta"].get("reason", "")) for m in b["moods"]]
        for t, comp, what, why in sorted(items):
            L.append(f"| {b['id']} | {t:.1f}s | {comp} | {what} | {why} |")
    p = rep["geometry"]["pacing"]
    L += ["", "## Pacing", "", f"- Ours: {p['events']} visual events, **{p['per_min']}/min**, median gap {p['median_gap']} s, gaps > 5 s: {p['pct_gaps_gt_5s']} %"]
    if "reference" in p:
        L.append(f"- Original edit (same section, scene changes ≥ 0.10): {p['reference']['per_min']}/min, median gap {p['reference']['median_gap']} s")
    L += ["", "## Assets", "", f"- Logo hits: {', '.join(h['icon'] for h in rep['asset_hits']) or 'none'}",
          f"- Misses (fell back or used a placeholder): {json.dumps(rep['asset_misses'], ensure_ascii=False)}",
          f"- Dropped visuals: {json.dumps(rep['dropped'], ensure_ascii=False)}",
          f"- Retargeted (planner's target wasn't on screen at that moment): {json.dumps(rep.get('retargeted', []), ensure_ascii=False)}",
          f"- Turned into quick zooms on matching on-screen text (the original couldn't be placed): {json.dumps(rep.get('converted', []), ensure_ascii=False)}",
          f"- Beats short of their pacing target before the top-up request: "
          f"{[(s['beat'], s['have'], s['need']) for s in rep.get('shortfalls_before_topup', [])]} (beat, had, needed)", "",
          "## Geometry checks", ""]
    L += [f"- {i['type']} at {i['t']} s: {', '.join(i['layers'])} (severity {i['severity']})" for i in rep["geometry"]["issues"]] or ["- none"]
    L += ["", "## Super VL review", ""]
    for m in rep["vl_sheets"]:
        L.append(f"- Sheet {m['sheet']} ({m['tiles']} frames): {m['overall']}")
    L += [f"- [{i['type']}, sev {i['severity']}] {i['element']} @ {i['t']} s — {i['observation']} → {i['suggestion']}" for i in rep["vl_issues"]] or ["- no issues reported"]
    L += ["", "## Cost and time", "", f"- Timings (s): {rep['timings_s']}", f"- Render: {rep['render_stats']}"]
    L += [f"- {r['call']}: {r.get('prompt_tokens')} in / {r.get('completion_tokens')} out ({r.get('reasoning_tokens')} reasoning)" for r in rep["requests"]]
    (project / "prototype_report.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("--replan", action="store_true")
    ap.add_argument("--no-vl", action="store_true")
    args = ap.parse_args()
    # The report has characters like "≥"; a Windows console (cp1252) would crash on them at the very end
    # and the app's AI re-plan button would report a failed run.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    out = run(args.project, args.replan, not args.no_vl)
    print(out.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
