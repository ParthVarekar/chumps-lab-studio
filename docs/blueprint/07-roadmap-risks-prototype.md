# 7. Roadmap (L), risks (M) and first prototype (N)

## 7.1 Roadmap

The order is changed from the brief in one important way: **the first rendered, AI-planned video comes before most of the asset system and long before the desktop UI** (prototype N, end of week ~3). Durations assume part-time work with an AI coding assistant **[Estimate]**.

| Phase | Scope | Duration | Measurable completion criteria |
|---|---|---|---|
| **0. Environment** ✅ *done 6 Nov 2026, see [phase-0.md](../progress/phase-0.md)* | Move caches to D: (`HF_HOME`, `UV_CACHE_DIR`, `OLLAMA_MODELS`, npm cache, project root); uv Python 3.12 venv with PyTorch CUDA 12.8 build; update Ollama ≥ 0.40.10; OpenRouter key (free tier) in an environment variable, never in the repo; model gateway smoke test | 1–2 days | `torch.cuda.get_device_capability()` = (12, 0) and a matmul runs; Parakeet transcribes a 60 s clip with word times; one request each to `nemotron-3-ultra-550b-a55b:free` (forced tool call returns valid JSON) and `nemotron-3.5-super-vl:free` (one contact sheet) succeeds, and `GET /api/v1/key` reports the daily free-request ceiling; C: free space not reduced by more than 1 GB |
| **1. Research & architecture** | This blueprint | Done | You approve the architecture, or ask for changes |
| **2. Rendering foundation** ✅ *done 6 Nov 2026, see [phase-2.md](../progress/phase-2.md)* | Remotion project; EDD schema v1 (Zod); 8 core components; look tokens; beat cache; render CLI; benchmark | 1–2 weeks | A hand-written 60 s EDD renders at 1080p30; **benchmark recorded** (fps at 720p/1080p, concurrency 2–8, NVENC vs x264); two renders of the same EDD give identical frame hashes on 30 sampled frames; changing one beat re-renders in ≤ 25 % of full time |
| **N. First prototype** ✅ *3 runs on the Linux video + 3 on a second (C++) video, see [prototype-N.md](../progress/prototype-N.md)* | See §7.3 | +1 week | See §7.3 |
| **3. Personalised editing engine** 🟡 *partly: ingest, ASR, OCR targets, Ultra beat + visual planner, compiler (layout by OCR text coverage + edge density, motion variety, zoom framing, label placement inside the camera view, duplicate-of-footage checks, fact guards), pacing top-up — see [overnight-2026-11-06.md](../progress/overnight-2026-11-06.md); missing: script alignment, prosody, web asset search, style profile* | Ingest, ASR + script alignment, prosody, beat planner (Ultra), visual planner, layout solver, zoom planner, motion chooser, local-library + Pixabay + Openverse search; style profile from 10–15 of your videos | 3–4 weeks | Narration + script → 3 min rendered preview with **no manual step**; median word-timing error < 60 ms vs. hand-marked 2 min sample; pacing metrics within ±20 % of the chosen profile; on blind review you mark ≥ 60 % of AI decisions "keep" |
| **4. Creative asset system** 🟡 *partly: 5 technical components (CodeBlock, Terminal, BarChart, Gauge, NeuralNet), Simple Icons logo library; missing: licence ledger, web sources, SFX, cut-outs* | 15+ technical components (§5.9), moods, evidence-card capture, SFX auto-placement, licence ledger, credits export, cut-outs, optional image generation | 3–4 weeks (overlaps 3) | Every component ships a 6-variation contact sheet that passes geometry QA; an automated test proves no NC/ND/unknown-licence asset can reach a final render; `credits.txt` generated for a real episode |
| **5. Quality assurance loop** 🟡 *partly: geometry checks, settled-frame sampler, Super VL review with ground truth; missing: critique → patch loop, injected-defect test set* | Geometry checks, frame sampler, Super VL rubric, critique → patch, before/after comparison, iteration budget | 2–3 weeks | On a test set of 30 injected defects: ≥ 90 % of geometric and ≥ 60 % of relevance defects detected; no iteration is kept unless its VL pairwise score improves; default ≤ 3 iterations; cost and tokens logged per call |
| **6. Desktop application** 🟡 *v0 works: preview, timeline, inspector, locks, history/undo, render button, AI re-plan (keeps locked/edited items), review notes; missing: script view, asset browser, regenerate-beat, assistant, OTIO export* | Electron shell, Player preview, timeline on `@xzdarcy/react-timeline-editor` (day-1 spike; `dnd-timeline` if it fails, see 3.4), inspector, script view, asset browser, QA panel, locks, history/undo, regenerate-beat, assistant panel, OTIO export | 4–6 weeks | You finish one real episode entirely in the app; across 3 AI iterations, **0 locked nodes changed**; undo/redo across 200 patches; OTIO export opens in DaVinci Resolve with base video + overlay clips in place |
| **7. Optimisation** | GPU scheduler, proxies, parallel beat planning, render profiler, memory limits | Ongoing | 10-minute video: first complete preview ≤ 45 min wall-clock end to end; peak RAM ≤ 18 GB; no VRAM OOM in a full run |
| **8. Style learning** | Every accept/reject/edit becomes training signal: update style profile, add few-shot examples from your corrections, retire presets you keep rejecting | Ongoing | Share of AI decisions you keep rises over 5 consecutive episodes |

