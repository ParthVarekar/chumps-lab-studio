# 6. Assets (H), costs (J) and licensing (K)

## 6.1 Asset acquisition and management (H)

### Source priority

The system searches in this order and stops when it has enough good candidates for a slot:

| # | Source | What it's good for | Access / limits [Verified 5 Nov 2026] | Licence handling |
|---|---|---|---|---|
| 1 | **Your local library** (past projects, memes, SFX, screenshots) | Your recurring jokes and visual vocabulary | Local | You tag the licence once per folder |
| 2 | **Live captures** (Playwright) | "Evidence cards": the real article, docs page, GitHub repo, benchmark table, tweet being discussed, with the quoted sentence found in the DOM and highlighted | Local headless Chrome | Screenshots of third-party pages: commentary use; record URL + capture time |
| 3 | **Programmatic graphics** (our components) | Charts, diagrams, chips, networks, terminals, maps | Local | Ours |
| 4 | **Pixabay API** (images, video, music, SFX) | Generic B-roll, objects, textures | Free key; 100 requests / 60 s; responses must be cached 24 h; no permanent hotlinking | Pixabay Content License: no attribution required; no standalone redistribution; care with trademarks |
| 5 | **Openverse API** | CC and public-domain images | No key: 20 requests/min, 200/day anonymous (more with a free registered client) | Per item; ledger stores licence + attribution string; **exclude NC and ND** (monetised video is commercial; ND forbids crops/cut-outs) |
| 6 | **Wikimedia Commons API** | Hardware photos, historical images, logos, people of note | No key, be polite and serial | Per file (`extmetadata`) |
| 7 | **Unsplash API** | High-quality photos | 50 requests/hour in demo mode | Unsplash License; API guidelines require crediting photographer + Unsplash |
| 8 | **Pexels API** | Photos/video | 200/hour, 20,000/month — but **new API key issuance is paused** as of this week | Attribution requested |
| 9 | **Iconify** (+ Simple Icons for brand logos) | Icons, logos | Local npm packages, offline | Per icon set; filter to MIT/Apache/CC0/CC-BY sets; logos are trademarks (fine for commentary) |
| 10 | **Lottie** (LottieFiles free) | Animated icons/reactions | Download manually or via API | Per file (Lottie Simple License for free ones; verify) |
| 11 | **Freesound API** | SFX | Free key | **CC0 / CC-BY only**; exclude CC-BY-NC |
| 12 | **GIPHY API** | Reaction GIFs | Beta key **100 calls/hour**; terms prohibit caching/proxying and require "Powered by GIPHY" where the API is used | Use only for *discovery*; save the ones you choose into your own meme library manually |
| 13 | **Local image generation** (FLUX.2 [klein] 4B) | Filler illustrations, backgrounds, concept art when nothing exists | Local, ~5–15 s per image [Estimate] | Apache-2.0 model; outputs yours |

**Not used**: Tenor (API shut down 30 June 2026 [Verified]); general Google/Bing image scraping (licence unknown, fragile). A self-hosted **SearXNG** is an optional discovery tool, but anything found through it enters the library as "licence unknown" and is blocked from final renders until you clear it.

### Pipeline for every asset

```
slot (from planner) ─► query generation (local LLM: 3–5 queries, incl. synonyms and visual descriptions)
     ─► local search (LanceDB, Qwen3-VL-Embedding, text ↔ image)
     ─► provider search (in priority order, rate-limited, cached)
     ─► download to quarantine/ (separate folder, never executed, size/type checked)
     ─► dedupe (perceptual hash + embedding cosine > 0.95 → same asset)
     ─► enrich: SigLIP 2 zero-shot tags · VLM caption · OCR text · dominant colours · aspect · faces
     ─► rank for the slot: embedding similarity → Qwen3-VL reranker → style fit (colour/look) → licence score
     ─► prepare: crop to subject (SAM2), cut-out if requested (BiRefNet), upscale only if < target size
     ─► library: content-addressed file + SQLite row + vector
```

### Library layout (on D:)

```
D:\ChumpsLabStudio\library\
  files\ab\cd\abcdef…  (content-addressed originals)
  derived\…            (crops, cut-outs, proxies)
  library.sqlite       (assets, tags, sources, licences, usage history)
  vectors.lance\       (image / text / video embeddings)
```

