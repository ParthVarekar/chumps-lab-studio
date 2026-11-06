// Builds the README's showcase edit on top of a copy of the demo project, through the same HTTP API the AI uses.
//   node ../node_modules/tsx/dist/cli.mjs test/showcase-edit.mts <project-dir>
// Adds, in the 2.5–20.5 s window: karaoke captions, a highlight box, an arrow, a colour-wipe transition and an
// AI-designed element (needs the local or cloud model). Placement reuses the editor's own tile code (src/ui/tiles.ts).
import { CAPTION_STYLES, EFFECT_TILES, TRANSITION_TILES, placeOp } from '../src/ui/tiles';

const DIR = process.argv[2];
if (!DIR) throw new Error('usage: showcase-edit.mts <project-dir>');
const H = { 'X-Studio': '1', 'Content-Type': 'application/json' };
const api = async (p: string, b: unknown) => (await fetch(`http://localhost:4173${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json() as Promise<any>;
const tile = (list: typeof EFFECT_TILES, id: string) => { const t = list.find((x) => x.id === id); if (!t) throw new Error(`no tile ${id}`); return t; };

const opened = await api('/api/open', { dir: DIR });
const [A, B] = [2.5, 20.5];
const words = (opened.words as { text: string; start: number; end: number }[])
	.filter((w) => w.end > A && w.start < B)
	.map((w) => ({ text: w.text, start: +w.start.toFixed(2), end: +w.end.toFixed(2) }));
const karaoke = CAPTION_STYLES.find((c) => c.id === 'karaoke')!;

const ops = [
	{ op: 'add_layer', component: 'Captions', at: A, until: B, props: { ...karaoke.props, words }, why: 'captions (README showcase)' },
	// 13.6–17.2 s: string_methods.cpp is on screen, so circle `int main() {`; at 17.8 s the new loops.cpp tab appears, so point at it.
	{ ...placeOp(tile(EFFECT_TILES, 'hl-box'), { time: 14.3, region: { x: 26.4, y: 16.2, w: 11.8, h: 5.8 } }), until: 17.2 },
	placeOp(tile(EFFECT_TILES, 'arrow'), { time: 17.85, vector: { x0: 71, y0: 21, x1: 61.5, y1: 8.2 } }),
	// 8.7–12.9 s shows a YouTube page: blur other creators' thumbnails and the channel row (the editor's own Blur effect).
	{ ...placeOp(tile(EFFECT_TILES, 'blur'), { time: 8.65, region: { x: 71, y: 8.5, w: 29, h: 91.5 } }), until: 12.95 },
	{ ...placeOp(tile(EFFECT_TILES, 'blur'), { time: 8.65, region: { x: 0, y: 84.5, w: 71, h: 15.5 } }), until: 12.95 },
	// A colour wipe covers the cut from the browser to the editor.
	placeOp(tile(TRANSITION_TILES, 'wipe'), { time: 13.05 }),
];
const applied = await api('/api/ops', { dir: DIR, ops, author: 'user' });
for (const n of applied.notes ?? []) console.log(n.ok ? 'ok  ' : 'FAIL', n.message);

// An element the AI designs for this spot: the narration says "printed five times", so a counter ticking to five.
const t0 = Date.now();
const el = await api('/api/elements/design', { dir: DIR, brief: 'a small counter that ticks up from 1 to 5 copies', region: { x: 74, y: 11, w: 20, h: 30 }, time: 4.6, duration: 4 });
console.log(`element: ${el.ok ? 'OK' : 'FAILED'} in ${((Date.now() - t0) / 1000).toFixed(0)} s | ${el.say}`);
if (el.op) {
	const r = await api('/api/ops', { dir: DIR, ops: [el.op], author: 'ai' });
	for (const n of r.notes ?? []) console.log(n.ok ? 'ok  ' : 'FAIL', n.message);
}
process.exit(0);