## 7.2 Technical risks (M)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Planner taste**: plans are relevant but bland or generic | High | High | Style profile from your videos, few-shot examples from your own corrections, ranked alternatives, budgets and variety memory, human review mode. This is the risk the whole architecture is built around |
| 2 | **Render speed** on a 10-core laptop CPU (Chrome is the bottleneck) | Medium | Medium | Benchmark in Phase 2 with a pass/fail threshold; 720p proxy previews; beat cache; JPEG frames for previews; reduce motion-blur samples. Fallback: HyperFrames or render overlays only and composite footage with FFmpeg |
| 3 | **Headless WebGL on Windows** (Three.js scenes rendering black or slowly) | Medium | Medium | Test `--gl=angle`/`vulkan` early; prerender heavy 3D to ProRes 4444 clips |
| 4 | **Blackwell (sm_120) compatibility**: CTranslate2 int8 fails on RTX 50 (`CUBLAS_STATUS_NOT_SUPPORTED`), PyTorch needs CUDA 12.8+ builds, Python 3.14 lacks wheels | High | Medium | Python 3.12 venv; pinned versions; float16 for faster-whisper; Parakeet via ONNX as a fallback to NeMo |
| 5 | **8 GB VRAM and system-memory contention** (ASR + SAM2 + embeddings + image gen + Chrome GPU), on a PC that already runs at ~38 of 45 GB committed with everyday apps open (measured in Phase 0) | High | Medium | GPU/model scheduler with one heavy model resident; batch jobs per model; unload explicitly; int8 variants as fallback; warn before heavy runs when commit headroom is low |
| 6 | **C: drive at 11.6 GB free** | Certain | High | Phase 0 moves everything to D:; a startup check refuses to run below 5 GB free on the cache drive |
| 7 | **Free tier changes or runs out**: OpenRouter's `:free` variants can be rate-limited at busy times, withdrawn, or have their limits changed; 50 requests/day without the $10 purchase | Medium | Medium | Request-budget-aware gateway (batching, daily counter from `GET /api/v1/key`, resumable runs that continue tomorrow); paid ids and local models as opt-in fallbacks; build.nvidia.com as a second free source |
| 8 | **VL model hallucinates problems** or misses them | Medium | Medium | Geometry checks first; VL must cite an element id and an observation; pairwise before/after; automatic rollback if a "fix" scores worse |
| 9 | **Niche technical assets don't exist** (a specific CPU, an obscure tool) | High | Medium | Evidence capture from real pages and docs; programmatic components; manufacturer press images added by you; generation as last resort |
| 10 | **Copyright claims** (music above all, then memes) | Medium | High (for the channel) | Licence ledger; music only from sources that explicitly cover YouTube monetisation; memes from your curated library |
| 11 | **Scope creep into building a full NLE** | High | High | Hard boundary: anything beyond our timeline (colour grading, advanced audio) goes through OTIO export to DaVinci Resolve |
| 12 | **The "templated" look creeps back over many videos** | Medium | High | Cross-video usage history; look rotation; component library growth; QA rules on repetition across episodes |
| 13 | **Improvement loop oscillates** (fix A breaks B) | Medium | Medium | Accept only monotonic improvements; freeze nodes that passed; iteration budget; human approval for large changes |
| 14 | **Young dependencies churn** (HyperFrames, FilmCraft) | High | Low | Used only as optional backends/exports behind interfaces |
| 15 | **Word-anchored timing breaks** when narration is re-recorded | Low | Medium | Re-alignment maps old word ids to new by text diff; unmatched anchors flagged in QA |