Every asset row records: source URL, provider, author, licence id + URL, attribution text, retrieved date, file hash, **usage history** (which videos, which timestamps). The usage history feeds the repetition check ("don't reuse this meme within 3 videos").

At export, the app writes `credits.txt` for the YouTube description from the ledger, listing every asset that requires attribution.

## 6.2 Cost breakdown (J)

### Token assumptions for a 10-minute video [Estimate]

| Call group | Ultra input | Ultra output (incl. reasoning) |
|---|---|---|
| Global plan (1 call) | 15K | 16K |
| Per-beat plans (~60 calls; ~80 % of input cached) | 600K | 270K |
| New components (~3) | 45K | 45K |
| Improvement passes (2 × ~20 calls) | 320K | 120K |
| **Total** | **~980K** (≈ 600K cached) | **~450K** |

| Call group | Super VL input | Super VL output |
|---|---|---|
| 3 review passes × ~42 contact sheets (6 frames each) + ~20 short clips | ~1.0M | ~190K |

### Chosen path: OpenRouter free variants

| | 5 min | 10 min | 20 min |
|---|---|---|---|
| Requests needed (batched, §4.3) [Estimate] | ~40 | ~70 | ~130 |
| Days of quota at **50 requests/day** (no credit purchase) | 1 | 2 | 3 |
| Days of quota at **1,000 requests/day** (after a one-time $10 credit purchase) | < 1 | < 1 | < 1 |
| API cost | **$0** | **$0** | **$0** |

The 50/day tier works but turns one video into a two- or three-day job, and development (many test runs a day) will hit it constantly. **My recommendation is the one-time $10 credit purchase**: it raises the cap to 1,000/day permanently, and the $10 stays in the account as the paid fallback for days when the free endpoints are at capacity. It is the only money the default setup asks for. Your call: everything is designed to work without it, just more slowly.

### If you ever fall back to the paid ids (same models, OpenRouter list prices)

| | 5 min | 10 min | 20 min |
|---|---|---|---|
| Nemotron 3 Ultra ($0.50 in / $0.10 cached / $2.20 out per M) | ~$0.65 | ~$1.25 | ~$2.50 |
| Nemotron 3.5 Super VL ($0.15 in / $0.50 out per M) | ~$0.13 | ~$0.25 | ~$0.50 |
| **Expected total** | **~$0.80** | **~$1.50** | **~$3.00** |
| Pessimistic (3× reasoning tokens, 5 iterations) | ~$2.50 | ~$4.50 | ~$9 |
| Local compute (transcription, embeddings, render; laptop at ~100–130 W for 0.5–1.5 h) | ~0.1 kWh | ~0.15 kWh | ~0.3 kWh |
| Assets (Pixabay, Openverse, Wikimedia, Iconify, Freesound, own library) | $0 | $0 | $0 |

These are planning numbers. Phase 3 logs real token counts per call; the cost section gets replaced by measured numbers then.

### Options by category

| Category | Completely free & local | Free with limitations | Free-tier cloud | Paid | Optional premium |
|---|---|---|---|---|---|
| Reasoning/planning | qwen3:8b / Nemotron Bolt E4B / qwen3-coder-30b (CPU-offloaded, slow) — **noticeably weaker plans** | — | **Chosen: OpenRouter `nemotron-3-ultra-550b-a55b:free`** (20/min, 50 or 1,000/day); backup: build.nvidia.com trial (~40/min, evaluation-only terms) | Ultra paid id via OpenRouter (~$1–3/video) | Route component code to a top closed coding model |
| Visual QA | Geometry checks (exact) + Gemma 4 E4B / Qwen3-VL 8B local | — | **Chosen: OpenRouter `nemotron-3.5-super-vl:free`**; backup: build.nvidia.com trial | Super VL paid id (~$0.25/video) | — |
| Transcription | Parakeet / faster-whisper local | — | — | — | — |
| Embeddings / search | Qwen3-VL-Embedding, SigLIP 2, LanceDB | — | — | — | — |
| Images | Own library, programmatic graphics, FLUX.2 klein local | Pixabay, Openverse, Wikimedia, Unsplash (rate limits, attribution) | — | Stock subscriptions | — |
| GIFs / memes | Own curated library | GIPHY beta key (100/h, no caching) | — | GIPHY production (custom pricing) | — |
| Music / SFX | Own library, Freesound CC0, Pixabay audio, YouTube Audio Library (manual) | — | — | Music subscription (e.g. for Content-ID-safe tracks) | — |
| Rendering | Remotion locally (free licence for individuals), NVENC | — | — | Remotion Lambda/cloud (not needed) | — |
| Storage | D: drive | — | — | External SSD if D: fills | — |
| Hosting | None needed | — | — | — | — |

