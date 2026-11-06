# @cls/engine

Edit Decision Document (EDD) schema, the motion component library, and the render pipeline.

```
src/edd/schema.ts        the EDD (Zod) — single source of truth for an edit
src/components/          the component library + registry (what the planner may use)
src/motion/              entrances/exits, camera (zoom/pan/tilt), moods — pure functions of the frame
src/look/                looks (design tokens) and bundled fonts
src/compositions/        BeatView (one beat), EddVideo (whole edit), EddBeat (one beat, for caching)
scripts/lib/pipeline.ts  per-beat render with content-hash cache → concat → narration mux
schema/                  generated JSON Schemas (npm run schema) for the Python sidecar and LLM tools
```

## Commands (run in `engine/`)

| Command | What it does |
|---|---|
| `npm run schema` | Writes `schema/edd.schema.json`, `schema/components.schema.json`, and the demo document |
| `npm run render -- <project>\edd.json [--scale 0.6667] [--concurrency 4] [--hw] [--no-cache]` | Renders to `<project>\renders\` |
| `npm run bench -- <project>\edd.json` | Phase 2 benchmark (concurrency sweep, x264 vs NVENC, one-beat re-render) |
| `npm run determinism -- <project>\edd.json` | Renders 30 frames twice and compares hashes |
| `npm run studio` | Remotion Studio with the built-in demo document |
| `npx tsx scripts/export-icons.ts <dir> <slug>…` | Exports Simple Icons (CC0) logos as SVG |

## Rules the code follows

- **Media is never in `public/`.** On Windows Remotion copies `public/` into every bundle, so project media is served from the project folder by `scripts/lib/media-server.ts`; EDD paths are project-relative.
- **Everything is a function of the frame.** No `Math.random()` (seeded `random()` only), no wall-clock time, fonts bundled locally and loaded before anything measures text.
- **Beats render separately** and are cached under a hash of the beat, the format, the look, the engine source and the media fingerprints, so editing one beat re-renders one beat.
- Positions and sizes are **percentages of the frame**, so a document renders identically at preview and final resolutions.
