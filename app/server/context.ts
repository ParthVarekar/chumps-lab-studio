/** What the server knows about a project's footage: transcript with timestamps, on-screen text (OCR), scroll/cut times. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface Word { text: string; start: number; end: number }
export interface OcrEl { id: string; text: string; rect: { x: number; y: number; w: number; h: number }; from: number; to: number }
export interface Ctx {
	words: Word[];
	ocr: OcrEl[];
	ocrStep: number;
	motion: [number, number, number][]; // [start, end, peak changed-share]
}

const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

/** Same rule as sidecar footage.py: a sample moves when >4 % of pixels changed or the whole frame shifted. */
function motionSegments(rows: number[][]): [number, number, number][] {
	const dt = 0.1;
	const out: [number, number, number][] = [];
	for (const [t, chg, shift, resp] of rows) {
		if (chg > 0.04 || (shift >= 1.5 && resp > 0.1)) {
			const last = out[out.length - 1];
			if (last && t - dt - last[1] <= 0.35) {
				last[1] = t;
				last[2] = Math.max(last[2], chg);
			} else out.push([+(t - dt).toFixed(2), t, chg]);
		}
	}
	return out;
}

const cache = new Map<string, Ctx>();
export function loadContext(dir: string): Ctx {
	const hit = cache.get(dir);
	if (hit) return hit;
	const words: Word[] = (readJson(path.join(dir, 'words.json'))?.words ?? [])
		.map((w: Word) => ({ ...w, text: String(w.text).replace('<unk>', '') }))
		.filter((w: Word) => w.text.trim());
	const ocr = readJson(path.join(dir, 'ocr.json'));
	const ctx: Ctx = {
		words,
		ocr: ocr?.elements ?? [],
		ocrStep: ocr?.step ?? 1.5,
		motion: motionSegments(readJson(path.join(dir, 'analysis', 'motion.json')) ?? []),
	};
	cache.set(dir, ctx);
	return ctx;
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Index of the occurrence of `word` closest to time `near`, or -1. */
export function wordNear(ctx: Ctx, word: string, near: number): number {
	const w = norm(word);
	let best = -1;
	let d = Infinity;
	ctx.words.forEach((x, i) => {
		if (norm(x.text) === w && Math.abs(x.start - near) < d) (best = i), (d = Math.abs(x.start - near));
	});
	return best;
}

/** End of the spoken clause containing word i (punctuation or a pause). */
export function clauseEnd(ctx: Ctx, i: number, cap = 14): number {
	const last = ctx.words.length - 1;
	for (let j = Math.max(0, i); j <= Math.min(i + cap, last); j++) {
		const w = ctx.words[j];
		const gap = j < last ? ctx.words[j + 1].start - w.end : 1;
		if (/[.,;:!?]$/.test(w.text) || gap > 0.35) return w.end;
	}
	return ctx.words[Math.min(i + cap, last)]?.end ?? 0;
}

export const nextMotion = (ctx: Ctx, t: number): number | null => ctx.motion.find(([a]) => a > t)?.[0] ?? null;
export const movingAt = (ctx: Ctx, t: number, pad = 0.1): [number, number] | null => {
	const s = ctx.motion.find(([a, b]) => a - pad <= t && t <= b + pad);
	return s ? [s[0], s[1]] : null;
};
export const ocrAt = (ctx: Ctx, t: number): OcrEl[] => ctx.ocr.filter((e) => e.from - ctx.ocrStep <= t && t <= e.to);