**Bottom line**: everything except the two Nemotron models runs locally for $0, and the two Nemotron models run on OpenRouter's free tier for $0 too. The only limits are requests per day (50, or 1,000 after a one-time $10 purchase) and NVIDIA's data handling on the free endpoints. If you ever switch to the paid ids, expect about **$1–3 per 10-minute video**. A local-models-only mode remains as an offline fallback, with noticeably weaker planning.

## 6.3 Licensing and legal considerations (K)

### Software

| Component | Licence | What it means for you |
|---|---|---|
| Remotion and all `@remotion/*` | Remotion License | Free for you as an individual, commercial videos included. Don't sell or relicense a Remotion derivative. A company of 4+ people (contractors count from 5.0) would need a company licence |
| `@xzdarcy/react-timeline-editor`, `dnd-timeline` | MIT | Permissive |
| HyperFrames | Apache-2.0 | Permissive; keep notices |
| GSAP | Proprietary "Standard No Charge" | Free, but owned by Webflow; prohibited in visual no-code animation builders competing with Webflow; terms can change. **We avoid it in the renderer** |
| FilmCraft / EffectCraft | MIT OR Apache-2.0 | Permissive |
| Rendiv | Apache-2.0 | Permissive (not used) |
| Electron, React, Zustand, wavesurfer.js, OpenTimelineIO, LanceDB, llama.cpp, PySceneDetect, faster-whisper, WhisperX, ctc-forced-aligner, BiRefNet, SAM 2 | MIT / BSD / Apache-2.0 | Permissive |
| parselmouth (Praat bindings) | GPL-3.0 | Fine for a private tool; would matter only if you distributed the app |
| SearXNG (optional) | AGPL-3.0 | Fine for local private use |
| ELK.js (optional) | EPL-2.0 | Weak copyleft; fine for use; dagre (MIT) is the alternative |

### Models

| Model | Licence | Notes |
|---|---|---|
| Nemotron 3 Ultra, Nemotron 3.5 Super VL, Bolt | OpenMDW-1.1 | Permissive open-model licence; commercial use allowed. **API use is governed by the provider's terms** (OpenRouter/DeepInfra/etc., or NVIDIA's Trial Terms) |
| Parakeet TDT 0.6B v3 | CC-BY-4.0 | Attribution if you redistribute the model; transcripts are yours |
| Qwen3-VL, Qwen3-VL-Embedding | Apache-2.0 | Permissive |
| Gemma 4 | Apache-2.0 per its model card as reported by several sources (one listed "Gemma Terms") | **Verify on the model card before adopting** |
| SigLIP 2, SAM 2 | Apache-2.0 | Permissive |
| BiRefNet | MIT | Permissive (avoid RMBG-2.0: non-commercial) |
| FLUX.2 [klein] 4B, Z-Image-Turbo | Apache-2.0 | OK. **FLUX.2 [klein] 9B and [dev] are non-commercial**, so don't use them for a monetised channel |

### Assets

- **Monetised YouTube is commercial use.** That excludes CC-BY-NC, and "personal use only" assets.
- **CC-BY** requires attribution: the credits file handles it. **ND** forbids adaptation: excluded because we crop, cut out and animate.
- **Memes and screenshots of third-party content** are copyrighted; using them in commentary relies on fair use / fair dealing, which is a defence, not a licence. Keep them short, transformed and relevant. India's fair-dealing provisions for criticism and review are narrower than US fair use; YouTube's systems apply US-style policies. This is a risk you already take in your current videos; the system just makes it visible in the ledger.
- **Music** is where Content ID claims actually happen. Even "free" libraries (including Pixabay) occasionally trigger claims. Prefer the YouTube Audio Library or tracks whose licence explicitly covers YouTube monetisation, and keep the licence record.
- **Logos and product images** are trademarks; editorial/commentary use is normal, but don't imply endorsement.
- **API terms differ from content licences**: GIPHY forbids caching through its API, Pixabay requires 24 h response caching and forbids hotlinking, Unsplash requires attribution and download tracking. The asset module implements each provider's rules separately.
