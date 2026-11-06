import subprocess, sys, json, re, statistics, pathlib
vid_dir, out_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
res = {}
for f in sorted(vid_dir.glob("*.mp4")):
    info = json.loads((vid_dir / (f.stem + ".info.json")).read_text(encoding="utf-8"))
    cmd = ["ffmpeg","-hide_banner","-nostats","-i",str(f),"-vf","select='gt(scene,0.06)',metadata=print:file=-","-an","-f","null","-"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    ev=[]; t=None
    for line in p.stdout.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m: t=float(m.group(1))
        m = re.search(r"scene_score=([\d.]+)", line)
        if m and t is not None: ev.append((t,float(m.group(1))))
    dur = info["duration"]
    def stats(th):
        ts=[t for t,s in ev if s>=th]
        iv=[b-a for a,b in zip([0]+ts, ts+[dur])]
        iv=[x for x in iv if x>0.05]
        q=statistics.quantiles(iv,n=4) if len(iv)>3 else [0,0,0]
        return dict(events=len(ts), per_min=round(len(ts)/dur*60,1), median_gap=round(statistics.median(iv),2),
                    p25=round(q[0],2), p75=round(q[2],2), pct_gaps_le_2s=round(100*sum(x<=2 for x in iv)/len(iv),1),
                    pct_gaps_gt_5s=round(100*sum(x>5 for x in iv)/len(iv),1))
    res[f.stem]=dict(title=info["title"], channel=info.get("channel"), duration=dur,
                     hard_cuts=stats(0.30), visual_changes=stats(0.10), subtle_changes=stats(0.06))
    (out_dir/(f.stem+"_events.json")).write_text(json.dumps(ev))
    print(f.stem, json.dumps(res[f.stem]), flush=True)
(out_dir/"summary.json").write_text(json.dumps(res, indent=1))
