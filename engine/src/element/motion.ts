/**
 * The motion language of generated elements.
 *
 * The easing curves and the timing ladder follow the motion guides bundled with OpenClicky (MIT, © 2026 Jason Kneen:
 * `animate` skill and `hallmark/references/motion.md`): exponential ease-out for things arriving, ease-in for things
 * leaving, three duration buckets, exits at ~75 % of the entrance, staggered reveals, and no bounce or elastic curves.
 * Their rules are written for CSS; here they are plain functions of time so a render is deterministic.
 */
import { Easing } from 'remotion';

export const EASES = ['linear', 'in', 'out', 'inout', 'expo', 'quart', 'quint', 'in-expo', 'inout-expo', 'spring', 'back'] as const;
export type EaseName = (typeof EASES)[number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// cubic-bezier tokens from the guides
const outExpo = Easing.bezier(0.16, 1, 0.3, 1); // entering: confident, decisive
const outQuart = Easing.bezier(0.25, 1, 0.5, 1); // smooth, refined
const outQuint = Easing.bezier(0.22, 1, 0.36, 1); // slightly snappier
const inExpo = Easing.bezier(0.7, 0, 0.84, 0); // leaving
const inOutExpo = Easing.bezier(0.65, 0, 0.35, 1); // state toggles

export function easeBy(u: number, kind: EaseName | undefined): number {
	u = clamp01(u);
	switch (kind) {
		case 'in': return Easing.in(Easing.cubic)(u);
		case 'out': return Easing.out(Easing.cubic)(u);
		case 'inout': return Easing.inOut(Easing.cubic)(u);
		case 'expo': return outExpo(u);
		case 'quart': return outQuart(u);
		case 'quint': return outQuint(u);
		case 'in-expo': return inExpo(u);
		case 'inout-expo': return inOutExpo(u);
		case 'back': return Easing.back(1.7)(u);
		case 'spring': return 1 - Math.exp(-7 * u) * Math.cos(10 * u); // kept for older specs; the prompt steers away from it
		default: return u;
	}
}

/** Duration buckets (seconds). Video reads slower than UI, so these are the guides' values times ~1.4. */
export const DUR = { micro: 0.17, short: 0.3, long: 0.6 } as const;

export const APPEAR_KINDS = ['fade', 'rise', 'pop', 'draw', 'grow', 'drop', 'slide-left', 'slide-right'] as const;
export type AppearKind = (typeof APPEAR_KINDS)[number];

/**
 * Presence of something that appears at `at` (and optionally leaves at `until`): 0 = not there, 1 = settled.
 * Entrance uses ease-out-expo; the exit runs at 75 % of the entrance time with ease-in.
 */
export function presence(t: number, at: number, duration: number, until?: number): number {
	if (t < at) return 0;
	const d = Math.max(0.05, duration);
	if (until !== undefined && t >= until) {
		const x = (t - until) / (d * 0.75);
		return x >= 1 ? 0 : 1 - inExpo(clamp01(x));
	}
	return outExpo(clamp01((t - at) / d));
}

/** How a presence value p maps to opacity and a 2D transform for each kind. `k` scales distances to the drawing size. */
export function appearTransform(kind: AppearKind, p: number, k: number): { opacity: number; tx: number; ty: number; s: number; sy: number; draw: number | null } {
	const base = { opacity: p, tx: 0, ty: 0, s: 1, sy: 1, draw: null as number | null };
	switch (kind) {
		case 'rise': return { ...base, ty: (1 - p) * 10 * k };
		case 'drop': return { ...base, ty: -(1 - p) * 26 * k };
		case 'slide-left': return { ...base, tx: (1 - p) * 26 * k };
		case 'slide-right': return { ...base, tx: -(1 - p) * 26 * k };
		case 'pop': return { ...base, s: 0.82 + 0.18 * p };
		case 'grow': return { ...base, opacity: Math.min(1, p * 4), sy: Math.max(0.001, p) };
		case 'draw': return { ...base, opacity: p > 0 ? 1 : 0, draw: p };
		default: return base;
	}
}