## 7.3 First working prototype (N)

**Goal**: prove the core value: *the system can take your narration and footage and produce a beat-by-beat edit with your kind of layering, zooms and pop-ins that you'd want to keep at least half of.*

### Input

A 60–90 s section of the **Linux video after 9:19**, your chosen baseline, for which you still have the **raw narration, the script (or notes) and the screen recordings**. The best candidate is **10:01–11:19** (the Zorin customisation tour): it uses nearly every device in the baseline (logo pops, zoom-and-hold, labels inside the UI, colour chips, the jelly and Rubik's-cube illustrations), so it tests the most with the least footage, and we can compare directly against your own edit.

### Scope

| In | Out |
|---|---|
| Parakeet transcription + script alignment | Desktop UI (review in Remotion Studio and the EDD JSON) |
| One Ultra call for beats, one per beat for the visual plan | Web asset search beyond Pixabay |
| 8 components: `Footage` (with camera), `SectionTitle` (slide + motion blur), `PopImage`, `BracketLabel`, `EvidenceCard`, `MemeCut`, `CodeHighlight`, `MoodRedTint` | 3D, charts, diagrams |
| Zoom planner using OCR boxes on the screen recording | SAM2 |
| Assets from a local folder you prepare (~30 images/memes) + Pixabay | Image generation |
| Geometry QA + one Super VL pass, printed as a report | Automatic fixing loop |
| CLI render to 1080p30 MP4 | Music, SFX (narration only) |

### Done when

1. One command turns `narration.wav + script.md + recordings/ + assets/` into `edit.mp4` and `edd.json`.
2. Every visual in the output has a `reason` that names the word it belongs to.
3. Its measured pacing (median gap between visual changes) is within ±25 % of your original edit of the same section, and the median visual-to-word offset is within 0.3 s of your measured −0.5 s.
4. Watching it side-by-side with your edit, you rate each beat *better / acceptable / reject*, and **≥ 50 % are better or acceptable**.
5. Re-running it with the same inputs gives the same video.

### Estimated effort

About 1 week after Phase 2, i.e. **3 weeks from starting Phase 0**. API cost for the prototype: $0 on the free tier (~15 requests per run).

## 7.4 What I need from you to start Phase 0/2

1. ~~Approval of the architecture~~ Confirmed 5 Nov 2026, with the decisions in the README.
2. A folder on D: you're happy for the project to own (suggested `D:\ChumpsLabStudio`).
3. The raw material for the prototype section (Linux video 10:01–11:19: narration, script or notes, screen recordings) and a starter folder of the logos/memes/images you reuse.
4. Your OpenRouter API key, set as the `OPENROUTER_API_KEY` environment variable (I'll never write it into a file). Optional: the one-time $10 credit purchase that lifts the free cap from 50 to 1,000 requests/day.
5. If you still have it, the project file of the Linux video (Premiere/Resolve/CapCut), to measure your style from intent, not only pixels.
